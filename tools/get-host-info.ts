import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";
import { millisToIso } from "../time-utils.js";

export const params = {
  obj_hash: z.number().optional().describe("Specific host agent object hash. Use get_system_overview to find host agents."),
  obj_type: z.string().optional().describe("Host agent type (e.g., 'linux', 'windows'). Auto-discovers host agents of this type."),
  include_top: z.boolean().optional().default(true).describe("Include top processes by CPU/memory"),
  include_disk: z.boolean().optional().default(true).describe("Include disk usage information"),
};

export function register(server: McpServer) {
  server.registerTool("get_host_info", {
    title: "Get Host Info",
    description: "Get host-level system information: top processes (by CPU/memory) and disk usage. Requires a host agent obj_hash, or specify obj_type (e.g., 'linux') to auto-discover host agents. Use get_system_overview to find host agent hashes.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

async function handler(args: {
  obj_hash?: number; obj_type?: string;
  include_top?: boolean; include_disk?: boolean;
}) {
  const warnings: string[] = [];
  const includeTop = args.include_top !== false;
  const includeDisk = args.include_disk !== false;

  const hostAgents = await resolveHostAgents(args.obj_hash, args.obj_type, warnings);
  if (hostAgents.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: jsonStringify({ error: "No host agents found. Use get_system_overview to find host agent obj_hash values.", warnings }),
      }],
    };
  }

  const hosts = await Promise.all(
    hostAgents.map(async (agent) => {
      const topFetch = includeTop
        ? catchWarn(client.getHostTop(agent.objHash), [], warnings, `hostTop(${agent.objName})`)
        : Promise.resolve(null);
      const diskFetch = includeDisk
        ? catchWarn(client.getHostDisk(agent.objHash), [], warnings, `hostDisk(${agent.objName})`)
        : Promise.resolve(null);

      const [topData, diskData] = await Promise.all([topFetch, diskFetch]);

      const result: Record<string, unknown> = {
        objName: agent.objName,
        objHash: agent.objHash,
        objType: agent.objType,
      };
      if (topData !== null) result.processes = summarizeProcesses(topData);
      if (diskData !== null) result.disks = summarizeDisk(diskData);
      return result;
    }),
  );

  const output: Record<string, unknown> = {
    timestamp: millisToIso(Date.now()),
    hosts,
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}

function summarizeProcesses(topData: unknown, maxProcesses = 20): unknown {
  if (!Array.isArray(topData) || topData.length === 0) return topData;
  const raw = topData[0] as Record<string, unknown>;
  const pids = raw["PID"] as number[] | undefined;
  if (!Array.isArray(pids)) return topData;

  const users = raw["USER"] as string[] | undefined;
  const cpus = raw["CPU"] as number[] | undefined;
  const mems = raw["MEM"] as number[] | undefined;
  const names = raw["NAME"] as string[] | undefined;
  const times = raw["TIME"] as string[] | undefined;
  const totalCount = pids.length;

  const limit = Math.min(maxProcesses, totalCount);
  const processes = [];
  for (let i = 0; i < limit; i++) {
    processes.push({
      pid: pids[i],
      user: users?.[i],
      cpu: cpus?.[i],
      mem: mems?.[i],
      name: names?.[i],
      time: times?.[i],
    });
  }

  return { totalProcessCount: totalCount, showingTop: limit, processes };
}

const VIRTUAL_FS_TYPES = new Set([
  "sysfs", "proc", "devtmpfs", "securityfs", "tmpfs", "devpts", "cgroup",
  "pstore", "bpf", "tracefs", "configfs", "debugfs", "hugetlbfs", "mqueue",
  "fusectl", "autofs", "rpc_pipefs", "binfmt_misc", "sunrpc",
]);

function summarizeDisk(diskData: unknown): unknown {
  if (!Array.isArray(diskData) || diskData.length === 0) return diskData;
  const raw = diskData[0] as Record<string, unknown>;
  const devices = raw["Device"] as string[] | undefined;
  if (!Array.isArray(devices)) return diskData;
  const totals = raw["Total"] as number[] | undefined;
  const useds = raw["Used"] as number[] | undefined;
  const frees = raw["Free"] as number[] | undefined;
  const pcts = raw["Pct"] as number[] | undefined;
  const types = raw["Type"] as string[] | undefined;
  const mounts = raw["Mount"] as string[] | undefined;
  const rows = [];
  for (let i = 0; i < devices.length; i++) {
    const fsType = types?.[i]?.split("/")?.[0] ?? "";
    if (VIRTUAL_FS_TYPES.has(fsType)) continue;
    const total = totals?.[i] ?? 0;
    if (total === 0) continue;
    rows.push({
      device: devices[i],
      mount: mounts?.[i],
      type: fsType,
      totalGB: +(total / (1024 ** 3)).toFixed(1),
      usedGB: +((useds?.[i] ?? 0) / (1024 ** 3)).toFixed(1),
      freeGB: +((frees?.[i] ?? 0) / (1024 ** 3)).toFixed(1),
      usedPct: pcts?.[i] ?? 0,
    });
  }
  return rows;
}

async function resolveHostAgents(
  objHash: number | undefined, objType: string | undefined, warnings: string[],
): Promise<Array<{ objHash: number; objName: string; objType: string }>> {
  if (objHash !== undefined) {
    const objects = await catchWarn(client.getObjects(), [], warnings, "getObjects");
    const found = objects.find(o => o.objHash === objHash);
    return found
      ? [{ objHash: found.objHash, objName: found.objName, objType: found.objType }]
      : [{ objHash, objName: `unknown(${objHash})`, objType: "unknown" }];
  }

  const objects = await catchWarn(client.getObjects(), [], warnings, "getObjects");
  const alive = objects.filter(o => o.alive);

  if (objType) {
    return alive
      .filter(o => o.objType === objType)
      .map(o => ({ objHash: o.objHash, objName: o.objName, objType: o.objType }));
  }

  const KNOWN_HOST_TYPES = ["linux", "windows", "osx", "unix", "host"];
  return alive
    .filter(o => KNOWN_HOST_TYPES.includes(o.objType.toLowerCase()))
    .map(o => ({ objHash: o.objHash, objName: o.objName, objType: o.objType }));
}
