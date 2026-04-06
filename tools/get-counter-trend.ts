import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, resolveObjType } from "../client/index.js";
import { parseTimeToMillis, minutesAgo, now, formatYmd, millisToIso } from "../time-utils.js";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const MAX_DATAPOINTS_PER_SERIES = 200;
const MAX_DATAPOINTS_LATEST = 60;

export const params = {
  counter: z.string().describe("Counter name: TPS, ElapsedTime, Elapsed90%, ActiveService, ErrorRate, HeapUsed, HeapTotal, ProcCpu, GcCount, GcTime, Cpu, Mem, etc."),
  obj_type: z.string().optional().describe("Object type filter (e.g., 'tomcat'). Ignored if obj_hashes is provided."),
  obj_hashes: z.string().optional().describe("Comma-separated object hashes for specific agents. Overrides obj_type."),
  latest_sec: z.number().optional().describe("Get counter values for the latest N seconds. When provided, start_time/end_time are ignored."),
  start_time: z.string().optional().describe("Start time. Defaults to 30 minutes ago."),
  end_time: z.string().optional().describe("End time. Defaults to now."),
};

export function register(server: McpServer) {
  server.registerTool("get_counter_trend", {
    title: "Get Counter Trend",
    description: "Get historical counter values over a time range for trend analysis. Supports TPS, ElapsedTime, HeapUsed, ProcCpu, GcCount, Cpu, Mem, and more. Use latest_sec for quick recent data (e.g., last 60s), or start_time/end_time for custom ranges. Auto-selects precision: 2-second for <=2h, 5-minute for >2h. Large datasets are auto-sampled.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface CounterData {
  objName?: string;
  objHash?: number;
  valueList?: Array<{ time: number; value: number }>;
  [key: string]: unknown;
}

function sampleDataPoints(points: Array<{ time: number; value: number }>, maxPoints: number): Array<{ time: number; value: number }> {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const sampled: Array<{ time: number; value: number }> = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(points[Math.floor(i * step)]);
  }
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }
  return sampled;
}

async function handler(args: { counter: string; obj_type?: string; obj_hashes?: string; latest_sec?: number; start_time?: string; end_time?: string }) {
  const warnings: string[] = [];

  if (args.latest_sec !== undefined) {
    return handleLatest(args.counter, args.obj_type, args.obj_hashes, args.latest_sec, warnings);
  }

  const startMillis = parseTimeToMillis(args.start_time, minutesAgo(30));
  const endMillis = parseTimeToMillis(args.end_time, now());
  const range = endMillis - startMillis;

  const useStatApi = range > TWO_HOURS_MS;
  const precision = useStatApi ? "5min" : "2sec";

  let results: unknown[];
  if (args.obj_hashes) {
    if (useStatApi) {
      const fromYmd = formatYmd(new Date(startMillis));
      const toYmd = formatYmd(new Date(endMillis));
      results = [await catchWarn(
        client.getCounterStatByObjHashes(args.counter, args.obj_hashes, fromYmd, toYmd),
        [], warnings, "counterStat(objHashes)",
      )];
    } else {
      results = [await catchWarn(
        client.getCounterHistoryByObjHashes(args.counter, args.obj_hashes, startMillis, endMillis),
        [], warnings, "counterHistory(objHashes)",
      )];
    }
  } else {
    const objTypes = await resolveObjType(args.obj_type);
    results = await Promise.all(
      objTypes.map(async (type) => {
        if (useStatApi) {
          const fromYmd = formatYmd(new Date(startMillis));
          const toYmd = formatYmd(new Date(endMillis));
          return catchWarn(client.getCounterStat(args.counter, type, fromYmd, toYmd), [], warnings, `counterStat(${type})`);
        }
        return catchWarn(client.getCounterHistory(args.counter, type, startMillis, endMillis), [], warnings, `counterHistory(${type})`);
      }),
    );
  }

  const series = (results.flat() as CounterData[]).map(entry => {
    const rawPoints = entry.valueList ?? [];
    const values = rawPoints.map(v => v.value);
    const sampled = sampleDataPoints(rawPoints, MAX_DATAPOINTS_PER_SERIES);
    const wasSampled = sampled.length < rawPoints.length;
    return {
      objName: entry.objName,
      objHash: entry.objHash,
      dataPoints: sampled,
      ...(wasSampled ? { originalCount: rawPoints.length, sampledTo: sampled.length } : {}),
      stats: {
        min: values.length > 0 ? Math.min(...values) : 0,
        max: values.length > 0 ? Math.max(...values) : 0,
        avg: values.length > 0 ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : 0,
        latest: values[values.length - 1] ?? 0,
      },
    };
  });

  const output: Record<string, unknown> = {
    counter: args.counter,
    precision,
    timeRange: { start: millisToIso(startMillis), end: millisToIso(endMillis) },
    series,
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}

async function handleLatest(counter: string, objType: string | undefined, objHashes: string | undefined, latestSec: number, warnings: string[]) {
  let results: unknown[];
  if (objHashes) {
    results = [await catchWarn(
      client.getLatestCounterByObjHashes(counter, objHashes, latestSec),
      [], warnings, "counterLatest(objHashes)",
    )];
  } else {
    const objTypes = await resolveObjType(objType);
    results = await Promise.all(
      objTypes.map(async (type) =>
        catchWarn(client.getLatestCounter(counter, type, latestSec), [], warnings, `counterLatest(${type})`),
      ),
    );
  }

  const series = (results.flat() as CounterData[]).map(entry => {
    const rawPoints = entry.valueList ?? [];
    const values = rawPoints.map(v => v.value);
    const sampled = sampleDataPoints(rawPoints, MAX_DATAPOINTS_LATEST);
    const wasSampled = sampled.length < rawPoints.length;
    return {
      objName: entry.objName,
      objHash: entry.objHash,
      dataPoints: sampled,
      ...(wasSampled ? { originalCount: rawPoints.length, sampledTo: sampled.length } : {}),
      stats: {
        min: values.length > 0 ? Math.min(...values) : 0,
        max: values.length > 0 ? Math.max(...values) : 0,
        avg: values.length > 0 ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : 0,
        latest: values[values.length - 1] ?? 0,
      },
    };
  });

  const output: Record<string, unknown> = {
    counter,
    precision: "2sec",
    latestSec,
    series,
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
