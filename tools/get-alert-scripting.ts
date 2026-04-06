import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, UnsupportedOperationError } from "../client/index.js";

export const params = {
  counter_name: z.string().describe("Counter name to read alert scripting config for (e.g., 'TPS', 'ElapsedTime')"),
  include_compile_log: z.boolean().optional().default(false).describe("Include script compile log (requires loop/index from previous alert scripting response)"),
  log_loop: z.number().optional().describe("Compile log loop value (from scripting response)"),
  log_index: z.number().optional().describe("Compile log index value (from scripting response)"),
};

export function register(server: McpServer) {
  server.registerTool("get_alert_scripting", {
    title: "Get Alert Scripting",
    description: "[HTTP mode only] Read alert scripting configuration for a specific counter (read-only). Shows the current alert script, threshold rules, and configuration. Use get_server_info with include_counter_model to discover available counter names.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

async function handler(args: { counter_name: string; include_compile_log?: boolean; log_loop?: number; log_index?: number }) {
  try {
    const warnings: string[] = [];

    const scripting = await catchWarn(
      client.getAlertScripting(args.counter_name),
      null, warnings, "alertScripting",
    );

    const output: Record<string, unknown> = {
      counterName: args.counter_name,
      scripting,
    };

    if (args.include_compile_log && args.log_loop !== undefined && args.log_index !== undefined) {
      const compileLog = await catchWarn(
        client.readAlertScriptingLog(args.log_loop, args.log_index),
        null, warnings, "alertScriptingLog",
      );
      output.compileLog = compileLog;
    }

    if (warnings.length > 0) output.warnings = warnings;

    return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
  } catch (e) {
    if (e instanceof UnsupportedOperationError) {
      return { content: [{ type: "text" as const, text: jsonStringify({ error: "This operation requires HTTP mode", detail: e.message, hint: "Configure SCOUTER_API_URL instead of SCOUTER_TCP_HOST to enable this feature" }) }] };
    }
    throw e;
  }
}
