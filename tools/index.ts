import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isWriteEnabled } from "../operations/execute.js";
import { listAvailableOperations } from "../operations/registry.js";
import { registerOperationTool } from "../server/mcp-tool.js";

export { isWriteEnabled };

/**
 * Registers every operation the current environment allows as an MCP tool.
 * Write operations stay unregistered unless SCOUTER_ENABLE_WRITE=true, exactly as before.
 */
export function registerAllTools(server: McpServer): void {
  for (const operation of listAvailableOperations()) {
    registerOperationTool(server, operation);
  }
}
