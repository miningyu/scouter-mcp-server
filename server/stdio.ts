import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./index.js";

/** Starts the MCP server on stdio. Every log line goes to stderr so stdout stays protocol-only. */
export async function startStdioServer(): Promise<void> {
  const { server, cleanup } = createServer();

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Scouter MCP Server running on stdio");
}
