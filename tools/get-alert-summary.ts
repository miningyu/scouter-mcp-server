import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, resolveObjType } from "../client/index.js";
import { parseTimeToMillis, minutesAgo, now, millisToIso } from "../time-utils.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter (e.g., 'tomcat'). Ignored if obj_hash is provided."),
  obj_hash: z.number().optional().describe("Specific agent object hash. Overrides obj_type."),
  start_time: z.string().optional().describe("Start time. Defaults to 1 hour ago."),
  end_time: z.string().optional().describe("End time. Defaults to now."),
  max_count: z.number().optional().default(50).describe("Max items to return"),
};

export function register(server: McpServer) {
  server.registerTool("get_alert_summary", {
    title: "Get Alert Summary",
    description: "Get aggregated alert statistics within a time range. Shows which alert types fired most frequently. Use alongside get_system_overview (which shows recent real-time alerts) for historical alert pattern analysis.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface AlertSummaryItem {
  summaryKeyName: string;
  count: number;
  errorCount?: number;
}

async function handler(args: {
  obj_type?: string; obj_hash?: number; start_time?: string; end_time?: string; max_count?: number;
}) {
  const warnings: string[] = [];
  const startMillis = parseTimeToMillis(args.start_time, minutesAgo(60));
  const endMillis = parseTimeToMillis(args.end_time, now());
  const limit = args.max_count ?? 50;

  let allAlerts: AlertSummaryItem[];
  if (args.obj_hash !== undefined) {
    allAlerts = await catchWarn(
      client.getSummaryByObjHash("alert", args.obj_hash, startMillis, endMillis) as Promise<AlertSummaryItem[]>,
      [], warnings, `alertSummary(obj:${args.obj_hash})`,
    );
  } else {
    const objTypes = await resolveObjType(args.obj_type);
    const results = await Promise.all(
      objTypes.map(type => catchWarn(
        client.getSummary("alert", type, startMillis, endMillis) as Promise<AlertSummaryItem[]>,
        [], warnings, `alertSummary(${type})`,
      )),
    );
    allAlerts = results.flat();
  }

  const totalAlertCount = allAlerts.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

  const enriched = allAlerts
    .map(item => ({
      alertTitle: item.summaryKeyName,
      count: Number(item.count) || 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const output: Record<string, unknown> = {
    timeRange: { start: millisToIso(startMillis), end: millisToIso(endMillis) },
    totalAlertCount,
    uniqueAlertTypes: allAlerts.length,
    alerts: enriched,
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
