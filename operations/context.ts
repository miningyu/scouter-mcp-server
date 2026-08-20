import type { ScouterClient } from "../client/interface.js";
import type { OperationContext } from "./definition.js";

const OBJ_TYPE_CACHE_TTL = 30_000;

/**
 * Builds a context around a client, with its own short-lived object-type cache.
 *
 * `overrides` exists so the MCP server can keep sharing the process-wide client
 * and its discovery cache instead of starting a second one.
 */
export function createOperationContext(
  client: ScouterClient,
  overrides: Partial<Omit<OperationContext, "client">> = {},
): OperationContext {
  let cached: string[] | null = null;
  let cachedAt = 0;

  const discoverObjTypes = async (): Promise<string[]> => {
    if (cached && Date.now() - cachedAt < OBJ_TYPE_CACHE_TTL) return cached;
    const objects = await client.getObjects();
    cached = [...new Set(objects.filter(o => o.alive).map(o => o.objType))];
    cachedAt = Date.now();
    return cached;
  };

  const resolveObjType = async (objType?: string): Promise<string[]> =>
    objType ? [objType] : discoverObjTypes();

  return { client, discoverObjTypes, resolveObjType, ...overrides };
}
