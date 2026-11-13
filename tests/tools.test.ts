import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TailscaleClient } from "../src/tailscale/client.ts";
import { allTools } from "../src/tools/index.ts";
import { findDevices, matchesFilter, summarise, type ApiDevice } from "../src/tools/devices.ts";
import { parseValidation } from "../src/tools/policy.ts";

const devices: ApiDevice[] = [
  { nodeId: "nAAACNTRL", id: "1", name: "alpha.example.ts.net", hostname: "Alpha", addresses: ["100.64.0.1", "fd7a::1"], os: "linux", user: "a@example.com", tags: ["tag:server"], connectedToControl: true, expires: "2030-01-01T00:00:00Z", keyExpiryDisabled: true, advertisedRoutes: ["10.0.0.0/24"], enabledRoutes: ["10.0.0.0/24"] },
  { nodeId: "nBBBCNTRL", id: "2", name: "beta.example.ts.net", hostname: "beta", addresses: ["100.64.0.2"], os: "macOS", user: "b@example.com", connectedToControl: false, expires: "2030-01-01T00:00:00Z" },
  { nodeId: "nCCCCNTRL", id: "3", name: "beta-2.example.ts.net", hostname: "beta", addresses: ["100.64.0.3"], os: "iOS", user: "b@example.com" },
];

interface Seen {
  url: string;
  init: RequestInit;
}

function toolbox(respond: (seen: Seen) => Response) {
  const seen: Seen[] = [];
  const client = new TailscaleClient({
    env: {},
    credentials: async () => ({ source: "api_key", apiKey: "k" }),
    fetch: async (url, init) => {
      seen.push({ url, init });
      return respond({ url, init });
    },
  });
  const tools = new Map(allTools(client).map((tool) => [tool.name, tool]));
  return { seen, call: (name: string, args: Record<string, unknown> = {}) => tools.get(name)!.run(args) };
}

const deviceList = () => new Response(JSON.stringify({ devices }));

test("summarise hides the expiry of a key that never expires and defaults missing tags", () => {
  expect(summarise(devices[0]!).key_expires).toBeNull();
  expect(summarise(devices[1]!).key_expires).toBe("2030-01-01T00:00:00Z");
  expect(summarise(devices[1]!).tags).toEqual([]);
  expect(summarise(devices[2]!).online).toBeNull();
});

test("filters: text, tag with or without prefix, and online state", () => {
  const names = (filter: Parameters<typeof matchesFilter>[1]) => devices.filter((d) => matchesFilter(d, filter)).map((d) => d.nodeId);
  expect(names({ query: "ALPHA" })).toEqual(["nAAACNTRL"]);
  expect(names({ query: "100.64.0.2" })).toEqual(["nBBBCNTRL"]);
  expect(names({ tag: "server" })).toEqual(["nAAACNTRL"]);
  expect(names({ tag: "tag:server" })).toEqual(["nAAACNTRL"]);
  expect(names({ online: true })).toEqual(["nAAACNTRL"]);
  expect(names({ online: false })).toEqual(["nBBBCNTRL", "nCCCCNTRL"]);
});

test("findDevices matches ID, short name and address exactly, and reports duplicates", () => {
  expect(findDevices(devices, "nBBBCNTRL")).toHaveLength(1);
  expect(findDevices(devices, "alpha")).toHaveLength(1);
  expect(findDevices(devices, "100.64.0.3")[0]!.nodeId).toBe("nCCCCNTRL");
  expect(findDevices(devices, "beta")).toHaveLength(2);
  expect(findDevices(devices, "alph")).toHaveLength(0);
});

test("tailscale_list_devices asks for all fields, filters and limits", async () => {
  const { seen, call } = toolbox(deviceList);
  const result = await call("tailscale_list_devices", { query: "beta", limit: 1 });
  expect(seen[0]!.url).toBe("https://api.tailscale.com/api/v2/tailnet/-/devices?fields=all");
  expect(result.isError).toBe(false);
  const data = result.structuredContent.data as { devices: unknown[]; matched: number; total: number };
  expect([data.devices.length, data.matched, data.total]).toEqual([1, 2, 3]);
});

test("tailscale_get_device returns one device, or says not_found or ambiguous", async () => {
  const { call } = toolbox(deviceList);
  const one = await call("tailscale_get_device", { device: "alpha" });
  expect((one.structuredContent.data as { device: ApiDevice }).device.nodeId).toBe("nAAACNTRL");
  expect((await call("tailscale_get_device", { device: "nope" })).structuredContent.error).toMatchObject({ code: "not_found" });
  expect((await call("tailscale_get_device", { device: "beta" })).structuredContent.error).toMatchObject({ code: "ambiguous" });
});

test("tailscale_get_policy asks for HuJSON and returns the ETag", async () => {
  const { seen, call } = toolbox(() => new Response("// c\n{}", { headers: { ETag: '"abc"' } }));
  const result = await call("tailscale_get_policy");
  expect((seen[0]!.init.headers as Record<string, string>).Accept).toBe("application/hujson");
  expect(result.structuredContent.data).toEqual({ policy: "// c\n{}", etag: '"abc"' });
});

test("parseValidation: pass, failing tests, and a policy that does not parse", () => {
  expect(parseValidation(200, "{}")).toEqual({ valid: true, message: null, failures: [] });
  expect(parseValidation(200, '{"message":"test(s) failed","data":[{"user":"x"}]}')).toEqual({ valid: false, message: "test(s) failed", failures: [{ user: "x" }] });
  expect(parseValidation(400, '{"message":"bad syntax"}')).toMatchObject({ valid: false, message: "bad syntax" });
  expect(parseValidation(400, "oops").valid).toBe(false);
});

test("tailscale_validate_policy posts the text or the file, and wants exactly one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tailscale-test-"));
  try {
    const file = join(dir, "policy.hujson");
    await writeFile(file, '{"acls":[]}');
    const { seen, call } = toolbox(() => new Response("{}"));

    expect((await call("tailscale_validate_policy", { path: file })).structuredContent.data).toMatchObject({ valid: true });
    expect(seen[0]!.url).toBe("https://api.tailscale.com/api/v2/tailnet/-/acl/validate");
    expect(seen[0]!.init.method).toBe("POST");
    expect(seen[0]!.init.body).toBe('{"acls":[]}');

    for (const args of [{}, { policy: "{}", path: file }, { path: "relative.hujson" }]) {
      expect((await call("tailscale_validate_policy", args)).structuredContent.error).toMatchObject({ code: "invalid_input" });
    }
    expect((await call("tailscale_validate_policy", { path: join(dir, "missing") })).structuredContent.error).toMatchObject({ code: "not_found" });
    expect(seen).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown input keys are rejected, and API failures come back as the envelope", async () => {
  const { call } = toolbox(() => new Response('{"message":"no"}', { status: 403 }));
  expect((await call("tailscale_list_devices", { bogus: 1 })).structuredContent.error).toMatchObject({ code: "invalid_input" });
  const denied = await call("tailscale_list_devices");
  expect(denied.isError).toBe(true);
  expect(denied.structuredContent.error).toMatchObject({ code: "permission_denied" });
});

test("every tool is declared read-only", () => {
  const client = new TailscaleClient({ env: {}, credentials: async () => ({ source: "none", why: "" }) });
  for (const tool of allTools(client)) expect(tool.annotations.readOnlyHint).toBe(true);
});
