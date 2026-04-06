import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, UnsupportedOperationError } from "../client/index.js";

export const params = {
  obj_hash: z.number().describe("Target agent object hash (from get_system_overview or list_active_services)"),
  thread_id: z.number().describe("Thread ID to control (from list_active_services or get_agent_info)"),
  action: z.enum(["resume", "suspend", "stop", "interrupt"]).describe(
    "Action to perform: 'resume' resumes a suspended thread, 'suspend' suspends execution, 'stop' stops the thread, 'interrupt' interrupts the thread",
  ),
};

export function register(server: McpServer) {
  server.registerTool("control_thread", {
    title: "Control Thread",
    description: "[HTTP mode only] Control a specific thread on a JVM agent: resume, suspend, stop, or interrupt. Use list_active_services to find active thread IDs, or get_agent_info to see all threads. WARNING: 'stop' is dangerous and can leave the JVM in an inconsistent state.",
    inputSchema: params,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, handler);
}

async function handler(args: { obj_hash: number; thread_id: number; action: string }) {
  try {
    const warnings: string[] = [];

    const result = await catchWarn(
      client.controlThread(args.obj_hash, args.thread_id, args.action),
      null, warnings, "controlThread",
    );

    const output: Record<string, unknown> = {
      objHash: args.obj_hash,
      threadId: args.thread_id,
      action: args.action,
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
