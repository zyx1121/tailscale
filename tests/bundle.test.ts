import { expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("the installed bundle loads without source or node_modules and answers with no credential", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tailscale plugin "));
  const client = new Client({ name: "tailscale-test", version: "1" });
  try {
    await cp(new URL("../dist", import.meta.url), join(temp, "dist"), { recursive: true });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith("TAILSCALE_")),
    ) as Record<string, string>;
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(temp, "dist/server.js")], cwd: temp, env, stderr: "pipe" }));

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "tailscale_get_capabilities",
      "tailscale_get_device",
      "tailscale_get_policy",
      "tailscale_list_devices",
      "tailscale_validate_policy",
    ]);

    const capabilities = await client.callTool({ name: "tailscale_get_capabilities", arguments: {} });
    expect(capabilities.isError).toBe(false);
    expect(capabilities.structuredContent).toMatchObject({ data: { configured: false, credential_source: "none", tailnet: "-" } });

    const devices = await client.callTool({ name: "tailscale_list_devices", arguments: {} });
    expect(devices.isError).toBe(true);
    expect(devices.structuredContent).toMatchObject({ error: { code: "not_configured" } });
  } finally {
    await client.close();
    await rm(temp, { recursive: true, force: true });
  }
}, 60000);
