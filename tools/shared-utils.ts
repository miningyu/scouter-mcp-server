import { client, jsonStringify } from "../client/index.js";
import { todayYmd } from "../time-utils.js";

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export function pctOfTotal(value: number, total: number): number {
  return total > 0 ? +((value / total) * 100).toFixed(2) : 0;
}

export function enrichSummary(item: {
  summaryKeyName?: string;
  count?: number;
  errorCount?: number;
  elapsedSum?: number;
  cpuSum?: number;
  memorySum?: number;
}) {
  const count = Number(item.count) || 0;
  const errorCount = Number(item.errorCount) || 0;
  const elapsedSum = Number(item.elapsedSum) || 0;
  const cpuSum = Number(item.cpuSum) || 0;
  const memorySum = Number(item.memorySum) || 0;
  return {
    count,
    errorCount,
    elapsedSum,
    errorRate: pctOfTotal(errorCount, count),
    avgElapsed: count > 0 ? Math.round(elapsedSum / count) : 0,
    cpuSum,
    avgCpu: count > 0 ? Math.round(cpuSum / count) : 0,
    memorySum,
    avgMemory: count > 0 ? Math.round(memorySum / count) : 0,
  };
}

export function buildResponse(output: Record<string, unknown>, warnings: string[]) {
  if (warnings.length > 0) output.warnings = warnings;
  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}

export type TextType = "service" | "sql" | "error" | "apicall" | "desc" | "login" | "ip" | "ua";

export async function resolveHashes(
  hashes: number[],
  textType: TextType,
  date?: string,
): Promise<Map<number, string>> {
  const uniqueHashes = [...new Set(hashes.filter(h => h !== 0))];
  if (uniqueHashes.length === 0) return new Map();
  const targetDate = date ?? todayYmd();
  try {
    const result = await client.lookupTexts(targetDate, textType, uniqueHashes);
    const map = new Map<number, string>();
    for (const [key, value] of Object.entries(result)) {
      map.set(Number(key), value);
    }
    return map;
  } catch (err) {
    console.error(`[scouter] resolveHashes failed for type=${textType}:`, err);
    return new Map();
  }
}

export function resolveOrHash(hash: number, map: Map<number, string>): string {
  if (hash === 0) return "";
  return map.get(hash) ?? `hash:${hash}`;
}

// --------------- SQL Param Binding ---------------

const SECTION_SIGN = "§";

function parseParams(paramStr: string): string[] {
  if (paramStr.includes(SECTION_SIGN)) {
    return paramStr.split(SECTION_SIGN);
  }
  const params: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < paramStr.length; i++) {
    const ch = paramStr[i];
    if (ch === "'" && !inQuote) {
      inQuote = true;
      current += ch;
    } else if (ch === "'" && inQuote) {
      if (i + 1 < paramStr.length && paramStr[i + 1] === "'") {
        current += "''";
        i++;
      } else {
        inQuote = false;
        current += ch;
      }
    } else if (ch === "," && !inQuote) {
      params.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  params.push(current.trim());
  return params;
}

export function bindSqlParams(sql: string, paramStr: string | undefined | null): string {
  if (!paramStr || paramStr.trim() === "") return sql;
  const params = parseParams(paramStr);
  let paramIndex = 0;
  let result = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) {
      if (i + 1 < sql.length && sql[i + 1] === "'") {
        result += "''";
        i++;
      } else {
        inSingleQuote = !inSingleQuote;
        result += ch;
      }
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      result += ch;
    } else if (ch === "?" && !inSingleQuote && !inDoubleQuote) {
      result += paramIndex < params.length ? params[paramIndex] : "?";
      paramIndex++;
    } else {
      result += ch;
    }
  }
  return result;
}

// --------------- Summary Name Resolution ---------------

const UNRESOLVED_HASH_RE = /^hash:(-?\d+)$/;
const UNLABELED_RE = /^\*\*unlabeled\*\*:\w+:(-?\d+)$/;

function extractUnresolvedHash(name: string | undefined): number | null {
  if (typeof name !== "string") return null;
  const hashMatch = name.match(UNRESOLVED_HASH_RE);
  if (hashMatch) return Number(hashMatch[1]);
  const unlabeledMatch = name.match(UNLABELED_RE);
  if (unlabeledMatch) return Number(unlabeledMatch[1]);
  return null;
}

export async function resolveSummaryNames(
  items: Array<{ summaryKeyName?: string }>,
  textType: TextType,
  date?: string,
): Promise<number> {
  const hashEntries = items
    .map(item => ({ item, hash: extractUnresolvedHash(item.summaryKeyName) }))
    .filter((e): e is { item: { summaryKeyName?: string }; hash: number } => e.hash !== null);
  if (hashEntries.length === 0) return 0;
  const hashes = hashEntries.map(e => e.hash);
  const textMap = await resolveHashes(hashes, textType, date);
  let unresolvedCount = 0;
  for (const { item, hash } of hashEntries) {
    const resolved = textMap.get(hash);
    if (resolved) {
      item.summaryKeyName = resolved;
    } else {
      unresolvedCount++;
    }
  }
  return unresolvedCount;
}
