import { platform } from "node:os";

/**
 * Where the Tailscale credential comes from, in priority order:
 *
 * 1. `TAILSCALE_API_KEY`: an API access token, used as the bearer token directly.
 * 2. `TAILSCALE_OAUTH_CLIENT_ID` + `TAILSCALE_OAUTH_CLIENT_SECRET`: an OAuth client.
 * 3. `TAILSCALE_KEYCHAIN_SERVICE` (macOS): a generic password in the login
 *    keychain whose account is the OAuth client ID and whose password is the
 *    client secret. The secret then never sits in a config file or in the
 *    environment of unrelated processes.
 *
 * Nothing here has a site default: an unset environment means "not configured".
 */
export type CredentialSource = "api_key" | "oauth_env" | "keychain" | "none";

export type Credentials =
  | { source: "api_key"; apiKey: string }
  | { source: "oauth_env" | "keychain"; clientId: string; clientSecret: string }
  | { source: "none"; why: string };

export type Env = Record<string, string | undefined>;

/** Runs a command and returns its stdout, or null when it exits non-zero. Injected in tests. */
export type RunCommand = (argv: string[]) => Promise<string | null>;

const defaultRun: RunCommand = async (argv) => {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? stdout : null;
};

function value(env: Env, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

/** `security find-generic-password -s <service>` prints attributes; the account line is `"acct"<blob>="..."`. */
export function parseKeychainAccount(attributes: string): string | null {
  const match = /"acct"<blob>="([^"]*)"/.exec(attributes);
  return match?.[1] ? match[1] : null;
}

export interface LoadOptions {
  env?: Env;
  run?: RunCommand;
  platform?: string;
}

export async function loadCredentials(options: LoadOptions = {}): Promise<Credentials> {
  const env = options.env ?? process.env;
  const run = options.run ?? defaultRun;

  const apiKey = value(env, "TAILSCALE_API_KEY");
  if (apiKey) return { source: "api_key", apiKey };

  const clientId = value(env, "TAILSCALE_OAUTH_CLIENT_ID");
  const clientSecret = value(env, "TAILSCALE_OAUTH_CLIENT_SECRET");
  if (clientId && clientSecret) return { source: "oauth_env", clientId, clientSecret };
  if (clientId || clientSecret) {
    return { source: "none", why: "Only one of TAILSCALE_OAUTH_CLIENT_ID and TAILSCALE_OAUTH_CLIENT_SECRET is set." };
  }

  const service = value(env, "TAILSCALE_KEYCHAIN_SERVICE");
  if (service) {
    if ((options.platform ?? platform()) !== "darwin") {
      return { source: "none", why: "TAILSCALE_KEYCHAIN_SERVICE works on macOS only." };
    }
    const attributes = await run(["security", "find-generic-password", "-s", service]);
    const account = attributes ? parseKeychainAccount(attributes) : null;
    const secret = (await run(["security", "find-generic-password", "-s", service, "-w"]))?.trim();
    if (!account || !secret) {
      return { source: "none", why: `Keychain item "${service}" is missing, locked, or has no account.` };
    }
    return { source: "keychain", clientId: account, clientSecret: secret };
  }

  return { source: "none", why: "No Tailscale credential is set in the environment." };
}

export const CREDENTIAL_HINT =
  "Set TAILSCALE_API_KEY, or TAILSCALE_OAUTH_CLIENT_ID with TAILSCALE_OAUTH_CLIENT_SECRET, or TAILSCALE_KEYCHAIN_SERVICE on macOS. Then restart the MCP server.";
