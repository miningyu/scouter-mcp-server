import { HttpClient } from "./http.js";
import { TcpClient } from "./tcp.js";
import { UnsupportedOperationError } from "./interface.js";
import type { ScouterClient, ScouterObject } from "./interface.js";

export type { ScouterClient, ScouterObject };
export { UnsupportedOperationError };

const MAX_RESPONSE_CHARS = 80_000;

function detectProtocol(): "tcp" | "http" {
  if (process.env.SCOUTER_TCP_HOST) return "tcp";
  if (process.env.SCOUTER_API_URL) return "http";
  return "http";
}

function createClient(): ScouterClient {
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
