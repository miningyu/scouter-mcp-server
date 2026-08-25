import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, discoverObjTypes, jsonStringify, resolveObjType } from "../client/index.js";
import { createOperationContext } from "../operations/context.js";
import { OperationInputError, type AnyOperation, type OperationContext } from "../operations/definition.js";
import { runOperation } from "../operations/execute.js";

/**
 * MCP runs as a long-lived process, so it keeps using the shared client singleton
 * and its object-type discovery cache rather than opening a second connection.
 */
export function createMcpOperationContext(): OperationContext {
  return createOperationContext(client, { resolveObjType, discoverObjTypes });
}

export function toMcpContent(result: unknown) {
  return { content: [{ type: "text" as const, text: jsonStringify(result) }] };
}

/** Registers one operation as an MCP tool, preserving its name, schema and annotations. */
export function registerOperationTool(server: McpServer, operation: AnyOperation): void {
  server.registerTool(operation.name, {
    title: operation.title,
    description: operation.description,
    inputSchema: operation.inputShape,
    annotations: operation.annotations,
  }, async (args: Record<string, unknown>) => {
    try {
      const result = await runOperation(operation, createMcpOperationContext(), args, {
        // registerAllTools() already gates write tools on SCOUTER_ENABLE_WRITE; re-checking
        // here would change how MCP write tools have always behaved.
        writeEnabled: true,
        // MCP clients run their own confirmation flow for destructive tools.
        destructiveConfirmed: true,
        // McpServer has already validated args against inputSchema.
        validateInput: false,
      });
      return toMcpContent(result);
    } catch (e) {
      if (e instanceof OperationInputError) {
        return { content: [{ type: "text" as const, text: e.message }] };
      }
      throw e;
    }
  });
}
