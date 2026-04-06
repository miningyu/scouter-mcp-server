import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";
import { todayYmd } from "../time-utils.js";
import { resolveHashes, resolveOrHash } from "./shared-utils.js";

export const params = {
  gxid: z.string().optional().describe("Global transaction ID for distributed trace lookup"),
  txids: z.string().optional().describe("Comma-separated transaction IDs to fetch multiple XLogs at once"),
  date: z.string().optional().describe("Date in YYYYMMDD format. Defaults to today."),
  include_profiles: z.boolean().optional().default(false).describe("Also fetch execution profiles for each transaction"),
};

export function register(server: McpServer) {
  server.registerTool("get_distributed_trace", {
    title: "Get Distributed Trace",
    description: "Trace a distributed transaction across multiple services using GXID, or fetch multiple transactions by txid list. Essential for MSA environments to follow a request across service boundaries. Use after finding a GXID in get_transaction_detail.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface XLogEntry {
  txid?: string;
  gxid?: string;
  caller?: string;
  elapsed?: number;
  service?: number;
  serviceName?: string;
  objName?: string;
  error?: number;
  [key: string]: unknown;
}

async function handler(args: { gxid?: string; txids?: string; date?: string; include_profiles?: boolean }) {
  if (!args.gxid && !args.txids) {
    return { content: [{ type: "text" as const, text: jsonStringify({ error: "Either gxid or txids must be provided" }) }] };
  }

  const warnings: string[] = [];
  const date = args.date || todayYmd();

  let transactions: XLogEntry[];

  if (args.gxid) {
    transactions = await catchWarn(
      client.getXLogsByGxid(date, args.gxid) as Promise<XLogEntry[]>,
      [], warnings, "gxidLookup"
    );
  } else {
    transactions = await catchWarn(
      client.getMultiXLogs(date, args.txids!) as Promise<XLogEntry[]>,
      [], warnings, "multiXLogLookup"
    );
  }

  let profiles: Record<string, unknown> | undefined;
  if (args.include_profiles && transactions.length > 0) {
    const profileResults = await Promise.all(
      transactions.map(async (tx) => {
        const txid = String(tx.txid ?? "");
        if (!txid) return { txid, profile: null };
        const profile = await catchWarn(
          client.getProfileData(date, txid),
          null, warnings, `profile(${txid})`
        );
        return { txid, profile };
      })
    );
    profiles = Object.fromEntries(profileResults.map(r => [r.txid, r.profile]));
  }

  const serviceHashes = transactions.map(t => Number(t.service) || 0).filter(h => h !== 0);
  const errorHashes = transactions.map(t => Number(t.error) || 0).filter(h => h !== 0);
  const [serviceMap, errorMap] = await Promise.all([
    resolveHashes(serviceHashes, "service", date),
    resolveHashes(errorHashes, "error", date),
  ]);
  const resolved = transactions.map(t => ({
    ...t,
    serviceName: resolveOrHash(Number(t.service) || 0, serviceMap),
    errorMessage: Number(t.error) ? resolveOrHash(Number(t.error), errorMap) : undefined,
  }));

  const sorted = [...resolved].sort((a, b) => (a.elapsed ?? 0) - (b.elapsed ?? 0));

  const output: Record<string, unknown> = {
    date,
    ...(args.gxid ? { gxid: args.gxid } : {}),
    transactionCount: transactions.length,
    transactions: sorted,
    callChainSummary: sorted.map(tx => ({
      txid: tx.txid,
      objName: tx.objName,
      service: tx.serviceName,
      elapsed: tx.elapsed,
      caller: tx.caller,
      hasError: !!tx.error,
    })),
  };
  if (profiles) output.profiles = profiles;
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
