import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { operation } from "../operations/get-counter-trend.js";
import { registerOperationTool } from "../server/mcp-tool.js";

export const params = operation.inputShape;

export function register(server: McpServer) {
  registerOperationTool(server, operation);
}
