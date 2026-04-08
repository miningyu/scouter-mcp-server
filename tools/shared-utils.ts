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
  if (isMaskPiiEnabled()) output.piiMasked = "Fields marked [masked] contain data that is hidden by SCOUTER_MASK_PII. Disable this env var to see actual values.";
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

const LITERAL_PLACEHOLDER_RE = /@\{\d+\}/g;

function stripSideChar(s: string, ch: string): string {
  if (s.length >= 2 && s[0] === ch && s[s.length - 1] === ch) {
    return s.slice(1, -1);
  }
  return s;
}

function unescapeLiteralSql(sql: string, params: string[]): { sql: string; remainingParams: string[] } {
  let paramIndex = 0;
  const unescaped = sql.replace(LITERAL_PLACEHOLDER_RE, () => {
    if (paramIndex < params.length) {
      return stripSideChar(params[paramIndex++], "'");
    }
    return "";
  });
  return { sql: unescaped, remainingParams: params.slice(paramIndex) };
}

function replaceQuestionMarks(sql: string, params: string[]): string {
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

export function bindSqlParams(sql: string, paramStr: string | undefined | null): string {
  if (!paramStr || paramStr.trim() === "") return sql;
  if (isMaskPiiEnabled()) return sql;
  const params = parseParams(paramStr);
  const { sql: unescapedSql, remainingParams } = unescapeLiteralSql(sql, params);
  if (remainingParams.length === 0) return unescapedSql;
  return replaceQuestionMarks(unescapedSql, remainingParams);
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

// --------------- PII Masking ---------------

export function isMaskPiiEnabled(): boolean {
  return process.env.SCOUTER_MASK_PII !== "false";
}

function maskIp(ip: string): string {
  const lastDot = ip.lastIndexOf(".");
  return lastDot > 0 ? ip.slice(0, lastDot + 1) + "***" : "***";
}

function maskLogin(login: string): string {
  if (login.length <= 2) return "**";
  return login.slice(0, 2) + "****" + login.slice(-2);
}

export function maskXLogPii<T extends Record<string, unknown>>(entry: T): T {
  if (!isMaskPiiEnabled()) return entry;
  const masked: Record<string, unknown> = { ...entry };
  if (typeof masked.ipaddr === "string") masked.ipaddr = maskIp(masked.ipaddr);
  if (typeof masked.ipAddr === "string") masked.ipAddr = maskIp(masked.ipAddr);
  if (typeof masked.ip === "string") masked.ip = maskIp(masked.ip);
  if (typeof masked.login === "string" && masked.login) masked.login = maskLogin(masked.login);
  if (typeof masked.userAgent === "string") masked.userAgent = "[masked]";
  if (typeof masked.ua === "string") masked.ua = "[masked]";
  return masked as T;
}

export function maskRawResult(result: unknown): unknown {
  if (Array.isArray(result)) return result.map(item =>
    item !== null && typeof item === "object" ? maskXLogPii(item as Record<string, unknown>) : item
  );
  if (result !== null && typeof result === "object") return maskXLogPii(result as Record<string, unknown>);
  return result;
}

// --------------- Token Optimization ---------------

export function stripEmpty<T extends Record<string, unknown>>(entry: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (value === "" || value === "0" || value === null || value === undefined) continue;
    result[key] = value;
  }
  return result as T;
}

export function compactXLog<T extends Record<string, unknown>>(entry: T): T {
  return stripEmpty(maskXLogPii(entry));
}
