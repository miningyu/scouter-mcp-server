import { HttpClient } from "./http.js";
import { TcpClient } from "./tcp.js";
import { UnsupportedOperationError } from "./interface.js";
import type { ScouterClient, ScouterObject } from "./interface.js";

export type { ScouterClient, ScouterObject };
export { UnsupportedOperationError };

const MAX_RESPONSE_CHARS = 80_000;

export type ScouterProtocol = "tcp" | "http";

export interface ConnectionInfo {
  protocol: ScouterProtocol;
  /** Endpoint with any credentials stripped — safe to print. */
  endpoint: string;
  /** Whether an endpoint env var was set, as opposed to falling back to the default. */
  endpointConfigured: boolean;
  /** Whether SCOUTER_API_PASSWORD is set. The password itself is never exposed. */
  authConfigured: boolean;
  apiId: string;
  writeEnabled: boolean;
  maskPii: boolean;
}

function detectProtocol(): ScouterProtocol {
  if (process.env.SCOUTER_TCP_HOST) return "tcp";
  if (process.env.SCOUTER_API_URL) return "http";
  return "http";
}

/** Builds a client from the SCOUTER_* environment variables. */
export function createClient(): ScouterClient {
  const protocol = detectProtocol();
  const apiId = process.env.SCOUTER_API_ID || "";
  const apiPassword = process.env.SCOUTER_API_PASSWORD || "";

  if (protocol === "tcp") {
    const host = process.env.SCOUTER_TCP_HOST || "localhost";
    const port = Number(process.env.SCOUTER_TCP_PORT || "6100");
    return new TcpClient(host, port, apiId, apiPassword);
  }

  const apiUrl = process.env.SCOUTER_API_URL || "http://localhost:6180";
  return new HttpClient(`${apiUrl}/scouter/v1`, apiId, apiPassword);
}

/** Releases a client's resources. Never throws — cleanup must not mask a real error. */
export async function closeClient(target: ScouterClient): Promise<void> {
  try {
    await target.close?.();
  } catch {
    // a failed close is not worth surfacing during shutdown
  }
}

/** Redacts any user:password embedded in a URL so the endpoint can be printed. */
function redactUrl(url: string): string {
  return url.replace(/\/\/[^/@]*@/, "//***@");
}

/**
 * Describes the connection the current environment selects, without ever revealing
 * SCOUTER_API_PASSWORD or credentials embedded in SCOUTER_API_URL.
 */
export function describeConnection(): ConnectionInfo {
  const protocol = detectProtocol();
  const apiId = process.env.SCOUTER_API_ID || "";
  const endpoint = protocol === "tcp"
    ? `${process.env.SCOUTER_TCP_HOST || "localhost"}:${process.env.SCOUTER_TCP_PORT || "6100"}`
    : redactUrl(process.env.SCOUTER_API_URL || "http://localhost:6180");
  return {
    protocol,
    endpoint,
    endpointConfigured: Boolean(protocol === "tcp" ? process.env.SCOUTER_TCP_HOST : process.env.SCOUTER_API_URL),
    authConfigured: Boolean(process.env.SCOUTER_API_PASSWORD),
    apiId,
    writeEnabled: process.env.SCOUTER_ENABLE_WRITE === "true",
    maskPii: process.env.SCOUTER_MASK_PII !== "false",
  };
}

/** Process-wide client used by the MCP server. The CLI builds its own per command. */
export const client: ScouterClient = createClient();

export function jsonStringify(obj: unknown): string {
  const json = JSON.stringify(obj, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  , 2);
  if (json.length <= MAX_RESPONSE_CHARS) return json;
  return json.slice(0, MAX_RESPONSE_CHARS) + "\n... (truncated, total " + json.length + " chars)";
}

export async function catchWarn<T>(promise: Promise<T>, fallback: T, warnings: string[], context: string): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof UnsupportedOperationError) throw e;
    warnings.push(`[${context}] ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}

let cachedObjTypes: string[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000;

export async function discoverObjTypes(): Promise<string[]> {
  const elapsed = Date.now() - cacheTimestamp;
  if (cachedObjTypes && elapsed < CACHE_TTL) return cachedObjTypes;
  const objects = await client.getObjects();
  cachedObjTypes = [...new Set(objects.filter(o => o.alive).map(o => o.objType))];
  cacheTimestamp = Date.now();
  return cachedObjTypes;
}

export async function resolveObjType(objType: string | undefined): Promise<string[]> {
  if (objType) return [objType];
  return discoverObjTypes();
}
