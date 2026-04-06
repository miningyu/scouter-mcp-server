import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";

export const params = {
  date: z.string().describe("Date in YYYYMMDD format"),
  txid: z.string().describe("Transaction ID (from search_transactions or get_realtime_xlogs)"),
};

export function register(server: McpServer) {
  server.registerTool("get_raw_profile", {
    title: "Get Raw Profile",
    description: "Get raw (non-decoded) profile steps for a transaction. Unlike get_transaction_detail which returns decoded/human-readable profile data, this returns the raw Step objects with hash IDs. Use lookup_text to resolve hash IDs to text. Useful when you need the raw step structure for programmatic analysis.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

async function handler(args: { date: string; txid: string }) {
  const warnings: string[] = [];

  const profile = await catchWarn(
    client.getRawProfile(args.date, args.txid),
    null, warnings, "rawProfile",
  );

  const output: Record<string, unknown> = {
    date: args.date,
    txid: args.txid,
    profile,
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
