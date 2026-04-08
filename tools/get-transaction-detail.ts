import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn } from "../client/index.js";
import { todayYmd } from "../time-utils.js";
import { resolveHashes, resolveOrHash, bindSqlParams, compactXLog, isMaskPiiEnabled } from "./shared-utils.js";

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

  const resolvedTx = tx ? compactXLog({
    ...tx,
    serviceName: resolveOrHash(serviceHash, serviceMap),
    errorMessage: errorHash ? resolveOrHash(errorHash, errorMap) : undefined,
  }) : null;

  const maskPii = isMaskPiiEnabled();

  const flattenStep = (s: ProfileStep): Record<string, unknown> => {
    const inner = s.step && typeof s.step === "object" ? s.step as Record<string, unknown> : {};
    const stepTypeName = String(inner.stepTypeName ?? s.stepType ?? "");
    const elapsed = Number(inner.elapsed ?? s.elapsed ?? 0);
    const param = maskPii ? (inner.param !== undefined ? "[masked]" : undefined) : inner.param as string | undefined;
    const result: Record<string, unknown> = {
      stepType: stepTypeName,
      mainValue: s.mainValue,
      elapsed: elapsed || undefined,
      index: inner.index ?? inner.order,
      startTime: inner.start_time,
    };
    if (param !== undefined && param !== "") result.param = param;
    if (inner.error && inner.error !== "0") result.error = inner.error;
    if (inner.address) result.address = inner.address;
    if (inner.txid) result.txid = inner.txid;
    return result;
  };

  const resolvedSteps = steps.map(s => {
    const hash = Number(s.hash ?? (s.step as Record<string, unknown>)?.hash) || 0;
    const flat = flattenStep(s);
    switch (flat.stepType) {
      case "SQL": case "SQL3": return { ...flat, name: resolveOrHash(hash, sqlMap) };
      case "METHOD": return { ...flat, name: resolveOrHash(hash, methodMap) };
      case "APICALL": return { ...flat, name: resolveOrHash(hash, apicallMap) };
      case "HASHED_MESSAGE": return { ...flat, text: resolveOrHash(hash, hashedMsgMap) };
      default: return flat;
    }
  });

  const limit = max_steps ?? 80;
  const totalStepCount = resolvedSteps.length;

  const isSqlStep = (s: Record<string, unknown>) => s.stepType === "SQL" || s.stepType === "SQL3";
  const sqlSteps = resolvedSteps
    .filter(isSqlStep)
    .map((s, i) => {
      const sqlText = String(s.name ?? s.mainValue ?? "");
      const paramStr = s.param as string | undefined;
      return {
        index: i,
        sql: sqlText,
        elapsed: s.elapsed,
        param: isMaskPiiEnabled() ? "[masked]" : paramStr,
        executableSql: bindSqlParams(sqlText, paramStr),
      };
    });
  const apiCallSteps = resolvedSteps
    .filter(s => s.stepType === "APICALL")
    .map((s, i) => ({ index: i, url: s.name ?? s.mainValue, elapsed: s.elapsed }));

  const significantSteps = resolvedSteps.filter(s =>
    (isSqlStep(s) && (Number(s.elapsed) || 0) > 0) ||
    (s.stepType === "APICALL") ||
    (s.stepType === "METHOD" && (Number(s.elapsed) || 0) > 10)
  );
  const otherSteps = resolvedSteps.filter(s => !significantSteps.includes(s));
  const remaining = Math.max(0, limit - significantSteps.length);
  const trimmedSteps = [...significantSteps, ...otherSteps.slice(0, remaining)]
    .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
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
        totalElapsed: sqlSteps.reduce((sum, s) => sum + (Number(s.elapsed) || 0), 0),
        slowQueries: sqlSteps.filter(s => (Number(s.elapsed) || 0) > 0).sort((a, b) => (Number(b.elapsed) || 0) - (Number(a.elapsed) || 0)).slice(0, 20),
      },
      apiCallSummary: {
        totalCount: apiCallSteps.length,
        calls: apiCallSteps.slice(0, 20),
      },
    },
  };
  if (warnings.length > 0) output.warnings = warnings;
  if (isMaskPiiEnabled()) output.piiMasked = "Fields marked [masked] contain data that is hidden by SCOUTER_MASK_PII. Disable this env var to see actual values.";

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
