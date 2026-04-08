import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";
import { todayYmd, parseTimeToMillis, minutesAgo, now, millisToYmdHms } from "../time-utils.js";
import { resolveHashes, resolveOrHash, compactXLog, isMaskPiiEnabled } from "./shared-utils.js";

export const params = {
  date: z.string().optional().describe("Date in YYYYMMDD format. Defaults to today."),
  start_time: z.string().optional().describe("Start time (ISO, HHmmss, or epoch ms). Defaults to 10 minutes ago."),
  end_time: z.string().optional().describe("End time. Defaults to now."),
  service: z.string().optional().describe("Service name pattern filter (partial match)"),
  ip: z.string().optional().describe("Client IP filter"),
  login: z.string().optional().describe("Login ID filter"),
  obj_hashes: z.string().optional().describe("Comma-separated object hashes"),
  max_count: z.number().optional().default(50).describe("Max transactions to return (max 500)"),
};

export function register(server: McpServer) {
  server.registerTool("search_transactions", {
    title: "Search Transactions",
    description: "Search for transactions (XLogs) within a time range. Find slow transactions, error transactions, or filter by service name/IP/login. Returns list sorted by elapsed time descending with summary statistics. Primary tool for 'why is it slow?' investigations.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface XLogEntry {
  elapsed: number;
  error?: string;
  sqlCount?: number;
  sqlTime?: number;
  [key: string]: unknown;
}

async function handler(args: {
  date?: string; start_time?: string; end_time?: string;
  service?: string; ip?: string; login?: string;
  obj_hashes?: string; max_count?: number;
}) {
  const warnings: string[] = [];
  const date = args.date || todayYmd();
  const startMillis = parseTimeToMillis(args.start_time, minutesAgo(10), date);
  const endMillis = parseTimeToMillis(args.end_time, now(), date);
  const limit = Math.min(args.max_count ?? 50, 500);

  let objHashes = args.obj_hashes;
  if (!objHashes) {
    const objects = await client.getObjects();
    const isToday = date === todayYmd();
    const targets = isToday ? objects.filter(o => o.alive) : objects;
    objHashes = targets.map(o => o.objHash).join(",");
  }

  let transactions: XLogEntry[];

  if (args.service || args.ip || args.login) {
    const searchParams: Record<string, string> = {
      startTimeMillis: String(startMillis),
      endTimeMillis: String(endMillis),
      objHashes,
    };
    if (args.service) searchParams.service = args.service;
    if (args.ip) searchParams.ip = args.ip;
    if (args.login) searchParams.login = args.login;
    transactions = await catchWarn(
      client.searchXLogData(date, searchParams) as Promise<XLogEntry[]>,
      [], warnings, "searchXLog"
    );
  } else {
    transactions = await catchWarn(
      client.getXLogData(date, startMillis, endMillis, objHashes) as Promise<XLogEntry[]>,
      [], warnings, "getXLog"
    );
  }

  const sorted = transactions
    .sort((a, b) => Number(b.elapsed) - Number(a.elapsed))
    .slice(0, limit);

  const serviceHashes = sorted.map(t => Number(t.service) || 0).filter(h => h !== 0);
  const errorHashes = sorted.map(t => Number(t.error) || 0).filter(h => h !== 0);
  const [serviceMap, errorMap] = await Promise.all([
    resolveHashes(serviceHashes, "service", date),
    resolveHashes(errorHashes, "error", date),
  ]);
  const resolved = sorted.map(t => compactXLog({
    ...t,
    serviceName: resolveOrHash(Number(t.service) || 0, serviceMap),
    errorMessage: Number(t.error) ? resolveOrHash(Number(t.error), errorMap) : undefined,
  }));

  const elapsedValues = sorted.map(t => Number(t.elapsed) || 0).sort((a, b) => a - b);
  const errorCount = sorted.filter(t => t.error).length;

  const output: Record<string, unknown> = {
    searchRange: {
      date,
      startTime: millisToYmdHms(startMillis),
      endTime: millisToYmdHms(endMillis),
    },
    totalFound: transactions.length,
    returned: sorted.length,
    transactions: resolved,
    statistics: {
      totalCount: transactions.length,
      errorCount,
      avgElapsed: elapsedValues.length > 0 ? Math.round(elapsedValues.reduce((a, b) => a + b, 0) / elapsedValues.length) : 0,
      maxElapsed: elapsedValues[elapsedValues.length - 1] ?? 0,
      p90Elapsed: elapsedValues.length > 0 ? elapsedValues[Math.floor(elapsedValues.length * 0.9)] : 0,
      avgSqlCount: sorted.length > 0 ? +(sorted.reduce((a, t) => a + (t.sqlCount ?? 0), 0) / sorted.length).toFixed(1) : 0,
      avgSqlTime: sorted.length > 0 ? Math.round(sorted.reduce((a, t) => a + (t.sqlTime ?? 0), 0) / sorted.length) : 0,
    },
  };
  if (warnings.length > 0) output.warnings = warnings;
  if (isMaskPiiEnabled()) output.piiMasked = "Fields marked [masked] contain data that is hidden by SCOUTER_MASK_PII. Disable this env var to see actual values.";

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
