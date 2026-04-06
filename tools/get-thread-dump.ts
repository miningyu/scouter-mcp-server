import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";

export const params = {
  obj_hash: z.number().describe("Target agent object hash (from get_system_overview)"),
  include_heap_histogram: z.boolean().optional().default(false).describe("Also fetch top heap consumers"),
};

export function register(server: McpServer) {
  server.registerTool("get_thread_dump", {
    title: "Get Thread Dump",
    description: "Capture a thread dump from a specific JVM agent. Use for diagnosing deadlocks, thread contention, or understanding thread activity. Optionally includes heap histogram for memory analysis. Stack traces require HTTP mode; TCP mode returns thread states only.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface ThreadEntry {
  name?: string;
  id?: number;
  state?: string;
  stackTrace?: string;
  lockName?: string;
  lockOwnerName?: string;
  cpu?: number;
  txid?: string;
  elapsed?: number;
  serviceName?: string;
  [key: string]: unknown;
}

function parseThreadDumpPacks(rawData: unknown): ThreadEntry[] {
  if (!Array.isArray(rawData)) return [];
  const threads: ThreadEntry[] = [];
  for (const pack of rawData) {
    const data = pack as Record<string, unknown>;
    const names = data["name"] as string[] | undefined;
    const ids = data["id"] as number[] | undefined;
    const states = data["stat"] as string[] | undefined;
    const stacks = data["stack"] as string[] | undefined;

    if (Array.isArray(names) && names.length > 0) {
      for (let i = 0; i < names.length; i++) {
        threads.push({
          name: names[i],
          id: ids?.[i],
          state: states?.[i],
          stackTrace: stacks?.[i],
          cpu: (data["cpu"] as number[])?.[i],
          txid: (data["txid"] as string[])?.[i],
          elapsed: (data["elapsed"] as number[])?.[i],
          serviceName: (data["service"] as string[])?.[i],
        });
      }
    } else if (typeof data["name"] === "string") {
      threads.push(data as ThreadEntry);
    } else {
      threads.push(data as ThreadEntry);
    }
  }
  return threads;
}

async function handler({ obj_hash, include_heap_histogram = false }: { obj_hash: number; include_heap_histogram?: boolean }) {
  const warnings: string[] = [];

  const threadDumpFetch = catchWarn(client.getThreadDump(obj_hash), null, warnings, "threadDump");
  const heapFetch = include_heap_histogram
    ? catchWarn(client.getHeapHistogram(obj_hash), null, warnings, "heapHistogram")
    : Promise.resolve(null);

  const [threadDumpRaw, heapHistogram] = await Promise.all([threadDumpFetch, heapFetch]);

  const threads = parseThreadDumpPacks(threadDumpRaw);
  const hasStackTraces = threads.some(t => t.stackTrace && t.stackTrace.length > 0);
  if (!hasStackTraces && threads.length > 0) {
    warnings.push("Stack traces not available in TCP mode. Use HTTP mode (SCOUTER_API_URL) for full thread dumps.");
  }
  const stateCounts = threads.reduce<Record<string, number>>((acc, t) => {
    const state = String(t.state ?? (t as Record<string, unknown>)["stat"] ?? "UNKNOWN");
    return { ...acc, [state]: (acc[state] ?? 0) + 1 };
  }, {});

  const output: Record<string, unknown> = {
    objHash: obj_hash,
    threadCount: threads.length,
    summary: stateCounts,
    threads,
  };

  if (include_heap_histogram && heapHistogram) {
    output.heapHistogram = heapHistogram;
  }
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
