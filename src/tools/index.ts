import type { ToolboxTool } from "../core/tool.ts";
import type { TailscaleClient } from "../tailscale/client.ts";
import { capabilitiesTool } from "./capabilities.ts";
import { deviceTools } from "./devices.ts";
import { policyTools } from "./policy.ts";

export function allTools(client: TailscaleClient): ToolboxTool[] {
  const tools: ToolboxTool[] = [...deviceTools(client), ...policyTools(client)];
  tools.push(capabilitiesTool(client, () => tools.map((tool) => tool.name)));
  return tools;
}
