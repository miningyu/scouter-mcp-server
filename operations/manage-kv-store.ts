import { z } from "zod";
import { defineOperation, OperationInputError, type OperationContext } from "./definition.js";
import { catchWarn, UnsupportedOperationError } from "../client/index.js";

const inputShape = {
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
  kvs: z.record(z.string(), z.string()).optional().describe("Key-value pairs object for 'set_bulk' operation (e.g., {\"key1\": \"val1\", \"key2\": \"val2\"})"),
};

export const operation = defineOperation({
  name: "manage_kv_store",
  title: "Manage KV Store",
  description: "[HTTP mode only] Manage Scouter's key-value stores. Supports three stores: 'global' (shared across all users), 'custom' (namespaced, requires key_space), and 'private' (per user session). Operations: get, set, set_ttl, get_bulk, set_bulk.",
  inputShape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  execute,
});

type Args = {
  operation: "get" | "set" | "set_ttl" | "get_bulk" | "set_bulk";
  store: "global" | "custom" | "private";
  key_space?: string; key?: string; value?: string;
  ttl?: number; keys?: string; kvs?: Record<string, string>;
};

async function execute(ctx: OperationContext, args: Args) {
  try {
    const warnings: string[] = [];
    const store = args.store ?? "global";
    const ttl = args.ttl ?? 0;

    if (store === "custom" && !args.key_space) {
      throw new OperationInputError("Error: 'key_space' is required for custom store");
    }

    let result: unknown;

    switch (args.operation) {
      case "get": {
        if (!args.key) throw new OperationInputError("Error: 'key' is required for get operation");
        if (store === "global") result = await catchWarn(ctx.client.kvGet(args.key), null, warnings, "kvGet");
        else if (store === "custom") result = await catchWarn(ctx.client.kvSpaceGet(args.key_space!, args.key), null, warnings, "kvSpaceGet");
        else result = await catchWarn(ctx.client.kvPrivateGet(args.key), null, warnings, "kvPrivateGet");
        break;
      }
      case "set": {
        if (!args.key || args.value === undefined) throw new OperationInputError("Error: 'key' and 'value' are required for set operation");
        if (store === "global") result = await catchWarn(ctx.client.kvSet(args.key, args.value, ttl), null, warnings, "kvSet");
        else if (store === "custom") result = await catchWarn(ctx.client.kvSpaceSet(args.key_space!, args.key, args.value, ttl), null, warnings, "kvSpaceSet");
        else result = await catchWarn(ctx.client.kvPrivateSet(args.key, args.value, ttl), null, warnings, "kvPrivateSet");
        break;
      }
      case "set_ttl": {
        if (!args.key) throw new OperationInputError("Error: 'key' is required for set_ttl operation");
        if (store === "global") result = await catchWarn(ctx.client.kvSetTtl(args.key, ttl), null, warnings, "kvSetTtl");
        else if (store === "custom") result = await catchWarn(ctx.client.kvSpaceSetTtl(args.key_space!, args.key, ttl), null, warnings, "kvSpaceSetTtl");
        else result = await catchWarn(ctx.client.kvPrivateSetTtl(args.key, ttl), null, warnings, "kvPrivateSetTtl");
        break;
      }
      case "get_bulk": {
        if (!args.keys) throw new OperationInputError("Error: 'keys' is required for get_bulk operation");
        if (store === "global") result = await catchWarn(ctx.client.kvGetBulk(args.keys), null, warnings, "kvGetBulk");
        else if (store === "custom") result = await catchWarn(ctx.client.kvSpaceGetBulk(args.key_space!, args.keys), null, warnings, "kvSpaceGetBulk");
        else result = await catchWarn(ctx.client.kvPrivateGetBulk(args.keys), null, warnings, "kvPrivateGetBulk");
        break;
      }
      case "set_bulk": {
        if (!args.kvs) throw new OperationInputError("Error: 'kvs' is required for set_bulk operation");
        if (store === "global") result = await catchWarn(ctx.client.kvSetBulk(args.kvs, ttl), null, warnings, "kvSetBulk");
        else if (store === "custom") result = await catchWarn(ctx.client.kvSpaceSetBulk(args.key_space!, args.kvs, ttl), null, warnings, "kvSpaceSetBulk");
        else result = await catchWarn(ctx.client.kvPrivateSetBulk(args.kvs, ttl), null, warnings, "kvPrivateSetBulk");
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

    return output;
  } catch (e) {
    if (e instanceof UnsupportedOperationError) {
      return { error: "This operation requires HTTP mode", detail: e.message, hint: "Configure SCOUTER_API_URL instead of SCOUTER_TCP_HOST to enable this feature" };
    }
    throw e;
  }
}
