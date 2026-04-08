import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";
import { maskRawResult, isMaskPiiEnabled } from "./shared-utils.js";


export const params = {
  mode: z.enum(["single", "gxid", "search", "pageable", "realtime"]).describe(
    "'single' gets one XLog by txid, 'gxid' gets by global transaction ID, 'search' searches with filters, 'pageable' gets a page of XLogs, 'realtime' gets recent real-time XLogs",
  ),
  date: z.string().optional().describe("Date in YYYYMMDD format (required for all modes except 'realtime')"),
  txid: z.string().optional().describe("Transaction ID (required for 'single' mode)"),
  gxid: z.string().optional().describe("Global transaction ID (required for 'gxid' mode)"),
  obj_hashes: z.string().optional().describe("Comma-separated object hashes (required for 'pageable' and 'realtime' modes)"),
  start_time_millis: z.number().optional().describe("Start time in epoch millis (for 'search' and 'pageable' modes)"),
  end_time_millis: z.number().optional().describe("End time in epoch millis (for 'search' and 'pageable' modes)"),
  start_hms: z.string().optional().describe("Start time as HHMMSS string (alternative to start_time_millis)"),
  end_hms: z.string().optional().describe("End time as HHMMSS string (alternative to end_time_millis)"),
  service: z.string().optional().describe("Service name filter (for 'search' mode, partial match)"),
  ip: z.string().optional().describe("Client IP filter (for 'search' mode)"),
  login: z.string().optional().describe("Login ID filter (for 'search' mode)"),
  obj_hash: z.number().optional().describe("Object hash filter (for 'search' mode)"),
  xlog_loop: z.number().optional().default(0).describe("Loop offset for 'realtime' mode (from previous response)"),
  xlog_index: z.number().optional().default(0).describe("Index offset for 'realtime' mode (from previous response)"),
  page_count: z.number().optional().describe("Page size for 'pageable' mode (max 30000, default 10000)"),
  last_txid: z.number().optional().describe("Last txid from previous page (for 'pageable' pagination)"),
  last_xlog_time: z.number().optional().describe("Last XLog time from previous page (for 'pageable' pagination)"),
};

export function register(server: McpServer) {
  server.registerTool("get_raw_xlog", {
    title: "Get Raw XLog",
    description: "Get raw (non-decoded) XLog transaction data. Unlike search_transactions which returns decoded data, this returns raw XLog objects with hash IDs. Supports five modes: single lookup, GXID distributed trace, filtered search, pageable list, and real-time streaming. Use lookup_text to resolve hash IDs.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

type Args = {
  mode: "single" | "gxid" | "search" | "pageable" | "realtime";
  date?: string; txid?: string; gxid?: string; obj_hashes?: string;
  start_time_millis?: number; end_time_millis?: number;
  start_hms?: string; end_hms?: string;
  service?: string; ip?: string; login?: string; obj_hash?: number;
  xlog_loop?: number; xlog_index?: number;
  page_count?: number; last_txid?: number; last_xlog_time?: number;
};

async function handler(args: Args) {
  const warnings: string[] = [];
  let result: unknown;

  switch (args.mode) {
    case "single": {
      if (!args.date || !args.txid) return { content: [{ type: "text" as const, text: "Error: 'date' and 'txid' are required for single mode" }] };
      result = await catchWarn(client.getRawXLog(args.date, args.txid), null, warnings, "rawXLog");
      break;
    }
    case "gxid": {
      if (!args.date || !args.gxid) return { content: [{ type: "text" as const, text: "Error: 'date' and 'gxid' are required for gxid mode" }] };
      result = await catchWarn(client.getRawXLogByGxid(args.date, args.gxid), null, warnings, "rawXLogByGxid");
      break;
    }
    case "search": {
      if (!args.date) return { content: [{ type: "text" as const, text: "Error: 'date' is required for search mode" }] };
      const searchParams: Record<string, string> = {};
      if (args.start_time_millis) searchParams.startTimeMillis = String(args.start_time_millis);
      if (args.end_time_millis) searchParams.endTimeMillis = String(args.end_time_millis);
      if (args.start_hms) searchParams.startHms = args.start_hms;
      if (args.end_hms) searchParams.endHms = args.end_hms;
      if (args.service) searchParams.service = args.service;
      if (args.ip) searchParams.ip = args.ip;
      if (args.login) searchParams.login = args.login;
      if (args.obj_hash !== undefined) searchParams.objHash = String(args.obj_hash);
      result = await catchWarn(client.searchRawXLog(args.date, searchParams), null, warnings, "searchRawXLog");
      break;
    }
    case "pageable": {
      if (!args.date) return { content: [{ type: "text" as const, text: "Error: 'date' is required for pageable mode" }] };
      if (!args.obj_hashes) return { content: [{ type: "text" as const, text: "Error: 'obj_hashes' is required for pageable mode" }] };
      const pageParams: Record<string, string> = { objHashes: args.obj_hashes };
      if (args.start_time_millis) pageParams.startTimeMillis = String(args.start_time_millis);
      if (args.end_time_millis) pageParams.endTimeMillis = String(args.end_time_millis);
      if (args.start_hms) pageParams.startHms = args.start_hms;
      if (args.end_hms) pageParams.endHms = args.end_hms;
      if (args.page_count) pageParams.pageCount = String(args.page_count);
      if (args.last_txid) pageParams.lastTxid = String(args.last_txid);
      if (args.last_xlog_time) pageParams.lastXLogTime = String(args.last_xlog_time);
      result = await catchWarn(client.getPageableRawXLog(args.date, pageParams), null, warnings, "pageableRawXLog");
      break;
    }
    case "realtime": {
      let objHashes = args.obj_hashes;
      if (!objHashes) {
        const objects = await client.getObjects();
        objHashes = objects.filter(o => o.alive).map(o => o.objHash).join(",");
      }
      if (!objHashes) {
        return { content: [{ type: "text" as const, text: jsonStringify({ error: "No matching agents found for realtime mode" }) }] };
      }
      const loop = args.xlog_loop ?? 0;
      const index = args.xlog_index ?? 0;
      result = await catchWarn(client.getRealtimeRawXLog(loop, index, objHashes), null, warnings, "realtimeRawXLog");
      break;
    }
  }

  const maskedResult = isMaskPiiEnabled() ? maskRawResult(result) : result;
  const output: Record<string, unknown> = { mode: args.mode, result: maskedResult };
  if (warnings.length > 0) output.warnings = warnings;
  if (isMaskPiiEnabled()) output.piiMasked = "Fields marked [masked] contain data that is hidden by SCOUTER_MASK_PII. Disable this env var to see actual values.";

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
