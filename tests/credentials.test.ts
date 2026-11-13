import { expect, test } from "bun:test";
import { loadCredentials, parseKeychainAccount } from "../src/tailscale/credentials.ts";

const never = async () => {
  throw new Error("must not run a command");
};

test("an API key wins over everything else", async () => {
  const found = await loadCredentials({
    env: { TAILSCALE_API_KEY: "key", TAILSCALE_OAUTH_CLIENT_ID: "id", TAILSCALE_OAUTH_CLIENT_SECRET: "secret" },
    run: never,
  });
  expect(found).toEqual({ source: "api_key", apiKey: "key" });
});

test("an OAuth client needs both halves", async () => {
  expect(await loadCredentials({ env: { TAILSCALE_OAUTH_CLIENT_ID: "id", TAILSCALE_OAUTH_CLIENT_SECRET: "secret" }, run: never })).toEqual({
    source: "oauth_env",
    clientId: "id",
    clientSecret: "secret",
  });
  expect((await loadCredentials({ env: { TAILSCALE_OAUTH_CLIENT_ID: "id" }, run: never })).source).toBe("none");
});

test("the keychain gives the account as client ID and the password as secret", async () => {
  const calls: string[][] = [];
  const found = await loadCredentials({
    env: { TAILSCALE_KEYCHAIN_SERVICE: "svc" },
    platform: "darwin",
    run: async (argv) => {
      calls.push(argv);
      return argv.includes("-w") ? "s3cret\n" : 'keychain: "x"\n    "acct"<blob>="client-id"\n    "svce"<blob>="svc"\n';
    },
  });
  expect(found).toEqual({ source: "keychain", clientId: "client-id", clientSecret: "s3cret" });
  expect(calls.every((argv) => argv[0] === "security")).toBe(true);
});

test("the keychain is macOS only, and a missing item is not configured", async () => {
  expect((await loadCredentials({ env: { TAILSCALE_KEYCHAIN_SERVICE: "svc" }, platform: "linux", run: never })).source).toBe("none");
  expect((await loadCredentials({ env: { TAILSCALE_KEYCHAIN_SERVICE: "svc" }, platform: "darwin", run: async () => null })).source).toBe("none");
});

test("nothing set means not configured, without running anything", async () => {
  expect((await loadCredentials({ env: {}, run: never })).source).toBe("none");
});

test("parseKeychainAccount reads the acct attribute", () => {
  expect(parseKeychainAccount('"acct"<blob>="abc"')).toBe("abc");
  expect(parseKeychainAccount('"acct"<blob>=<NULL>')).toBeNull();
});
