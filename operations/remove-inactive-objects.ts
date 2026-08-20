import { z } from "zod";
import { defineOperation, type OperationContext } from "./definition.js";
import { catchWarn, UnsupportedOperationError } from "../client/index.js";

const inputShape = {
  server_id: z.number().optional().describe(
    "If provided, removes inactive objects only for this specific collector server. If omitted, removes inactive objects across all servers.",
  ),
};

export const operation = defineOperation({
  name: "remove_inactive_objects",
  title: "Remove Inactive Objects",
  description: "[HTTP mode only] Remove all inactive (dead) monitored objects from the Scouter server. Inactive objects are agents that are no longer sending data. Use get_system_overview to check which objects are alive/dead before removing.",
  inputShape,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  execute,
});

async function execute(ctx: OperationContext, args: { server_id?: number }) {
  try {
    const warnings: string[] = [];

    const result = args.server_id !== undefined
      ? await catchWarn(ctx.client.removeInactiveServer(), null, warnings, "removeInactiveServer")
      : await catchWarn(ctx.client.removeInactiveAll(), null, warnings, "removeInactiveAll");

    const output: Record<string, unknown> = {
      scope: args.server_id !== undefined ? `server ${args.server_id}` : "all servers",
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
