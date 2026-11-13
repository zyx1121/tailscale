import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./core/tool.ts";
import { TailscaleClient } from "./tailscale/client.ts";
import { allTools } from "./tools/index.ts";
import manifest from "../plugin.json";

const server = new McpServer({ name: manifest.name, version: manifest.version });
const tools = allTools(new TailscaleClient());
registerTools(server, tools);
console.error(`[tailscale-mcp] registered ${tools.length}`);
await server.connect(new StdioServerTransport());
