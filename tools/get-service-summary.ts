import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, catchWarn, resolveObjType } from "../client/index.js";
import { parseTimeToMillis, minutesAgo, now, millisToIso, millisToYmd } from "../time-utils.js";
import { truncate, enrichSummary, buildResponse, resolveSummaryNames } from "./shared-utils.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter. Ignored if obj_hash is provided."),
  obj_hash: z.number().optional().describe("Specific agent object hash. Overrides obj_type."),
  start_time: z.string().optional().describe("Start time. Defaults to 1 hour ago."),
  end_time: z.string().optional().describe("End time. Defaults to now."),
  sort_by: z.enum(["count", "elapsed_sum", "avg_elapsed", "error_count", "error_rate"]).optional().default("count").describe("Sort criteria"),
  include_api_calls: z.boolean().optional().default(true).describe("Include external API call summary"),
  max_count: z.number().optional().default(30).describe("Max items to return"),
};

export function register(server: McpServer) {
  server.registerTool("get_service_summary", {
    title: "Get Service Summary",
    description: "Get aggregated service-level performance statistics. Shows which services are called most, have highest error rates, or consume most resources. Includes external API call summary for dependency analysis.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface ServiceItem {
  summaryKeyName: string;
  count: number;
  errorCount: number;
  elapsedSum: number;
  cpuSum: number;
  memorySum: number;
}

async function handler(args: {
  obj_type?: string; obj_hash?: number; start_time?: string; end_time?: string;
  sort_by?: string; include_api_calls?: boolean; max_count?: number;
}) {
  const warnings: string[] = [];
  const startMillis = parseTimeToMillis(args.start_time, minutesAgo(60));
  const endMillis = parseTimeToMillis(args.end_time, now());
  const limit = args.max_count ?? 30;

  let allServices: ServiceItem[];
  let allApiCalls: ServiceItem[];
  if (args.obj_hash !== undefined) {
    const serviceFetch = catchWarn(
      client.getSummaryByObjHash("service", args.obj_hash, startMillis, endMillis) as Promise<ServiceItem[]>,
      [], warnings, `serviceSummary(obj:${args.obj_hash})`,
    );
    const apiCallFetch = args.include_api_calls !== false
      ? catchWarn(
          client.getSummaryByObjHash("apiCall", args.obj_hash, startMillis, endMillis) as Promise<ServiceItem[]>,
          [], warnings, `apiCallSummary(obj:${args.obj_hash})`,
        )
      : Promise.resolve([] as ServiceItem[]);
    [allServices, allApiCalls] = await Promise.all([serviceFetch, apiCallFetch]);
  } else {
    const objTypes = await resolveObjType(args.obj_type);
    const results = await Promise.all(
      objTypes.map(async (type) => {
        const serviceFetch = catchWarn(
          client.getSummary("service", type, startMillis, endMillis) as Promise<ServiceItem[]>,
          [], warnings, `serviceSummary(${type})`,
        );
        const apiCallFetch = args.include_api_calls !== false
          ? catchWarn(
              client.getSummary("apiCall", type, startMillis, endMillis) as Promise<ServiceItem[]>,
              [], warnings, `apiCallSummary(${type})`,
            )
          : Promise.resolve([] as ServiceItem[]);
        return Promise.all([serviceFetch, apiCallFetch]);
      }),
    );
    allServices = results.flatMap(r => r[0]);
    allApiCalls = results.flatMap(r => r[1]);
  }

  const queryDate = millisToYmd(startMillis);
  await Promise.all([
    resolveSummaryNames(allServices, "service", queryDate),
    resolveSummaryNames(allApiCalls as ServiceItem[], "apicall", queryDate),
  ]);

  const enriched = allServices.map(s => ({
    service: s.summaryKeyName,
    ...enrichSummary(s),
  }));

  const sortKey = args.sort_by ?? "count";
  const sortFn = (a: typeof enriched[0], b: typeof enriched[0]) => {
    switch (sortKey) {
      case "elapsed_sum": return b.elapsedSum - a.elapsedSum;
      case "avg_elapsed": return b.avgElapsed - a.avgElapsed;
      case "error_count": return b.errorCount - a.errorCount;
      case "error_rate": return b.errorRate - a.errorRate;
      default: return b.count - a.count;
    }
  };

  const totalCalls = enriched.reduce((s, v) => s + v.count, 0);
  const totalErrors = enriched.reduce((s, v) => s + v.errorCount, 0);
  const totalElapsed = enriched.reduce((s, v) => s + v.elapsedSum, 0);

  const sortedApiCalls = (allApiCalls as ServiceItem[])
    .map(s => ({
      service: truncate(s.summaryKeyName, 120),
      count: Number(s.count) || 0,
      errorCount: Number(s.errorCount) || 0,
      elapsedSum: Number(s.elapsedSum) || 0,
      avgElapsed: (Number(s.count) || 0) > 0 ? Math.round((Number(s.elapsedSum) || 0) / (Number(s.count) || 1)) : 0,
    }))
    .sort((a, b) => b.elapsedSum - a.elapsedSum)
    .slice(0, limit);

  const output: Record<string, unknown> = {
    timeRange: { start: millisToIso(startMillis), end: millisToIso(endMillis) },
    services: enriched.sort(sortFn).slice(0, limit).map(s => ({ ...s, service: truncate(s.service, 120) })),
    apiCalls: sortedApiCalls,
    totals: {
      totalServiceCalls: totalCalls,
      totalErrors,
      overallAvgElapsed: totalCalls > 0 ? Math.round(totalElapsed / totalCalls) : 0,
      overallErrorRate: totalCalls > 0 ? +(totalErrors / totalCalls * 100).toFixed(2) : 0,
    },
  };
  return buildResponse(output, warnings);
}
