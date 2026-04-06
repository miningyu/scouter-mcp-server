import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, catchWarn, resolveObjType } from "../client/index.js";
import { parseTimeToMillis, minutesAgo, now, millisToIso, millisToYmd } from "../time-utils.js";
import { truncate, pctOfTotal, buildResponse, resolveSummaryNames } from "./shared-utils.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter (e.g., 'tomcat'). Ignored if obj_hash is provided."),
  obj_hash: z.number().optional().describe("Specific agent object hash. Overrides obj_type."),
  start_time: z.string().optional().describe("Start time. Defaults to 1 hour ago."),
  end_time: z.string().optional().describe("End time. Defaults to now."),
  max_count: z.number().optional().default(30).describe("Max items to return"),
};

export function register(server: McpServer) {
  server.registerTool("get_user_agent_summary", {
    title: "Get User Agent Summary",
    description: "Analyze request distribution by browser/user-agent. Shows which clients (browsers, bots, mobile apps) generate the most traffic. Useful for understanding client demographics and detecting crawlers.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface UaSummaryItem {
  summaryKeyName: string;
  count: number;
}

async function handler(args: {
  obj_type?: string; obj_hash?: number; start_time?: string; end_time?: string; max_count?: number;
}) {
  const warnings: string[] = [];
  const startMillis = parseTimeToMillis(args.start_time, minutesAgo(60));
  const endMillis = parseTimeToMillis(args.end_time, now());
  const limit = args.max_count ?? 30;

  let allUas: UaSummaryItem[];
  if (args.obj_hash !== undefined) {
    allUas = await catchWarn(
      client.getSummaryByObjHash("userAgent", args.obj_hash, startMillis, endMillis) as Promise<UaSummaryItem[]>,
      [], warnings, `userAgentSummary(obj:${args.obj_hash})`,
    );
  } else {
    const objTypes = await resolveObjType(args.obj_type);
    const results = await Promise.all(
      objTypes.map(type => catchWarn(
        client.getSummary("userAgent", type, startMillis, endMillis) as Promise<UaSummaryItem[]>,
        [], warnings, `userAgentSummary(${type})`,
      )),
    );
    allUas = results.flat();
  }

  await resolveSummaryNames(allUas, "ua", millisToYmd(startMillis));

  const totalRequests = allUas.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

  const enriched = allUas
    .map(item => {
      const count = Number(item.count) || 0;
      return {
        userAgent: truncate(item.summaryKeyName, 150),
        count,
        pctOfTotal: pctOfTotal(count, totalRequests),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const output: Record<string, unknown> = {
    timeRange: { start: millisToIso(startMillis), end: millisToIso(endMillis) },
    totalRequests,
    uniqueUserAgents: allUas.length,
    userAgents: enriched,
  };
  return buildResponse(output, warnings);
}
