#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server/index.js";

const { server, cleanup } = createServer();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Scouter MCP Server running on stdio");
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
