import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, UnsupportedOperationError } from "../client/index.js";

export const params = {
  operation: z.enum(["get", "set", "set_ttl", "get_bulk", "set_bulk"]).describe(
    "Operation: 'get' reads a single key, 'set' writes a key-value, 'set_ttl' sets TTL for a key, 'get_bulk' reads multiple keys, 'set_bulk' writes multiple key-values",
  ),
  store: z.enum(["global", "custom", "private"]).default("global").describe(
    "KV store type: 'global' for shared store, 'custom' for namespaced store, 'private' for user-session-scoped store",
  ),
  key_space: z.string().optional().describe("Namespace/keyspace name (required when store is 'custom')"),
  key: z.string().optional().describe("Key to get/set (required for 'get', 'set', 'set_ttl')"),
  value: z.string().optional().describe("Value to set (required for 'set')"),
  ttl: z.number().optional().default(0).describe("Time-to-live in seconds. 0 = permanent (default)"),
  keys: z.string().optional().describe("Comma-separated keys for 'get_bulk' operation"),
  kvs: z.record(z.string()).optional().describe("Key-value pairs object for 'set_bulk' operation (e.g., {\"key1\": \"val1\", \"key2\": \"val2\"})"),
};

export function register(server: McpServer) {
  server.registerTool("manage_kv_store", {
    title: "Manage KV Store",
    description: "[HTTP mode only] Manage Scouter's key-value stores. Supports three stores: 'global' (shared across all users), 'custom' (namespaced, requires key_space), and 'private' (per user session). Operations: get, set, set_ttl, get_bulk, set_bulk.",
    inputSchema: params,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, handler);
}

type Args = {
  operation: "get" | "set" | "set_ttl" | "get_bulk" | "set_bulk";
  store: "global" | "custom" | "private";
  key_space?: string; key?: string; value?: string;
  ttl?: number; keys?: string; kvs?: Record<string, string>;
};

async function handler(args: Args) {
  try {
    const warnings: string[] = [];
    const store = args.store ?? "global";
    const ttl = args.ttl ?? 0;

    if (store === "custom" && !args.key_space) {
      return { content: [{ type: "text" as const, text: "Error: 'key_space' is required for custom store" }] };
    }

    let result: unknown;

    switch (args.operation) {
      case "get": {
        if (!args.key) return { content: [{ type: "text" as const, text: "Error: 'key' is required for get operation" }] };
        if (store === "global") result = await catchWarn(client.kvGet(args.key), null, warnings, "kvGet");
        else if (store === "custom") result = await catchWarn(client.kvSpaceGet(args.key_space!, args.key), null, warnings, "kvSpaceGet");
        else result = await catchWarn(client.kvPrivateGet(args.key), null, warnings, "kvPrivateGet");
        break;
      }
      case "set": {
        if (!args.key || args.value === undefined) return { content: [{ type: "text" as const, text: "Error: 'key' and 'value' are required for set operation" }] };
        if (store === "global") result = await catchWarn(client.kvSet(args.key, args.value, ttl), null, warnings, "kvSet");
        else if (store === "custom") result = await catchWarn(client.kvSpaceSet(args.key_space!, args.key, args.value, ttl), null, warnings, "kvSpaceSet");
        else result = await catchWarn(client.kvPrivateSet(args.key, args.value, ttl), null, warnings, "kvPrivateSet");
        break;
      }
      case "set_ttl": {
        if (!args.key) return { content: [{ type: "text" as const, text: "Error: 'key' is required for set_ttl operation" }] };
        if (store === "global") result = await catchWarn(client.kvSetTtl(args.key, ttl), null, warnings, "kvSetTtl");
        else if (store === "custom") result = await catchWarn(client.kvSpaceSetTtl(args.key_space!, args.key, ttl), null, warnings, "kvSpaceSetTtl");
        else result = await catchWarn(client.kvPrivateSetTtl(args.key, ttl), null, warnings, "kvPrivateSetTtl");
        break;
      }
      case "get_bulk": {
        if (!args.keys) return { content: [{ type: "text" as const, text: "Error: 'keys' is required for get_bulk operation" }] };
        if (store === "global") result = await catchWarn(client.kvGetBulk(args.keys), null, warnings, "kvGetBulk");
        else if (store === "custom") result = await catchWarn(client.kvSpaceGetBulk(args.key_space!, args.keys), null, warnings, "kvSpaceGetBulk");
        else result = await catchWarn(client.kvPrivateGetBulk(args.keys), null, warnings, "kvPrivateGetBulk");
        break;
      }
      case "set_bulk": {
        if (!args.kvs) return { content: [{ type: "text" as const, text: "Error: 'kvs' is required for set_bulk operation" }] };
        if (store === "global") result = await catchWarn(client.kvSetBulk(args.kvs, ttl), null, warnings, "kvSetBulk");
        else if (store === "custom") result = await catchWarn(client.kvSpaceSetBulk(args.key_space!, args.kvs, ttl), null, warnings, "kvSpaceSetBulk");
        else result = await catchWarn(client.kvPrivateSetBulk(args.kvs, ttl), null, warnings, "kvPrivateSetBulk");
        break;
      }
    }

    const output: Record<string, unknown> = {
      operation: args.operation,
      store,
      keySpace: args.key_space,
      result,
    };
    if (warnings.length > 0) output.warnings = warnings;

    return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
  } catch (e) {
    if (e instanceof UnsupportedOperationError) {
      return { content: [{ type: "text" as const, text: jsonStringify({ error: "This operation requires HTTP mode", detail: e.message, hint: "Configure SCOUTER_API_URL instead of SCOUTER_TCP_HOST to enable this feature" }) }] };
    }
    throw e;
  }
}
