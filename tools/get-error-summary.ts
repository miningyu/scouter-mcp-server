import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, resolveObjType } from "../client/index.js";
import { parseTimeToMillis, minutesAgo, now, millisToIso, millisToYmd } from "../time-utils.js";
import { resolveSummaryNames, resolveHashes, resolveOrHash } from "./shared-utils.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter. Ignored if obj_hash is provided."),
  obj_hash: z.number().optional().describe("Specific agent object hash. Overrides obj_type."),
  start_time: z.string().optional().describe("Start time. Defaults to 1 hour ago."),
  end_time: z.string().optional().describe("End time. Defaults to now."),
};

export function register(server: McpServer) {
  server.registerTool("get_error_summary", {
    title: "Get Error Summary",
    description: "Analyze errors within a time range. Returns error types ranked by frequency with error messages, stack traces, and sample transaction IDs for drill-down. Also shows per-service error rates for context.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface SummaryItem {
  count?: number;
  errorCount?: number;
  summaryKeyName?: string;
  elapsedSum?: number;
  [key: string]: unknown;
}

async function handler({ obj_type, obj_hash, start_time, end_time }: { obj_type?: string; obj_hash?: number; start_time?: string; end_time?: string }) {
  const warnings: string[] = [];
  const startMillis = parseTimeToMillis(start_time, minutesAgo(60));
  const endMillis = parseTimeToMillis(end_time, now());

  let allErrors: SummaryItem[];
  let allServices: SummaryItem[];
  if (obj_hash !== undefined) {
    const [errors, services] = await Promise.all([
      catchWarn(client.getSummaryByObjHash("error", obj_hash, startMillis, endMillis), [], warnings, `errorSummary(obj:${obj_hash})`),
      catchWarn(client.getSummaryByObjHash("service", obj_hash, startMillis, endMillis), [], warnings, `serviceSummary(obj:${obj_hash})`),
    ]);
    allErrors = errors as SummaryItem[];
    allServices = services as SummaryItem[];
  } else {
    const objTypes = await resolveObjType(obj_type);
    const results = await Promise.all(
      objTypes.map(async (type) => {
        const [errors, services] = await Promise.all([
          catchWarn(client.getSummary("error", type, startMillis, endMillis), [], warnings, `errorSummary(${type})`),
          catchWarn(client.getSummary("service", type, startMillis, endMillis), [], warnings, `serviceSummary(${type})`),
        ]);
        return { errors, services };
      }),
    );
    allErrors = results.flatMap(r => r.errors as SummaryItem[]);
    allServices = results.flatMap(r => r.services as SummaryItem[]);
  }

  const queryDate = millisToYmd(startMillis);
  await Promise.all([
    resolveSummaryNames(allErrors, "service", queryDate),
    resolveSummaryNames(allServices, "service", queryDate),
  ]);

  const errorHashes = allErrors
    .map(e => Number((e as Record<string, unknown>).errorHash) || 0)
    .filter(h => h !== 0);
  if (errorHashes.length > 0) {
    const errorTextMap = await resolveHashes(errorHashes, "error", queryDate);
    for (const item of allErrors) {
      const hash = Number((item as Record<string, unknown>).errorHash) || 0;
      if (hash !== 0) {
        (item as Record<string, unknown>).errorMessage = resolveOrHash(hash, errorTextMap);
      }
    }
  }

  const n = (v: unknown) => Number(v) || 0;
  const totalTransactions = allServices.reduce((sum, s) => sum + n(s.count), 0);
  const totalErrors = allErrors.reduce((sum, e) => sum + n(e.count), 0);

  const serviceErrorRates = allServices
    .filter(s => n(s.errorCount) > 0)
    .map(s => ({
      service: s.summaryKeyName,
      totalCount: n(s.count),
      errorCount: n(s.errorCount),
      errorRate: n(s.count) > 0 ? +(n(s.errorCount) / n(s.count) * 100).toFixed(2) : 0,
    }))
    .sort((a, b) => b.errorCount - a.errorCount);

  const output: Record<string, unknown> = {
    timeRange: { start: millisToIso(startMillis), end: millisToIso(endMillis) },
    totalErrors,
    totalTransactions,
    overallErrorRate: totalTransactions > 0 ? +(totalErrors / totalTransactions * 100).toFixed(2) : 0,
    errors: (allErrors as SummaryItem[]).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 30),
    serviceErrorRates: serviceErrorRates.slice(0, 30),
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
