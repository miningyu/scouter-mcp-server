import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify } from "../client/index.js";
import { todayYmd } from "../time-utils.js";

export const params = {
  type: z.enum(["sql", "service", "error", "apicall", "desc", "login", "ip", "ua"]).describe("Text type to look up"),
  hashes: z.string().describe("Comma-separated hash IDs (e.g. '1226688262,-407685533')"),
  date: z.string().optional().describe("Date in YYYYMMDD format. Defaults to today."),
};

export function register(server: McpServer) {
  server.registerTool("lookup_text", {
    title: "Lookup Text",
    description: "Resolve hash IDs to their original text values. Scouter stores SQL queries, service names, error messages, etc. as integer hashes for efficiency. Use this to get the actual text for a hash ID seen in other tool outputs.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

function intToIp(value: number): string {
  const unsigned = value >>> 0;
  return `${(unsigned >>> 24) & 0xFF}.${(unsigned >>> 16) & 0xFF}.${(unsigned >>> 8) & 0xFF}.${unsigned & 0xFF}`;
}

async function handler(args: { type: string; hashes: string; date?: string }) {
  const date = args.date || todayYmd();
  const hashList = args.hashes.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n));

  if (hashList.length === 0) {
    return { content: [{ type: "text" as const, text: jsonStringify({ error: "No valid hashes provided" }) }] };
  }

  let result: Record<string, string>;
  if (args.type === "ip") {
    result = Object.fromEntries(hashList.map(h => [String(h), intToIp(h)]));
  } else {
    result = await client.lookupTexts(date, args.type, hashList);
  }

  const resolvedCount = Object.keys(result).length;
  const unresolvedHashes = hashList.filter(h => !(String(h) in result));

  const output: Record<string, unknown> = {
    type: args.type,
    date,
    requestedHashes: hashList.length,
    resolvedCount,
    resolved: result,
  };

  if (unresolvedHashes.length > 0) {
    output.unresolvedHashes = unresolvedHashes;
    output.note = `${unresolvedHashes.length} hash(es) could not be resolved. They may belong to a different date or text type, or the server may not have them cached.`;
  }

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
