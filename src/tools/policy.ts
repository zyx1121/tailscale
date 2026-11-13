import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { fail, ok } from "../core/result.ts";
import { defineTool, type ToolboxTool } from "../core/tool.ts";
import { apiMessage, type TailscaleClient } from "../tailscale/client.ts";

const HUJSON = "application/hujson";

export interface ValidationResult {
  valid: boolean;
  message: string | null;
  failures: unknown[];
}

/**
 * The validate endpoint answers 200 with `{}` when the policy parses and every
 * test in it passes. A failing test is also a 200, with `message` and `data`.
 * A policy that does not parse is a 400 with `message`.
 */
export function parseValidation(status: number, text: string): ValidationResult {
  let body: { message?: unknown; data?: unknown } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return { valid: false, message: apiMessage(text) || `HTTP ${status}`, failures: [] };
  }
  const message = typeof body.message === "string" && body.message ? body.message : null;
  const failures = Array.isArray(body.data) ? body.data : [];
  return { valid: status === 200 && message === null, message, failures };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function policyTools(client: TailscaleClient): ToolboxTool[] {
  return [
    defineTool({
      name: "tailscale_get_policy",
      description:
        "Read the tailnet policy file that is live right now, as HuJSON text with its ETag. Use it to compare the live policy with the copy in a repository. Read-only: this plugin never writes the policy.",
      inputSchema: {},
      data: z.looseObject({
        policy: z.string().describe("The policy file as HuJSON, comments included."),
        etag: z.string().nullable().describe("Version of the live policy."),
      }),
      annotations: readOnly,
      async handler() {
        const response = await client.request(client.tailnetPath("acl"), { accept: HUJSON });
        return ok({ policy: response.text, etag: response.headers.get("etag") });
      },
    }),
    defineTool({
      name: "tailscale_validate_policy",
      description:
        "Check a candidate policy file against the tailnet without applying it: Tailscale parses it and runs the tests it contains. Give the policy inline or as a local file. Nothing in the tailnet changes.",
      inputSchema: {
        policy: z.string().optional().describe("The policy as HuJSON or JSON text. Give this or path, not both."),
        path: z.string().optional().describe("Absolute path of a local policy file. Give this or policy, not both."),
      },
      data: z.looseObject({
        valid: z.boolean().describe("True when the policy parses and all its tests pass."),
        message: z.string().nullable().describe("Why the policy is not valid."),
        failures: z.array(z.unknown()).describe("One entry per failing test, as Tailscale reports it."),
      }),
      annotations: readOnly,
      async handler(input) {
        if ((input.policy === undefined) === (input.path === undefined)) {
          return fail({ code: "invalid_input", message: "Give exactly one of policy and path." });
        }

        let policy = input.policy ?? "";
        if (input.path !== undefined) {
          if (!isAbsolute(input.path)) {
            return fail({ code: "invalid_input", message: "path must be absolute." });
          }
          try {
            policy = await readFile(input.path, "utf8");
          } catch (error) {
            const why = error instanceof Error ? error.message : String(error);
            return fail({ code: "not_found", message: `Could not read ${input.path}.`, why });
          }
        }

        const response = await client.request(client.tailnetPath("acl/validate"), {
          method: "POST",
          body: policy,
          contentType: HUJSON,
          allow: [400],
        });
        return ok(parseValidation(response.status, response.text));
      },
    }),
  ];
}
