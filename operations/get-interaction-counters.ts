import { z } from "zod";
import { defineOperation, type OperationContext } from "./definition.js";
import { catchWarn } from "../client/index.js";
import { millisToIso } from "../time-utils.js";

const inputShape = {
  obj_type: z.string().optional().describe("Object type filter (e.g., 'tomcat'). Ignored if obj_hashes is provided."),
  obj_hashes: z.string().optional().describe("Comma-separated object hashes for specific agents. Overrides obj_type."),
};

export const operation = defineOperation({
  name: "get_interaction_counters",
  title: "Get Interaction Counters",
  description: "Get real-time service-to-service call relationships. Shows which services call which other services, with call counts, error counts, and latency. Useful for understanding service dependencies and topology.",
  inputShape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  execute,
});

interface InteractionData {
  interactionType?: string;
  fromObjHash?: number;
  fromObjName?: string;
  toObjHash?: number;
  toObjName?: string;
  count?: number;
  errorCount?: number;
  totalElapsed?: number;
  period?: number;
  [key: string]: unknown;
}

async function execute(ctx: OperationContext, args: { obj_type?: string; obj_hashes?: string }) {
  const warnings: string[] = [];

  let allInteractions: InteractionData[];
  if (args.obj_hashes) {
    allInteractions = await catchWarn(
      ctx.client.getInteractionCountersByObjHashes(args.obj_hashes) as Promise<InteractionData[]>,
      [], warnings, "interactionCounters(objHashes)",
    );
  } else {
    const objTypes = await ctx.resolveObjType(args.obj_type);
    const results = await Promise.all(
      objTypes.map(type => catchWarn(
        ctx.client.getInteractionCounters(type) as Promise<InteractionData[]>,
        [], warnings, `interactionCounters(${type})`,
      )),
    );
    allInteractions = results.flat();
  }

  const enriched = allInteractions
    .map(item => {
      const count = Number(item.count) || 0;
      const errorCount = Number(item.errorCount) || 0;
      const totalElapsed = Number(item.totalElapsed) || 0;
      return {
        from: item.fromObjName ?? `hash:${item.fromObjHash}`,
        to: item.toObjName ?? `hash:${item.toObjHash}`,
        interactionType: item.interactionType ?? "unknown",
        count,
        errorCount,
        totalElapsed,
        avgElapsed: count > 0 ? Math.round(totalElapsed / count) : 0,
      };
    })
    .sort((a, b) => b.count - a.count);

  const totalCalls = enriched.reduce((sum, e) => sum + e.count, 0);
  const totalErrors = enriched.reduce((sum, e) => sum + e.errorCount, 0);

  const output: Record<string, unknown> = {
    timestamp: millisToIso(Date.now()),
    interactions: enriched,
    summary: {
      totalEdges: enriched.length,
      totalCalls,
      totalErrors,
      overallErrorRate: totalCalls > 0 ? +((totalErrors / totalCalls) * 100).toFixed(2) : 0,
    },
  };
  if (warnings.length > 0) output.warnings = warnings;

  return output;
}
