import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";
import { todayYmd } from "../time-utils.js";
import { resolveHashes, resolveOrHash, bindSqlParams } from "./shared-utils.js";

export const params = {
  txid: z.string().describe("Transaction ID (from search_transactions or list_active_services)"),
  date: z.string().optional().describe("Date in YYYYMMDD format. Defaults to today."),
  max_steps: z.number().optional().default(80).describe("Max profile steps to return (default 80). Slow SQL/API calls are always included regardless of this limit."),
};

export function register(server: McpServer) {
  server.registerTool("get_transaction_detail", {
    title: "Get Transaction Detail",
    description: "Get full detail of a specific transaction including execution profile (SQL queries with bind params, API calls, method traces). Use after identifying a problematic transaction from search_transactions or list_active_services.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface ProfileStep {
  stepType?: string;
  mainValue?: string;
  elapsed?: number;
  hash?: number;
  param?: string;
  [key: string]: unknown;
}

async function handler({ txid, date, max_steps }: { txid: string; date?: string; max_steps?: number }) {
  const warnings: string[] = [];
  const d = date || todayYmd();

  const [transaction, profileSteps] = await Promise.all([
    catchWarn(client.getXLogDetail(d, txid), null, warnings, "xlogDetail"),
    catchWarn(client.getProfileData(d, txid) as Promise<ProfileStep[]>, [], warnings, "profileData"),
  ]);

  const steps = profileSteps as ProfileStep[];
  const tx = transaction as Record<string, unknown> | null;

  const serviceHash = Number(tx?.service) || 0;
  const errorHash = Number(tx?.error) || 0;
  const sqlHashes = steps.filter(s => s.stepType === "SQL").map(s => Number(s.hash) || 0);
  const methodHashes = steps.filter(s => s.stepType === "METHOD").map(s => Number(s.hash) || 0);
  const apicallHashes = steps.filter(s => s.stepType === "APICALL").map(s => Number(s.hash) || 0);
  const hashedMsgHashes = steps.filter(s => s.stepType === "HASHED_MESSAGE").map(s => Number(s.hash) || 0);

  const [serviceMap, errorMap, sqlMap, methodMap, apicallMap, hashedMsgMap] = await Promise.all([
    resolveHashes(serviceHash ? [serviceHash] : [], "service", d),
    resolveHashes(errorHash ? [errorHash] : [], "error", d),
    resolveHashes(sqlHashes, "sql", d),
    resolveHashes(methodHashes, "service", d),
    resolveHashes(apicallHashes, "apicall", d),
    resolveHashes(hashedMsgHashes, "service", d),
  ]);

  const resolvedTx = tx ? {
    ...tx,
    serviceName: resolveOrHash(serviceHash, serviceMap),
    errorMessage: errorHash ? resolveOrHash(errorHash, errorMap) : undefined,
  } : null;

  const resolvedSteps = steps.map(s => {
    const hash = Number(s.hash) || 0;
    switch (s.stepType) {
      case "SQL": return { ...s, name: resolveOrHash(hash, sqlMap) };
      case "METHOD": return { ...s, name: resolveOrHash(hash, methodMap) };
      case "APICALL": return { ...s, name: resolveOrHash(hash, apicallMap) };
      case "HASHED_MESSAGE": return { ...s, text: resolveOrHash(hash, hashedMsgMap) };
      default: return s;
    }
  });

  const limit = max_steps ?? 80;
  const totalStepCount = resolvedSteps.length;

  const sqlSteps = resolvedSteps
    .filter(s => s.stepType === "SQL")
    .map((s, i) => {
      const sqlText = String(s.name ?? s.mainValue ?? "");
      const paramStr = s.param as string | undefined;
      return {
        index: i,
        sql: sqlText,
        elapsed: s.elapsed,
        param: paramStr,
        executableSql: bindSqlParams(sqlText, paramStr),
      };
    });
  const apiCallSteps = resolvedSteps
    .filter(s => s.stepType === "APICALL")
    .map((s, i) => ({ index: i, url: s.name ?? s.mainValue, elapsed: s.elapsed }));

  const significantSteps = resolvedSteps.filter(s =>
    (s.stepType === "SQL" && (s.elapsed ?? 0) > 0) ||
    (s.stepType === "APICALL") ||
    (s.stepType === "METHOD" && (s.elapsed ?? 0) > 10)
  );
  const otherSteps = resolvedSteps.filter(s => !significantSteps.includes(s));
  const remaining = Math.max(0, limit - significantSteps.length);
  const trimmedSteps = [...significantSteps, ...otherSteps.slice(0, remaining)]
    .sort((a, b) => ((a as Record<string, unknown>).index as number ?? 0) - ((b as Record<string, unknown>).index as number ?? 0));
  const wasTruncated = totalStepCount > trimmedSteps.length;

  const output: Record<string, unknown> = {
    transaction: resolvedTx,
    profile: {
      totalSteps: totalStepCount,
      returnedSteps: trimmedSteps.length,
      ...(wasTruncated ? { truncated: true, note: `Showing ${trimmedSteps.length} of ${totalStepCount} steps (significant steps prioritized). Use max_steps to adjust.` } : {}),
      steps: trimmedSteps,
      sqlSummary: {
        totalCount: sqlSteps.length,
        totalElapsed: sqlSteps.reduce((sum, s) => sum + (s.elapsed ?? 0), 0),
        slowQueries: sqlSteps.filter(s => (s.elapsed ?? 0) > 0).sort((a, b) => (b.elapsed ?? 0) - (a.elapsed ?? 0)).slice(0, 20),
      },
      apiCallSummary: {
        totalCount: apiCallSteps.length,
        calls: apiCallSteps.slice(0, 20),
      },
    },
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
