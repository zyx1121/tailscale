import { z } from "zod";
import { ok } from "../core/result.ts";
import { defineTool, type ToolboxTool } from "../core/tool.ts";
import { TailscaleError, type TailscaleClient } from "../tailscale/client.ts";

/**
 * Always answers, even with no credential: a caller that gets permission_denied
 * elsewhere needs one place to see which credential is in use and what it may do.
 */
export function capabilitiesTool(client: TailscaleClient, toolNames: () => string[]): ToolboxTool {
  return defineTool({
    name: "tailscale_get_capabilities",
    description:
      "Report whether a Tailscale credential is configured, where it comes from, which OAuth scopes it was granted and which tools this server offers. Call it first when another tool answers not_configured or permission_denied. Never returns the credential.",
    inputSchema: {},
    data: z.looseObject({
      configured: z.boolean(),
      credential_source: z.string().describe("api_key, oauth_env, keychain or none."),
      tailnet: z.string().describe('"-" means the tailnet that owns the credential.'),
      scopes: z.array(z.string()).nullable().describe("OAuth scopes granted. Null for an API key or when not configured."),
      problem: z.string().nullable().describe("Why no access token could be obtained."),
      hint: z.string().nullable(),
      tools: z.array(z.string()),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler() {
      const base = { tailnet: client.tailnet, tools: toolNames() };
      try {
        const access = await client.accessToken();
        return ok({ configured: true, credential_source: access.source, scopes: access.scopes, problem: null, hint: null, ...base });
      } catch (error) {
        if (!(error instanceof TailscaleError)) throw error;
        return ok({
          configured: false,
          credential_source: "none",
          scopes: null,
          problem: [error.message, error.why].filter(Boolean).join(" "),
          hint: error.hint,
          ...base,
        });
      }
    },
  });
}
