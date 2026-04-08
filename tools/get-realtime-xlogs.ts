import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";
import { millisToIso } from "../time-utils.js";
import { resolveHashes, resolveOrHash, compactXLog, isMaskPiiEnabled } from "./shared-utils.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter (e.g., 'tomcat')"),
  obj_hashes: z.string().optional().describe("Comma-separated object hashes. If omitted, uses all alive agents."),
  xlog_loop: z.number().optional().default(0).describe("Loop offset from previous response for pagination. Start with 0."),
  xlog_index: z.number().optional().default(0).describe("Index offset from previous response for pagination. Start with 0."),
};

export function register(server: McpServer) {
  server.registerTool("get_realtime_xlogs", {
    title: "Get Realtime XLogs",
    description: "Get recent real-time transaction data (XLogs) produced since the given offsets. Returns decoded XLog entries with loop/index offsets for subsequent polling. Use offset 0/0 for the first call, then pass returned offsets to get newer data.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
  }, handler);
}

interface RealtimeXLogResult {
  xlogs?: unknown[];
  xlogLoop?: number;
  xlogIndex?: number;
  [key: string]: unknown;
}

async function handler(args: {
  obj_type?: string; obj_hashes?: string;
  xlog_loop?: number; xlog_index?: number;
}) {
  const warnings: string[] = [];
  const offset1 = args.xlog_loop ?? 0;
  const offset2 = args.xlog_index ?? 0;

  let objHashes = args.obj_hashes;
  if (!objHashes) {
    const objects = await client.getObjects();
    const filtered = args.obj_type
      ? objects.filter(o => o.alive && o.objType === args.obj_type)
      : objects.filter(o => o.alive);
    objHashes = filtered.map(o => o.objHash).join(",");
  }

  if (!objHashes) {
    return { content: [{ type: "text" as const, text: jsonStringify({ error: "No matching agents found" }) }] };
  }

  const result = await catchWarn(
    client.getRealtimeXLogData(offset1, offset2, objHashes) as Promise<RealtimeXLogResult>,
    { xlogs: [], xlogLoop: 0, xlogIndex: 0 }, warnings, "realtimeXLog",
  );

  const xlogs = (result.xlogs ?? []) as Array<Record<string, unknown>>;

  const serviceHashes = xlogs.map(x => Number(x.service) || 0).filter(h => h !== 0);
  if (serviceHashes.length > 0) {
    const serviceMap = await resolveHashes(serviceHashes, "service");
    for (const xlog of xlogs) {
      const hash = Number(xlog.service) || 0;
      if (hash !== 0) xlog.serviceName = resolveOrHash(hash, serviceMap);
    }
  }

  const maskedXlogs = xlogs.map(x => compactXLog(x as Record<string, unknown>));
  const sorted = maskedXlogs.sort((a, b) => (Number(b.elapsed) || 0) - (Number(a.elapsed) || 0));
  const errorCount = sorted.filter(x => x.error).length;

  const output: Record<string, unknown> = {
    timestamp: millisToIso(Date.now()),
    xlogCount: sorted.length,
    errorCount,
    nextOffsets: { xlogLoop: result.xlogLoop ?? 0, xlogIndex: result.xlogIndex ?? 0 },
    xlogs: sorted.slice(0, 30),
  };
  if (sorted.length > 30) output.truncatedFrom = sorted.length;
  if (warnings.length > 0) output.warnings = warnings;
  if (isMaskPiiEnabled()) output.piiMasked = "Fields marked [masked] contain data that is hidden by SCOUTER_MASK_PII. Disable this env var to see actual values.";

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
