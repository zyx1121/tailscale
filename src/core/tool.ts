import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TailscaleError } from "../tailscale/client.ts";
import { fail, mcpResult, type ToolRunResult } from "./result.ts";
import { envelopeOutput } from "./schema.ts";

export interface ToolboxTool {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  outputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
  run(args: Record<string, unknown>): Promise<ToolRunResult>;
}

export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  /** Shape of `data` on success. Omit for `unknown`. */
  data?: z.ZodTypeAny;
  /** Required, so a new tool cannot be added without declaring whether it reads or writes. */
  annotations: ToolAnnotations;
  handler(input: z.infer<z.ZodObject<Shape>>): Promise<ToolRunResult>;
}

/** Wrap a handler so that bad input and API failures come back as the error envelope, never as a thrown protocol error. */
export function defineTool<const Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): ToolboxTool {
  const schema = z.object(definition.inputSchema).strict();

  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: envelopeOutput(definition.data),
    annotations: definition.annotations,
    async run(args) {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        return fail({ code: "invalid_input", message: z.prettifyError(parsed.error) });
      }
      try {
        return await definition.handler(parsed.data);
      } catch (error) {
        if (error instanceof TailscaleError) return fail(error.toToolError());
        const message = error instanceof Error ? error.message : String(error);
        return fail({ code: "upstream_error", message });
      }
    },
  };
}

export function registerTools(server: McpServer, tools: ToolboxTool[]): void {
  const names = new Set<string>();

  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`duplicate MCP tool name: ${tool.name}`);
    names.add(tool.name);

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      async (args) => mcpResult(await tool.run(args as Record<string, unknown>)),
    );
  }
}
