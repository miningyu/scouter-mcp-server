import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, UnsupportedOperationError } from "../client/index.js";

export const params = {
  server_id: z.number().optional().describe(
    "If provided, removes inactive objects only for this specific collector server. If omitted, removes inactive objects across all servers.",
  ),
};

export function register(server: McpServer) {
  server.registerTool("remove_inactive_objects", {
    title: "Remove Inactive Objects",
    description: "[HTTP mode only] Remove all inactive (dead) monitored objects from the Scouter server. Inactive objects are agents that are no longer sending data. Use get_system_overview to check which objects are alive/dead before removing.",
    inputSchema: params,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, handler);
}

async function handler(args: { server_id?: number }) {
  try {
    const warnings: string[] = [];

    const result = args.server_id !== undefined
      ? await catchWarn(client.removeInactiveServer(), null, warnings, "removeInactiveServer")
      : await catchWarn(client.removeInactiveAll(), null, warnings, "removeInactiveAll");

    const output: Record<string, unknown> = {
      scope: args.server_id !== undefined ? `server ${args.server_id}` : "all servers",
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
