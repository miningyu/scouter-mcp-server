import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, resolveObjType } from "../client/index.js";
import { parseTimeToMillis, minutesAgo, now, millisToIso, millisToYmd } from "../time-utils.js";
import { resolveSummaryNames } from "./shared-utils.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter. Ignored if obj_hash is provided."),
  obj_hash: z.number().optional().describe("Specific agent object hash. Overrides obj_type."),
  start_time: z.string().optional().describe("Start time. Defaults to 1 hour ago."),
  end_time: z.string().optional().describe("End time. Defaults to now."),
  sort_by: z.enum(["elapsed_sum", "count", "avg_elapsed", "error_count"]).optional().default("elapsed_sum").describe("Sort criteria"),
  max_count: z.number().optional().default(30).describe("Max SQL items to return (max 100)"),
};

export function register(server: McpServer) {
  server.registerTool("get_sql_analysis", {
    title: "Get SQL Analysis",
    description: "Analyze SQL performance within a time range. Returns SQL statements ranked by total elapsed time, showing execution counts, error counts, and average execution time. Use when investigating database-related performance issues.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface SqlSummaryItem {
  summaryKeyName: string;
  count: number;
  errorCount: number;
  elapsedSum: number;
}

async function handler(args: {
  obj_type?: string; obj_hash?: number; start_time?: string; end_time?: string;
  sort_by?: string; max_count?: number;
}) {
  const warnings: string[] = [];
  const startMillis = parseTimeToMillis(args.start_time, minutesAgo(60));
  const endMillis = parseTimeToMillis(args.end_time, now());
  const limit = Math.min(args.max_count ?? 30, 100);

  let allSqls: SqlSummaryItem[];
  if (args.obj_hash !== undefined) {
    allSqls = await catchWarn(
      client.getSummaryByObjHash("sql", args.obj_hash, startMillis, endMillis) as Promise<SqlSummaryItem[]>,
      [], warnings, `sqlSummary(obj:${args.obj_hash})`,
    );
  } else {
    const objTypes = await resolveObjType(args.obj_type);
    const results = await Promise.all(
      objTypes.map(type => catchWarn(
        client.getSummary("sql", type, startMillis, endMillis) as Promise<SqlSummaryItem[]>,
        [], warnings, `sqlSummary(${type})`,
      )),
    );
    allSqls = results.flat();
  }

  const queryDate = millisToYmd(startMillis);
  const unresolvedCount = await resolveSummaryNames(allSqls, "sql", queryDate);
  if (unresolvedCount > 0) {
    warnings.push(`${unresolvedCount} SQL hash(es) could not be resolved to text. Try lookup_text with date=${queryDate} and type=sql.`);
  }

  const totalElapsed = allSqls.reduce((sum, s) => sum + (Number(s.elapsedSum) || 0), 0);
  const totalCount = allSqls.reduce((sum, s) => sum + (Number(s.count) || 0), 0);

  const enriched = allSqls.map(s => {
    const count = Number(s.count) || 0;
    const errorCount = Number(s.errorCount) || 0;
    const elapsedSum = Number(s.elapsedSum) || 0;
    return {
      sql: s.summaryKeyName,
      count, errorCount, elapsedSum,
      avgElapsed: count > 0 ? Math.round(elapsedSum / count) : 0,
      pctOfTotalElapsed: totalElapsed > 0 ? +(elapsedSum / totalElapsed * 100).toFixed(2) : 0,
    };
  });

  const sortKey = args.sort_by ?? "elapsed_sum";
  const sortFn = (a: typeof enriched[0], b: typeof enriched[0]) => {
    switch (sortKey) {
      case "count": return b.count - a.count;
      case "avg_elapsed": return b.avgElapsed - a.avgElapsed;
      case "error_count": return b.errorCount - a.errorCount;
      default: return b.elapsedSum - a.elapsedSum;
    }
  };

  const output: Record<string, unknown> = {
    timeRange: { start: millisToIso(startMillis), end: millisToIso(endMillis) },
    totalSqlCount: totalCount,
    totalSqlElapsed: totalElapsed,
    sqls: enriched.sort(sortFn).slice(0, limit),
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
