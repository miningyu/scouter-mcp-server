import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, UnsupportedOperationError } from "../client/index.js";

export const params = {
  target: z.enum(["server", "agent", "server_kv", "type_kv"]).describe(
    "Target to configure: 'server' for collector server config, 'agent' for specific agent config, 'server_kv' for server key-value config, 'type_kv' for object-type key-value config",
  ),
  obj_hash: z.number().optional().describe("Agent object hash (required when target is 'agent')"),
  obj_type: z.string().optional().describe("Object type (required when target is 'type_kv')"),
  values: z.string().optional().describe(
    "Configuration values as multi-line text (for 'server' and 'agent' targets). Example: 'net_collector_ip=127.0.0.1\\nnet_collector_udp_port=6100'",
  ),
  key: z.string().optional().describe("Configuration key (required for 'server_kv' and 'type_kv' targets)"),
  value: z.string().optional().describe("Configuration value (required for 'server_kv' and 'type_kv' targets)"),
};

export function register(server: McpServer) {
  server.registerTool("set_configure", {
    title: "Set Configure",
    description: "[HTTP mode only] Save server or agent configuration. Supports four targets: 'server' sets the collector's scouter.conf, 'agent' sets a specific agent's config, 'server_kv' sets a single key-value on the server, 'type_kv' sets a key-value for all agents of an object type. Use get_configure first to read current config before modifying.",
    inputSchema: params,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, handler);
}

async function handler(args: {
  target: "server" | "agent" | "server_kv" | "type_kv";
  obj_hash?: number; obj_type?: string;
  values?: string; key?: string; value?: string;
}) {
  try {
    const warnings: string[] = [];

    switch (args.target) {
      case "server": {
        if (!args.values) return { content: [{ type: "text" as const, text: "Error: 'values' is required for server target" }] };
        const result = await catchWarn(client.setServerConfig(args.values), null, warnings, "setServerConfig");
        const output: Record<string, unknown> = { target: "server", result };
        if (warnings.length > 0) output.warnings = warnings;
        return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
      }
      case "agent": {
        if (args.obj_hash === undefined) return { content: [{ type: "text" as const, text: "Error: 'obj_hash' is required for agent target" }] };
        if (!args.values) return { content: [{ type: "text" as const, text: "Error: 'values' is required for agent target" }] };
        const result = await catchWarn(client.setObjectConfig(args.obj_hash, args.values), null, warnings, "setObjectConfig");
        const output: Record<string, unknown> = { target: "agent", objHash: args.obj_hash, result };
        if (warnings.length > 0) output.warnings = warnings;
        return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
      }
      case "server_kv": {
        if (!args.key || !args.value) return { content: [{ type: "text" as const, text: "Error: 'key' and 'value' are required for server_kv target" }] };
        const result = await catchWarn(client.setServerConfigKv(args.key, args.value), null, warnings, "setServerConfigKv");
        const output: Record<string, unknown> = { target: "server_kv", key: args.key, result };
        if (warnings.length > 0) output.warnings = warnings;
        return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
      }
      case "type_kv": {
        if (!args.obj_type) return { content: [{ type: "text" as const, text: "Error: 'obj_type' is required for type_kv target" }] };
        if (!args.key || !args.value) return { content: [{ type: "text" as const, text: "Error: 'key' and 'value' are required for type_kv target" }] };
        const result = await catchWarn(client.setTypeConfigKv(args.obj_type, args.key, args.value), null, warnings, "setTypeConfigKv");
        const output: Record<string, unknown> = { target: "type_kv", objType: args.obj_type, key: args.key, result };
        if (warnings.length > 0) output.warnings = warnings;
        return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
      }
    }
  } catch (e) {
    if (e instanceof UnsupportedOperationError) {
      return { content: [{ type: "text" as const, text: jsonStringify({ error: "This operation requires HTTP mode", detail: e.message, hint: "Configure SCOUTER_API_URL instead of SCOUTER_TCP_HOST to enable this feature" }) }] };
    }
    throw e;
  }
}
