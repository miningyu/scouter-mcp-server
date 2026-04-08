import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";
import { millisToIso } from "../time-utils.js";

const SENSITIVE_PATTERNS = /password|secret|token|credential|api[_-]?key/i;

function maskSensitiveValues(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(maskSensitiveValues);
  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_PATTERNS.test(key) && typeof value === "string") {
        result[key] = "********";
      } else if (typeof value === "object" && value !== null) {
        result[key] = maskSensitiveValues(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return data;
}

export const params = {
  obj_hash: z.number().describe("Target agent object hash (from get_system_overview)"),
  include_threads: z.boolean().optional().default(true).describe("Include thread list with states and active services"),
  include_env: z.boolean().optional().default(false).describe("Include JVM environment variables and system properties"),
  include_sockets: z.boolean().optional().default(false).describe("Include network socket connections"),
};

export function register(server: McpServer) {
  server.registerTool("get_agent_info", {
    title: "Get Agent Info",
    description: "Get detailed agent runtime information: thread list with states and active services, environment variables, and socket connections. Thread list shows live thread states (unlike thread dump which captures stack traces). Use for deep agent-level investigation.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface ThreadData {
  id?: number;
  name?: string;
  stat?: string;
  cpu?: number;
  txid?: string;
  elapsed?: string;
  service?: string;
  [key: string]: unknown;
}

async function handler(args: {
  obj_hash: number; include_threads?: boolean;
  include_env?: boolean; include_sockets?: boolean;
}) {
  const warnings: string[] = [];
  const includeThreads = args.include_threads !== false;
  const includeEnv = args.include_env === true;
  const includeSockets = args.include_sockets === true;

  const threadsFetch = includeThreads
    ? catchWarn(client.getThreadList(args.obj_hash) as Promise<ThreadData[]>, [], warnings, "threadList")
    : Promise.resolve(null);
  const envFetch = includeEnv
    ? catchWarn(client.getAgentEnv(args.obj_hash), [], warnings, "agentEnv")
    : Promise.resolve(null);
  const socketsFetch = includeSockets
    ? catchWarn(client.getAgentSocket(args.obj_hash), [], warnings, "agentSocket")
    : Promise.resolve(null);

  const [threads, env, sockets] = await Promise.all([threadsFetch, envFetch, socketsFetch]);

  const output: Record<string, unknown> = {
    objHash: args.obj_hash,
    timestamp: millisToIso(Date.now()),
  };

  if (threads !== null) {
    const threadList = threads as ThreadData[];
    const stateCounts = threadList.reduce<Record<string, number>>((acc, t) => {
      const state = String(t.stat ?? "UNKNOWN");
      return { ...acc, [state]: (acc[state] ?? 0) + 1 };
    }, {});

    const activeThreads = threadList
      .filter(t => t.service || t.txid)
      .map(t => ({
        id: t.id,
        name: t.name,
        state: t.stat,
        service: t.service,
        elapsed: t.elapsed,
        cpu: t.cpu,
      }));

    output.threads = {
      totalCount: threadList.length,
      stateSummary: stateCounts,
      activeServiceThreads: activeThreads,
      allThreads: threadList.slice(0, 200),
    };
  }

  if (env !== null) {
    const SKIP_PREFIXES = [
      "sun.", "awt.", "socksNonProxyHosts", "ftp.nonProxyHosts", "http.nonProxyHosts",
      "file.encoding.pkg", "sun.io.", "java.awt.", "java.endorsed.dirs", "java.ext.dirs",
      "java.specification.", "java.vm.specification.", "java.vendor.url",
      "package.access", "package.definition", "ignore.endorsed.dirs",
      "tomcat.util.scan.", "org.apache.el.", "org.jboss.",
      "org.apache.catalina.security.",
    ];
    const masked = maskSensitiveValues(env);
    const filtered = Array.isArray(masked)
      ? (masked as Array<{ name: string; value: unknown }>).filter(
          item => !SKIP_PREFIXES.some(p => item.name.startsWith(p)))
      : masked;
    output.env = filtered;
  }
  if (sockets !== null) {
    output.sockets = Array.isArray(sockets)
      ? (sockets as Array<Record<string, unknown>>).map(s => {
          const { key: _, standby: _2, stack: _3, ...rest } = s;
          const compact: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (v !== "" && v !== "0" && v !== null && v !== undefined) compact[k] = v;
          }
          return compact;
        })
      : sockets;
  }
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
