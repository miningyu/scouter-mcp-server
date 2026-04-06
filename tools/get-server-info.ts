import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, UnsupportedOperationError } from "../client/index.js";

export const params = {
  include_counter_model: z.boolean().optional().default(false).describe(
    "Include available counter definitions (names, display names, units). Useful for discovering which counters can be queried with get_counter_trend.",
  ),
};

export function register(server: McpServer) {
  server.registerTool("get_server_info", {
    title: "Get Server Info",
    description: "Get Scouter collector server metadata: version, ID, connection status. Optionally includes counter model (all available performance counter definitions with display names and units). Use this to discover what counters exist before querying get_counter_trend. Counter model requires HTTP mode.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

async function handler(args: { include_counter_model?: boolean }) {
  try {
    const warnings: string[] = [];

    const serverInfoFetch = catchWarn(
      client.getServerInfo(),
      [], warnings, "serverInfo",
    );
    const counterModelFetch = args.include_counter_model
      ? catchWarn(client.getCounterModel(), null, warnings, "counterModel")
      : Promise.resolve(null);

    const [serverInfo, counterModel] = await Promise.all([serverInfoFetch, counterModelFetch]);

    const output: Record<string, unknown> = {
      servers: serverInfo,
    };
    if (counterModel !== null) output.counterModel = counterModel;
    if (warnings.length > 0) output.warnings = warnings;

    return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
  } catch (e) {
    if (e instanceof UnsupportedOperationError) {
      return { content: [{ type: "text" as const, text: jsonStringify({ error: "This operation requires HTTP mode", detail: e.message, hint: "Configure SCOUTER_API_URL instead of SCOUTER_TCP_HOST to enable this feature" }) }] };
    }
    throw e;
  }
}
