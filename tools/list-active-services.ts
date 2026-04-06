import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, resolveObjType } from "../client/index.js";
import { resolveHashes, resolveOrHash } from "./shared-utils.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter (e.g. 'tomcat')"),
  obj_hash: z.number().optional().describe("Specific agent object hash"),
  thread_id: z.number().optional().describe("Specific thread ID to get detailed info. Requires obj_hash."),
  min_elapsed_ms: z.number().optional().default(0).describe("Only show services running longer than this (ms)"),
};

export function register(server: McpServer) {
  server.registerTool("list_active_services", {
    title: "List Active Services",
    description: "Show all currently executing requests (in-flight transactions). Use when investigating hangs, slow conditions, or asking 'what is running right now'. Returns active services sorted by elapsed time descending.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface ActiveService {
  elapsed: number;
  mode: string;
  service?: number;
  serviceName?: string;
  [key: string]: unknown;
}

function unpackMapPackArrays(rawData: unknown[]): ActiveService[] {
  const results: ActiveService[] = [];
  for (const pack of rawData) {
    const data = pack as Record<string, unknown>;
    const ids = data["id"] as number[] | undefined;
    const elapsedArr = data["elapsed"] as number[] | undefined;
    const serviceArr = data["service"] as number[] | undefined;
    const nameArr = data["name"] as string[] | undefined;
    const statArr = data["stat"] as string[] | undefined;
    const ipArr = data["ip"] as string[] | undefined;
    const sqlArr = data["sql"] as string[] | undefined;

    if (Array.isArray(ids) && ids.length > 0) {
      for (let i = 0; i < ids.length; i++) {
        results.push({
          threadId: ids[i],
          elapsed: elapsedArr?.[i] ?? 0,
          service: serviceArr?.[i] ?? 0,
          name: nameArr?.[i] ?? "",
          mode: statArr?.[i] ?? "",
          ip: ipArr?.[i] ?? "",
          note: sqlArr?.[i] ?? "",
        });
      }
    } else if (typeof data["elapsed"] === "number") {
      results.push(data as ActiveService);
    }
  }
  return results;
}

async function handler({ obj_type, obj_hash, thread_id, min_elapsed_ms = 0 }: { obj_type?: string; obj_hash?: number; thread_id?: number; min_elapsed_ms?: number }) {
  const warnings: string[] = [];

  if (thread_id !== undefined && obj_hash !== undefined) {
    const detail = await catchWarn(
      client.getActiveThreadDetail(obj_hash, thread_id),
      null, warnings, `activeThread(${obj_hash}:${thread_id})`,
    );
    const output: Record<string, unknown> = { objHash: obj_hash, threadId: thread_id, threadDetail: detail };
    if (warnings.length > 0) output.warnings = warnings;
    return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
  }

  let rawServices: unknown[];

  if (obj_hash !== undefined) {
    rawServices = await catchWarn(
      client.getActiveServicesByObj(obj_hash) as Promise<unknown[]>,
      [], warnings, `activeService(${obj_hash})`
    );
  } else {
    const objTypes = await resolveObjType(obj_type);
    const results = await Promise.all(
      objTypes.map(type => catchWarn(
        client.getActiveServices(type) as Promise<unknown[]>,
        [], warnings, `activeService(${type})`
      ))
    );
    rawServices = results.flat();
  }

  const services = unpackMapPackArrays(rawServices);

  const serviceHashes = services.map(s => Number(s.service) || 0).filter(h => h !== 0);
  const serviceMap = await resolveHashes(serviceHashes, "service");
  const resolved = services.map(s => ({
    ...s,
    serviceName: resolveOrHash(Number(s.service) || 0, serviceMap),
  }));

  const filtered = resolved
    .filter(s => s.elapsed >= min_elapsed_ms)
    .sort((a, b) => b.elapsed - a.elapsed);

  const sqlCount = filtered.filter(s => s.mode === "SQL").length;
  const subcallCount = filtered.filter(s => s.mode === "SUBCALL").length;
  const elapsedValues = filtered.map(s => s.elapsed);

  const output: Record<string, unknown> = {
    totalActiveCount: filtered.length,
    services: filtered,
    summary: {
      longestElapsed: elapsedValues[0] ?? 0,
      avgElapsed: elapsedValues.length > 0 ? Math.round(elapsedValues.reduce((a, b) => a + b, 0) / elapsedValues.length) : 0,
      sqlModeCount: sqlCount,
      subcallModeCount: subcallCount,
    },
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
