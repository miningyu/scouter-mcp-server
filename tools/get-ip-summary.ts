import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, catchWarn, resolveObjType } from "../client/index.js";
import { parseTimeToMillis, minutesAgo, now, millisToIso, millisToYmd } from "../time-utils.js";
import { pctOfTotal, buildResponse, resolveSummaryNames } from "./shared-utils.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter (e.g., 'tomcat'). Ignored if obj_hash is provided."),
  obj_hash: z.number().optional().describe("Specific agent object hash. Overrides obj_type."),
  start_time: z.string().optional().describe("Start time. Defaults to 1 hour ago."),
  end_time: z.string().optional().describe("End time. Defaults to now."),
  max_count: z.number().optional().default(50).describe("Max items to return"),
};

export function register(server: McpServer) {
  server.registerTool("get_ip_summary", {
    title: "Get IP Summary",
    description: "Analyze request distribution by client IP address. Shows which IPs generate the most traffic. Useful for identifying heavy users, bots, or potential DDoS sources.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface IpSummaryItem {
  summaryKeyName: string;
  count: number;
}

async function handler(args: {
  obj_type?: string; obj_hash?: number; start_time?: string; end_time?: string; max_count?: number;
}) {
  const warnings: string[] = [];
  const startMillis = parseTimeToMillis(args.start_time, minutesAgo(60));
  const endMillis = parseTimeToMillis(args.end_time, now());
  const limit = args.max_count ?? 50;

  let allIps: IpSummaryItem[];
  if (args.obj_hash !== undefined) {
    allIps = await catchWarn(
      client.getSummaryByObjHash("ip", args.obj_hash, startMillis, endMillis) as Promise<IpSummaryItem[]>,
      [], warnings, `ipSummary(obj:${args.obj_hash})`,
    );
  } else {
    const objTypes = await resolveObjType(args.obj_type);
    const results = await Promise.all(
      objTypes.map(type => catchWarn(
        client.getSummary("ip", type, startMillis, endMillis) as Promise<IpSummaryItem[]>,
        [], warnings, `ipSummary(${type})`,
      )),
    );
    allIps = results.flat();
  }

  await resolveSummaryNames(allIps, "ip", millisToYmd(startMillis));

  const totalRequests = allIps.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

  const enriched = allIps
    .map(item => {
      const count = Number(item.count) || 0;
      return {
        ip: item.summaryKeyName,
        count,
        pctOfTotal: pctOfTotal(count, totalRequests),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const output: Record<string, unknown> = {
    timeRange: { start: millisToIso(startMillis), end: millisToIso(endMillis) },
    totalRequests,
    uniqueIps: allIps.length,
    ips: enriched,
  };
  return buildResponse(output, warnings);
}
