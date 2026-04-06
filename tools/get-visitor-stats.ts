import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, resolveObjType } from "../client/index.js";
import { parseTimeToMillis, minutesAgo, now, millisToIso, todayYmd } from "../time-utils.js";

export const params = {
  mode: z.enum(["realtime", "daily", "hourly", "group"]).optional().default("realtime")
    .describe("realtime: current visitor count, daily: total for a date, hourly: hourly breakdown, group: total visitors for multiple agents over a time range"),
  obj_type: z.string().optional().describe("Object type filter (e.g., 'tomcat'). Ignored if obj_hash or obj_hashes is provided."),
  obj_hash: z.number().optional().describe("Specific agent object hash. Overrides obj_type for realtime/daily modes."),
  obj_hashes: z.string().optional().describe("Comma-separated object hashes. Used for realtime (multi-agent total) and group modes."),
  date: z.string().optional().describe("Date in YYYYMMDD format. Used for daily mode. Defaults to today."),
  start_time: z.string().optional().describe("Start time for hourly/group modes. Defaults to 6 hours ago."),
  end_time: z.string().optional().describe("End time for hourly/group modes. Defaults to now."),
};

export function register(server: McpServer) {
  server.registerTool("get_visitor_stats", {
    title: "Get Visitor Stats",
    description: "Get unique visitor (user) statistics. Supports real-time current visitor count, daily totals, or hourly breakdown. Useful for understanding traffic patterns and user activity.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

async function handler(args: {
  mode?: string; obj_type?: string; obj_hash?: number; obj_hashes?: string; date?: string;
  start_time?: string; end_time?: string;
}) {
  const mode = args.mode ?? "realtime";
  const warnings: string[] = [];

  if (mode === "realtime") {
    return handleRealtime(args.obj_type, args.obj_hash, args.obj_hashes, warnings);
  }
  if (mode === "daily") {
    return handleDaily(args.obj_type, args.obj_hash, args.date, warnings);
  }
  if (mode === "group") {
    return handleGroup(args.obj_type, args.obj_hashes, args.start_time, args.end_time, warnings);
  }
  return handleHourly(args.obj_type, args.start_time, args.end_time, warnings);
}

async function handleRealtime(objType: string | undefined, objHash: number | undefined, objHashes: string | undefined, warnings: string[]) {
  if (objHashes) {
    const count = await catchWarn(
      client.getVisitorRealtimeByObjHashes(objHashes), 0, warnings, `visitorRealtime(hashes:${objHashes})`,
    );
    const output: Record<string, unknown> = {
      mode: "realtime",
      timestamp: millisToIso(Date.now()),
      objHashes,
      total: Number(count) || 0,
    };
    if (warnings.length > 0) output.warnings = warnings;
    return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
  }
  if (objHash !== undefined) {
    const count = await catchWarn(
      client.getVisitorRealtimeByObjHash(objHash), 0, warnings, `visitorRealtime(obj:${objHash})`,
    );
    const output: Record<string, unknown> = {
      mode: "realtime",
      timestamp: millisToIso(Date.now()),
      visitors: [{ objHash, count: Number(count) || 0 }],
      total: Number(count) || 0,
    };
    if (warnings.length > 0) output.warnings = warnings;
    return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
  }
  const objTypes = await resolveObjType(objType);
  const results = await Promise.all(
    objTypes.map(async (type) => {
      const count = await catchWarn(
        client.getVisitorRealtimeByObjType(type), 0, warnings, `visitorRealtime(${type})`,
      );
      return { objType: type, count: Number(count) || 0 };
    }),
  );
  const total = results.reduce((sum, r) => sum + r.count, 0);

  const output: Record<string, unknown> = {
    mode: "realtime",
    timestamp: millisToIso(Date.now()),
    visitors: results,
    total,
  };
  if (warnings.length > 0) output.warnings = warnings;
  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}

async function handleDaily(objType: string | undefined, objHash: number | undefined, date: string | undefined, warnings: string[]) {
  const targetDate = date ?? todayYmd();
  if (objHash !== undefined) {
    const count = await catchWarn(
      client.getVisitorDailyByObjHash(objHash, targetDate), 0, warnings, `visitorDaily(obj:${objHash})`,
    );
    const output: Record<string, unknown> = {
      mode: "daily",
      date: targetDate,
      visitors: [{ objHash, count: Number(count) || 0 }],
      total: Number(count) || 0,
    };
    if (warnings.length > 0) output.warnings = warnings;
    return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
  }
  const objTypes = await resolveObjType(objType);
  const results = await Promise.all(
    objTypes.map(async (type) => {
      const count = await catchWarn(
        client.getVisitorDailyByObjType(type, targetDate), 0, warnings, `visitorDaily(${type})`,
      );
      return { objType: type, count: Number(count) || 0 };
    }),
  );
  const total = results.reduce((sum, r) => sum + r.count, 0);

  const output: Record<string, unknown> = {
    mode: "daily",
    date: targetDate,
    visitors: results,
    total,
  };
  if (warnings.length > 0) output.warnings = warnings;
  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}

async function handleHourly(
  objType: string | undefined, startTime: string | undefined, endTime: string | undefined, warnings: string[],
) {
  const startMillis = parseTimeToMillis(startTime, minutesAgo(360));
  const endMillis = parseTimeToMillis(endTime, now());

  const objects = await client.getObjects();
  const filtered = objType
    ? objects.filter(o => o.alive && o.objType === objType)
    : objects.filter(o => o.alive);
  if (filtered.length === 0) {
    return { content: [{ type: "text" as const, text: jsonStringify({ mode: "hourly", error: "No matching agents found" }) }] };
  }

  const objHashes = filtered.map(o => o.objHash).join(",");
  const hourlyData = await catchWarn(
    client.getVisitorHourly(objHashes, startMillis, endMillis),
    [], warnings, "visitorHourly",
  );

  const output: Record<string, unknown> = {
    mode: "hourly",
    timeRange: { start: millisToIso(startMillis), end: millisToIso(endMillis) },
    agents: filtered.map(o => o.objName),
    hourlyData,
  };
  if (warnings.length > 0) output.warnings = warnings;
  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}

async function handleGroup(
  objType: string | undefined, objHashes: string | undefined,
  startTime: string | undefined, endTime: string | undefined, warnings: string[],
) {
  const startMillis = parseTimeToMillis(startTime, minutesAgo(360));
  const endMillis = parseTimeToMillis(endTime, now());

  let hashes = objHashes;
  if (!hashes) {
    const objects = await client.getObjects();
    const filtered = objType
      ? objects.filter(o => o.alive && o.objType === objType)
      : objects.filter(o => o.alive);
    if (filtered.length === 0) {
      return { content: [{ type: "text" as const, text: jsonStringify({ mode: "group", error: "No matching agents found" }) }] };
    }
    hashes = filtered.map(o => o.objHash).join(",");
  }

  const groupData = await catchWarn(
    client.getVisitorGroup(hashes, startMillis, endMillis),
    null, warnings, "visitorGroup",
  );

  const output: Record<string, unknown> = {
    mode: "group",
    timeRange: { start: millisToIso(startMillis), end: millisToIso(endMillis) },
    objHashes: hashes,
    groupData,
  };
  if (warnings.length > 0) output.warnings = warnings;
  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
