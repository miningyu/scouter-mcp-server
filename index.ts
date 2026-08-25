#!/usr/bin/env node

import { runCli } from "./cli/index.js";
import { startStdioServer } from "./server/stdio.js";

/** No arguments keeps the long-standing behaviour: a stdio MCP server. */
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    await startStdioServer();
    return;
  }
  process.exitCode = await runCli(argv);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
