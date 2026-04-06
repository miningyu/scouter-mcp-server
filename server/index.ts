import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../tools/index.js";

export function createServer(): { server: McpServer; cleanup: () => void } {
  const server = new McpServer({
    name: "scouter-apm",
    version: "1.0.0",
  });

  registerAllTools(server);

  return {
    server,
    cleanup: () => {},
  };
}
