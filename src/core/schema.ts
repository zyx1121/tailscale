/**
 * Output-schema shell.
 *
 * Every tool declares an outputSchema so a caller knows the result shape before
 * it spends a probe call. The failure path is modelled too: an MCP client
 * validates every structuredContent against the declared schema, so an
 * unmodelled error envelope would surface as a protocol error instead of a
 * readable message. `data` is therefore optional and `error` is its peer.
 */
import { z } from "zod";

export const errorSchema = z
  .looseObject({
    code: z.string().describe("Actionable error code, such as not_configured, permission_denied or not_found."),
    message: z.string(),
    why: z.string().nullish().describe("What actually went wrong underneath."),
    hint: z.string().nullish().describe("The next action to take."),
  })
  .optional()
  .describe("Present instead of data when the call failed.");

export function envelopeOutput(data: z.ZodTypeAny = z.unknown()): z.ZodRawShape {
  return {
    data: data.optional().describe("Present on success."),
    metadata: z.record(z.string(), z.unknown()).optional().describe("Context about the result."),
    error: errorSchema,
  };
}
