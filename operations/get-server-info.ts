import { z } from "zod";
import { defineOperation, type OperationContext } from "./definition.js";
import { catchWarn, UnsupportedOperationError } from "../client/index.js";

const inputShape = {
  include_counter_model: z.boolean().optional().default(false).describe(
    "Include available counter definitions (names, display names, units). Useful for discovering which counters can be queried with get_counter_trend.",
  ),
};

export const operation = defineOperation({
  name: "get_server_info",
  title: "Get Server Info",
  description: "Get Scouter collector server metadata: version, ID, connection status. Optionally includes counter model (all available performance counter definitions with display names and units). Use this to discover what counters exist before querying get_counter_trend. Counter model requires HTTP mode.",
  inputShape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  execute,
});

async function execute(ctx: OperationContext, args: { include_counter_model?: boolean }) {
  try {
    const warnings: string[] = [];

    const serverInfoFetch = catchWarn(
      ctx.client.getServerInfo(),
      [], warnings, "serverInfo",
    );
    const counterModelFetch = args.include_counter_model
      ? catchWarn(ctx.client.getCounterModel(), null, warnings, "counterModel")
      : Promise.resolve(null);

    const [serverInfo, counterModel] = await Promise.all([serverInfoFetch, counterModelFetch]);

    const output: Record<string, unknown> = {
      servers: serverInfo,
    };
    if (counterModel !== null) {
      const raw = counterModel as Record<string, unknown>;
      const families = raw.families as Array<Record<string, unknown>> | undefined;
      if (families) {
        output.counterModel = families
          .map(f => ({
            family: f.name,
            counters: (f.counters as Array<Record<string, unknown>> | undefined)?.map(c => ({
              name: c.name, displayName: c.displayName, unit: c.unit,
            })) ?? [],
          }))
          .filter(f => f.counters.length > 0);
      } else {
        output.counterModel = counterModel;
      }
    }
    if (warnings.length > 0) output.warnings = warnings;

    return output;
  } catch (e) {
    if (e instanceof UnsupportedOperationError) {
      return { error: "This operation requires HTTP mode", detail: e.message, hint: "Configure SCOUTER_API_URL instead of SCOUTER_TCP_HOST to enable this feature" };
    }
    throw e;
  }
}
