import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, resolveObjType } from "../client/index.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter (e.g. 'tomcat'). Auto-discovers if omitted."),
};

export function register(server: McpServer) {
  server.registerTool("get_system_overview", {
    title: "Get System Overview",
    description: "Get a comprehensive snapshot of current system status: agents, real-time counters (TPS, response time, heap, CPU), active service counts, and recent alerts. Use this as the starting point for any investigation.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

async function handler({ obj_type }: { obj_type?: string }) {
  const warnings: string[] = [];
  const objTypes = await resolveObjType(obj_type);
  const objects = await client.getObjects();

  const aliveAgents = objects.filter(o => o.alive);
  const deadAgents = objects.filter(o => !o.alive);

  const counterNames = "TPS,ElapsedTime,Elapsed90%25,ActiveService,ErrorRate,HeapUsed,HeapTotal,ProcCpu,GcCount";

  const [typeResults, alerts] = await Promise.all([
    Promise.all(
      objTypes.map(async (type) => {
        const [counters, steps] = await Promise.all([
          catchWarn(client.getRealtimeCounters(counterNames, type), [], warnings, `counters(${type})`),
          catchWarn(client.getActiveServiceStepCount(type), [], warnings, `stepCount(${type})`),
        ]);
        return { type, counters, steps };
      })
    ),
    catchWarn(client.getRealtimeAlerts(), { alerts: [] }, warnings, "alerts"),
  ]);

  const output: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    agents: {
      alive: aliveAgents.map(a => ({ objName: a.objName, objType: a.objType, objHash: a.objHash, address: a.address })),
      dead: deadAgents.map(a => ({ objName: a.objName, objType: a.objType, objHash: a.objHash })),
      aliveCount: aliveAgents.length,
      deadCount: deadAgents.length,
    },
    countersByType: Object.fromEntries(typeResults.map(r => [r.type, r.counters])),
    activeServiceSteps: Object.fromEntries(typeResults.map(r => [r.type, r.steps])),
    recentAlerts: alerts,
  };
  if (warnings.length > 0) output.warnings = warnings;

  return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
}
