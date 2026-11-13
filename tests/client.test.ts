import { expect, test } from "bun:test";
import { TailscaleClient, TailscaleError, apiMessage, type FetchLike } from "../src/tailscale/client.ts";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(handler: (call: Call, index: number) => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler({ url, init }, calls.length - 1);
    },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const SECRET = "s3cr3t-value";
const oauth = async () => ({ source: "oauth_env" as const, clientId: "id", clientSecret: SECRET });
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

test("an API key is sent as the bearer token with no token exchange", async () => {
  const { fetch, calls } = fakeFetch(() => json({ devices: [] }));
  const client = new TailscaleClient({ env: {}, fetch, credentials: async () => ({ source: "api_key", apiKey: "tskey" }) });
  await client.request(client.tailnetPath("devices"));
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://api.tailscale.com/api/v2/tailnet/-/devices");
  expect(header(calls[0]!, "Authorization")).toBe("Bearer tskey");
});

test("an OAuth token is minted once, reused, and renewed after it expires", async () => {
  let now = 0;
  let minted = 0;
  const { fetch, calls } = fakeFetch(({ url }) =>
    url.endsWith("/oauth/token") ? json({ access_token: `t${++minted}`, expires_in: 3600, scope: "devices:core:read policy_file" }) : json({}),
  );
  const client = new TailscaleClient({ env: {}, fetch, credentials: oauth, now: () => now });

  await client.request("/a");
  await client.request("/b");
  expect(minted).toBe(1);
  expect((await client.accessToken()).scopes).toEqual(["devices:core:read", "policy_file"]);
  expect(header(calls[0]!, "Authorization")).toBe(`Basic ${Buffer.from(`id:${SECRET}`).toString("base64")}`);

  now = 3600 * 1000;
  await client.request("/c");
  expect(minted).toBe(2);
  expect(header(calls.at(-1)!, "Authorization")).toBe("Bearer t2");
});

test("a 401 on a cached token mints a new one and retries once", async () => {
  let minted = 0;
  let api = 0;
  const { fetch } = fakeFetch(({ url }) => {
    if (url.endsWith("/oauth/token")) return json({ access_token: `t${++minted}`, expires_in: 3600 });
    return ++api === 1 ? json({ message: "API token invalid" }, 401) : json({ ok: true });
  });
  const client = new TailscaleClient({ env: {}, fetch, credentials: oauth });
  const response = await client.request("/x");
  expect(response.status).toBe(200);
  expect(minted).toBe(2);
});

test("failures map to actionable codes and name the granted scopes", async () => {
  const cases: Array<[number, string]> = [
    [401, "unauthorized"],
    [403, "permission_denied"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "upstream_error"],
  ];
  for (const [status, code] of cases) {
    const { fetch } = fakeFetch(({ url }) =>
      url.endsWith("/oauth/token") ? json({ access_token: "t", expires_in: 3600, scope: "devices:core:read" }) : json({ message: "nope" }, status),
    );
    const client = new TailscaleClient({ env: {}, fetch, credentials: oauth });
    const error = (await client.request("/x").catch((e) => e)) as TailscaleError;
    expect(error).toBeInstanceOf(TailscaleError);
    expect(error.code).toBe(code);
    expect(error.why).toBe(`HTTP ${status}: nope`);
    if (status === 403) expect(error.hint).toContain("devices:core:read");
  }
});

test("an allowed status is returned, not thrown", async () => {
  const { fetch } = fakeFetch(() => json({ message: "bad policy" }, 400));
  const client = new TailscaleClient({ env: {}, fetch, credentials: async () => ({ source: "api_key", apiKey: "k" }) });
  expect((await client.request("/x", { allow: [400] })).status).toBe(400);
});

test("no credential, a rejected OAuth client and a network failure each get their own code", async () => {
  const none = new TailscaleClient({ env: {}, fetch: fakeFetch(() => json({})).fetch, credentials: async () => ({ source: "none", why: "unset" }) });
  expect(((await none.request("/x").catch((e) => e)) as TailscaleError).code).toBe("not_configured");

  const rejected = new TailscaleClient({ env: {}, fetch: fakeFetch(() => json({ message: "bad client" }, 401)).fetch, credentials: oauth });
  const error = (await rejected.request("/x").catch((e) => e)) as TailscaleError;
  expect(error.code).toBe("unauthorized");
  expect(JSON.stringify(error.toToolError())).not.toContain(SECRET);

  const down = new TailscaleClient({
    env: {},
    fetch: async () => {
      throw new Error("ECONNREFUSED");
    },
    credentials: async () => ({ source: "api_key", apiKey: "k" }),
  });
  expect(((await down.request("/x").catch((e) => e)) as TailscaleError).code).toBe("upstream_error");
});

test("TAILSCALE_TAILNET selects the tailnet and is URL-encoded", () => {
  expect(new TailscaleClient({ env: {} }).tailnetPath("acl")).toBe("/tailnet/-/acl");
  expect(new TailscaleClient({ env: { TAILSCALE_TAILNET: "a b.example" } }).tailnetPath("acl")).toBe("/tailnet/a%20b.example/acl");
});

test("apiMessage prefers the JSON message and caps a raw body", () => {
  expect(apiMessage('{"message":"x"}')).toBe("x");
  expect(apiMessage("<html>" + "a".repeat(1000))).toHaveLength(300);
});
