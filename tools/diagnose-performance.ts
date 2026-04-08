import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, catchWarn, resolveObjType } from "../client/index.js";
import { minutesAgo, now, millisToYmd } from "../time-utils.js";
import { buildResponse, resolveSummaryNames } from "./shared-utils.js";

export const params = {
  obj_type: z.string().optional().describe("Object type filter"),
  time_range_minutes: z.number().optional().default(10).describe("How many minutes back to analyze (max 60)"),
};

export function register(server: McpServer) {
  server.registerTool("diagnose_performance", {
    title: "Diagnose Performance",
    description: "Perform automated multi-step performance diagnosis. Checks system counters, active services, error patterns, slow SQL, and service hotspots. Returns a structured diagnostic report with findings ranked by severity (CRITICAL/WARNING/INFO) and suggested actions.",
    inputSchema: params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, handler);
}

interface Finding {
  severity: "CRITICAL" | "WARNING" | "INFO";
  category: string;
  title: string;
  detail: string;
  suggestedAction: string;
}

interface CounterEntry {
  objHash?: number;
  objName?: string;
  name?: string;
  value?: number;
  [key: string]: unknown;
}

interface ActiveService {
  objName?: string;
  serviceName?: string;
  elapsed?: number;
  mode?: string;
  note?: string;
  [key: string]: unknown;
}

interface SummaryItem {
  summaryKeyName?: string;
  count?: number;
  errorCount?: number;
  elapsedSum?: number;
  [key: string]: unknown;
}

interface AgentObject {
  objHash: number;
  objName: string;
  objType: string;
  alive: boolean;
}

async function handler(args: { obj_type?: string; time_range_minutes?: number }) {
  const warnings: string[] = [];
  const rangeMin = Math.min(args.time_range_minutes ?? 10, 60);
  const startMillis = minutesAgo(rangeMin);
  const endMillis = now();
  const objTypes = await resolveObjType(args.obj_type);
  const objects = await client.getObjects() as AgentObject[];

  const counterNames = "TPS,ElapsedTime,Elapsed90%25,ActiveService,ErrorRate,HeapUsed,HeapTotal,ProcCpu,GcCount";

  // Phase 1: real-time state (parallel) - alerts fetched once, not per-type
  const [typePhase1, alerts] = await Promise.all([
    Promise.all(
      objTypes.map(async (type) => {
        const [counters, activeServices] = await Promise.all([
          catchWarn(client.getRealtimeCounters(counterNames, type), [], warnings, `counters(${type})`),
          catchWarn(client.getActiveServices(type) as Promise<ActiveService[]>, [], warnings, `activeService(${type})`),
        ]);
        return { type, counters, activeServices };
      })
    ),
    catchWarn(client.getRealtimeAlerts(), { alerts: [] }, warnings, "alerts"),
  ]);

  // Phase 2: time-range analysis (parallel)
  const phase2 = await Promise.all(
    objTypes.map(async (type) => {
      const [errors, sqls, services] = await Promise.all([
        catchWarn(client.getSummary("error", type, startMillis, endMillis), [], warnings, `errorSummary(${type})`),
        catchWarn(client.getSummary("sql", type, startMillis, endMillis), [], warnings, `sqlSummary(${type})`),
        catchWarn(client.getSummary("service", type, startMillis, endMillis), [], warnings, `serviceSummary(${type})`),
      ]);
      return { type, errors, sqls, services };
    })
  );

  const findings: Finding[] = [];

  const objNameByHash = new Map(objects.map(o => [o.objHash, o.objName]));
  const allCountersRaw = typePhase1.flatMap(p => p.counters as CounterEntry[]);
  for (const c of allCountersRaw) {
    if (!c.objName && c.objHash != null) {
      c.objName = objNameByHash.get(Number(c.objHash)) ?? String(c.objHash);
    }
  }

  // Analyze: dead agents
  const deadAgents = objects.filter(o => !o.alive);
  for (const agent of deadAgents) {
    findings.push({
      severity: "CRITICAL",
      category: "DEAD_AGENT",
      title: `Agent down: ${agent.objName}`,
      detail: `Agent ${agent.objName} (${agent.objType}) is not responding`,
      suggestedAction: "Check if the application process is running. Use get_system_overview for full agent status.",
    });
  }

  // Analyze: counters
  const countersByName = groupBy(allCountersRaw, c => c.name ?? "");

  analyzeCounter(countersByName, "ErrorRate", 5, "CRITICAL", "HIGH_ERROR_RATE", findings,
    "High error rate detected", "Use get_error_summary to identify error patterns, then get_transaction_detail on sample txids.");
  analyzeCounter(countersByName, "ElapsedTime", 3000, "WARNING", "HIGH_RESPONSE_TIME", findings,
    "High average response time", "Use search_transactions to find slow transactions, then get_transaction_detail for profiling.");
  analyzeCounter(countersByName, "ProcCpu", 80, "WARNING", "HIGH_CPU", findings,
    "High CPU usage", "Use get_thread_dump to analyze thread activity.");
  analyzeCounter(countersByName, "GcCount", 10, "WARNING", "HIGH_GC", findings,
    "Frequent garbage collection", "Use get_thread_dump with include_heap_histogram to analyze memory usage.");

  // Analyze: heap pressure
  const heapUsed = countersByName["HeapUsed"] ?? [];
  const heapTotal = countersByName["HeapTotal"] ?? [];
  for (const used of heapUsed) {
    const total = heapTotal.find(t => t.objName === used.objName);
    if (total && total.value && used.value && (used.value / total.value) > 0.85) {
      findings.push({
        severity: "WARNING",
        category: "HEAP_PRESSURE",
        title: `Heap pressure on ${used.objName}: ${((used.value / total.value) * 100).toFixed(1)}%`,
        detail: `Used: ${Math.round(used.value / 1024 / 1024)}MB / Total: ${Math.round(total.value / 1024 / 1024)}MB`,
        suggestedAction: "Use get_thread_dump with include_heap_histogram=true to identify memory consumers.",
      });
    }
  }

  // Analyze: long active services
  const allActive = typePhase1.flatMap(p => p.activeServices as ActiveService[]);
  const longRunning = allActive.filter(s => (s.elapsed ?? 0) > 30000);
  for (const svc of longRunning) {
    findings.push({
      severity: "CRITICAL",
      category: "LONG_ACTIVE_SERVICE",
      title: `Long-running request on ${svc.objName}: ${svc.elapsed}ms`,
      detail: `Service: ${svc.serviceName}, Mode: ${svc.mode}, Note: ${svc.note ?? "N/A"}`,
      suggestedAction: "Use list_active_services for full view, get_thread_dump to check thread state.",
    });
  }

  // Analyze: alerts
  const allAlerts = ((alerts as { alerts?: unknown[] }).alerts ?? []) as Array<{ title?: string; message?: string; level?: string; objName?: string }>;
  for (const alert of allAlerts.slice(0, 5)) {
    findings.push({
      severity: "INFO",
      category: "ALERT",
      title: `Alert: ${alert.title}`,
      detail: `${alert.message ?? ""} (${alert.objName ?? ""})`,
      suggestedAction: "Review alert context and check related metrics.",
    });
  }

  // Analyze: slow SQL
  const allSqls = phase2.flatMap(p => p.sqls as SummaryItem[]);
  const slowSqls = allSqls
    .filter(s => Number(s.count) > 0 && Number(s.elapsedSum) > 0 && (Number(s.elapsedSum) / Number(s.count)) > 1000)
    .sort((a, b) => (Number(b.elapsedSum) || 0) - (Number(a.elapsedSum) || 0));
  if (slowSqls.length > 0) {
    findings.push({
      severity: "WARNING",
      category: "SLOW_SQL",
      title: `${slowSqls.length} slow SQL queries detected (avg > 1s)`,
      detail: slowSqls.slice(0, 3).map(s =>
        `${s.summaryKeyName?.slice(0, 80)}... avg=${Math.round((s.elapsedSum ?? 0) / (s.count ?? 1))}ms`
      ).join("\n"),
      suggestedAction: "Use get_sql_analysis for full SQL performance breakdown.",
    });
  }

  // Build summary
  const allServices = phase2.flatMap(p => p.services as SummaryItem[]);
  const n = (v: unknown) => Number(v) || 0;

  const queryDate = millisToYmd(startMillis);
  await Promise.all([
    resolveSummaryNames(allServices, "service", queryDate),
    resolveSummaryNames(allSqls, "sql", queryDate),
  ]);

  const topSlowSqls = allSqls
    .sort((a, b) => n(b.elapsedSum) - n(a.elapsedSum))
    .slice(0, 5)
    .map(s => {
      const raw = s.summaryKeyName ?? "";
      const sql = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
      return { sql: sql.length > 300 ? sql.slice(0, 300) + "..." : sql, count: n(s.count), avgElapsed: n(s.count) > 0 ? Math.round(n(s.elapsedSum) / n(s.count)) : 0 };
    });
  const topErrorServices = allServices
    .filter(s => n(s.errorCount) > 0)
    .sort((a, b) => n(b.errorCount) - n(a.errorCount))
    .slice(0, 5)
    .map(s => ({ service: s.summaryKeyName, errorCount: n(s.errorCount), errorRate: n(s.count) > 0 ? +(n(s.errorCount) / n(s.count) * 100).toFixed(2) : 0 }));
  const topSlowServices = allServices
    .filter(s => n(s.count) > 0)
    .sort((a, b) => (n(b.elapsedSum) / n(b.count || 1)) - (n(a.elapsedSum) / n(a.count || 1)))
    .slice(0, 5)
    .map(s => ({ service: s.summaryKeyName, avgElapsed: Math.round(n(s.elapsedSum) / n(s.count || 1)), count: n(s.count) }));

  const tpsValues = (countersByName["TPS"] ?? []).map(c => c.value ?? 0);
  const elapsedValues = (countersByName["ElapsedTime"] ?? []).map(c => c.value ?? 0);
  const errorRateValues = (countersByName["ErrorRate"] ?? []).map(c => c.value ?? 0);

  findings.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));

  const output: Record<string, unknown> = {
    diagnosisTime: new Date().toISOString(),
    timeRangeMinutes: rangeMin,
    findings,
    systemSnapshot: {
      aliveAgents: objects.filter(o => o.alive).length,
      deadAgents: deadAgents.length,
      avgTps: avg(tpsValues),
      avgElapsed: avg(elapsedValues),
      avgErrorRate: avg(errorRateValues),
      totalActiveServices: allActive.length,
      maxActiveElapsed: allActive.reduce((max, s) => Math.max(max, s.elapsed ?? 0), 0),
    },
    topSlowSqls,
    topErrorServices,
    topSlowServices,
  };
  return buildResponse(output, warnings);
}

function severityOrder(s: string): number {
  return s === "CRITICAL" ? 0 : s === "WARNING" ? 1 : 2;
}

function avg(values: number[]): number {
  return values.length > 0 ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : 0;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}

function analyzeCounter(
  countersByName: Record<string, CounterEntry[]>,
  name: string,
  threshold: number,
  severity: "CRITICAL" | "WARNING",
  category: string,
  findings: Finding[],
  title: string,
  suggestedAction: string
) {
  const entries = countersByName[name] ?? [];
  const overThreshold = entries.filter(c => (c.value ?? 0) > threshold);
  for (const entry of overThreshold) {
    findings.push({
      severity,
      category,
      title: `${title}: ${entry.objName} = ${entry.value}`,
      detail: `${name} = ${entry.value} (threshold: ${threshold})`,
      suggestedAction,
    });
  }
}
