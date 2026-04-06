import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, UnsupportedOperationError } from "../client/index.js";

export const params = {
  obj_hash: z.number().optional().describe(
    "Agent object hash. If provided, returns that agent's configuration. If omitted, returns server configuration.",
  ),
};

export function register(server: McpServer) {
  server.registerTool("get_configure", {
    title: "Get Configure",
    description: "[HTTP mode only] Read server or agent configuration (read-only). Without obj_hash, returns the collector server's scouter.conf. With obj_hash, returns that specific agent's configuration. Use get_system_overview to find agent hashes.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

async function handler(args: { obj_hash?: number }) {
  try {
    const warnings: string[] = [];

    if (args.obj_hash !== undefined) {
      const config = await catchWarn(
        client.getObjectConfig(args.obj_hash),
        null, warnings, "objectConfig",
      );
      const output: Record<string, unknown> = {
        target: "agent",
        objHash: args.obj_hash,
        config,
      };
      if (warnings.length > 0) output.warnings = warnings;
      return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
    }

    const config = await catchWarn(
      client.getServerConfig(),
      null, warnings, "serverConfig",
    );
    const output: Record<string, unknown> = {
      target: "server",
      config,
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
