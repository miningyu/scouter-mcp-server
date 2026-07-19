import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { todayYmd } from "../../time-utils.js";

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

interface ToolRegistration {
  name: string;
  config: Record<string, unknown>;
  handler: Handler;
}

function createMockServer(): { server: McpServer; tools: Map<string, ToolRegistration> } {
  const tools = new Map<string, ToolRegistration>();
  const server = {
    registerTool: vi.fn((name: string, config: Record<string, unknown>, handler: Handler) => {
      tools.set(name, { name, config, handler });
      return {} as never;
    }),
  } as unknown as McpServer;
  return { server, tools };
}

function parseToolOutput(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

vi.mock("../../client/index.js", () => {
  const mockClient = {
    getObjects: vi.fn().mockResolvedValue([
      { objHash: 1, objName: "/app/tomcat1", objType: "tomcat", address: "10.0.0.1", alive: true },
      { objHash: 2, objName: "/app/tomcat2", objType: "tomcat", address: "10.0.0.2", alive: true },
      { objHash: 3, objName: "/dead/agent", objType: "tomcat", address: "10.0.0.3", alive: false },
    ]),
    getSummary: vi.fn(async (category: string) => {
      switch (category) {
        case "alert":
          return [
            { summaryKeyName: "TPS_HIGH", count: 10 },
            { summaryKeyName: "CPU_HIGH", count: 25 },
          ];
        case "error":
          return [
            { summaryKeyName: "hash:501", count: 10, errorHash: 9001 },
            { summaryKeyName: "already-resolved-error", count: 5, errorHash: 0 },
          ];
        case "service":
          return [
            { summaryKeyName: "/api/a", count: 100, errorCount: 5, elapsedSum: 5000, cpuSum: 200, memorySum: 1000 },
            { summaryKeyName: "/api/b", count: 50, errorCount: 20, elapsedSum: 6000, cpuSum: 50, memorySum: 500 },
          ];
        case "apiCall":
          return [
            { summaryKeyName: "hash:801", count: 20, errorCount: 2, elapsedSum: 800, cpuSum: 0, memorySum: 0 },
          ];
        case "ip":
          return [
            { summaryKeyName: "hash:701", count: 50 },
            { summaryKeyName: "10.0.0.5", count: 30 },
          ];
        case "userAgent":
          return [
            { summaryKeyName: "Mozilla/5.0 Chrome", count: 40 },
            { summaryKeyName: "x".repeat(200), count: 10 },
          ];
        default:
          return [];
      }
    }),
    getSummaryByObjHash: vi.fn(async (category: string) => {
      switch (category) {
        case "alert":
          return [{ summaryKeyName: "OBJ_ALERT", count: 3 }];
        case "error":
          return [{ summaryKeyName: "obj-error", count: 2, errorHash: 0 }];
        case "service":
          return [{ summaryKeyName: "/api/obj", count: 20, errorCount: 1, elapsedSum: 400, cpuSum: 10, memorySum: 40 }];
        case "apiCall":
          return [];
        case "ip":
          return [{ summaryKeyName: "10.1.1.1", count: 5 }];
        case "userAgent":
          return [{ summaryKeyName: "obj-ua", count: 5 }];
        default:
          return [];
      }
    }),
    lookupTexts: vi.fn(async (_date: string, type: string) => {
      if (type === "service") return { "501": "/api/foo" };
      if (type === "error") return { "9001": "NullPointerException: foo is null" };
      if (type === "apicall") return { "801": "external-payment-api" };
      if (type === "ip") return { "701": "10.0.0.99" };
      return {};
    }),
    getVisitorRealtimeByObjType: vi.fn().mockResolvedValue(15),
    getVisitorRealtimeByObjHash: vi.fn().mockResolvedValue(7),
    getVisitorRealtimeByObjHashes: vi.fn().mockResolvedValue(22),
    getVisitorDailyByObjType: vi.fn().mockResolvedValue(500),
    getVisitorDailyByObjHash: vi.fn().mockResolvedValue(120),
    getVisitorGroup: vi.fn().mockResolvedValue({ totalVisitors: 999 }),
    getVisitorHourly: vi.fn().mockResolvedValue([{ hour: "2024010100", count: 10 }]),
  };

  return {
    client: mockClient,
    jsonStringify: (obj: unknown) => JSON.stringify(obj, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2),
    catchWarn: async <T>(promise: Promise<T>, fallback: T, warnings: string[], ctx: string): Promise<T> => {
      try {
        return await promise;
      } catch (e) {
        warnings.push(`[${ctx}] ${e instanceof Error ? e.message : String(e)}`);
        return fallback;
      }
    },
    resolveObjType: async (objType?: string) => objType ? [objType] : ["tomcat"],
    discoverObjTypes: async () => ["tomcat"],
    UnsupportedOperationError: class extends Error {
      constructor(method: string) { super(`${method} is not supported via TCP`); }
    },
  };
});

// Import after vi.mock so we get the mocked client instance for per-test overrides.
import { client } from "../../client/index.js";

beforeEach(() => {
  process.env.SCOUTER_MASK_PII = "false";
});
afterEach(() => {
  delete process.env.SCOUTER_MASK_PII;
});

describe("get_alert_summary handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-alert-summary.js");
    mod.register(server);
    handler = tools.get("get_alert_summary")!.handler;
  });

  it("should return alerts sorted by count with totals", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalAlertCount).toBe(35);
    expect(output.uniqueAlertTypes).toBe(2);
    const alerts = output.alerts as Array<Record<string, unknown>>;
    expect(alerts[0]).toEqual({ alertTitle: "CPU_HIGH", count: 25 });
    expect(alerts[1]).toEqual({ alertTitle: "TPS_HIGH", count: 10 });
  });

  it("should respect max_count", async () => {
    const result = await handler({ max_count: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const alerts = output.alerts as Array<Record<string, unknown>>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alertTitle).toBe("CPU_HIGH");
  });

  it("should use getSummaryByObjHash when obj_hash is provided", async () => {
    const result = await handler({ obj_hash: 5 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalAlertCount).toBe(3);
    const alerts = output.alerts as Array<Record<string, unknown>>;
    expect(alerts).toEqual([{ alertTitle: "OBJ_ALERT", count: 3 }]);
  });

  it("should handle empty results", async () => {
    vi.mocked(client.getSummary).mockResolvedValueOnce([]);
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalAlertCount).toBe(0);
    expect(output.uniqueAlertTypes).toBe(0);
    expect(output.alerts).toEqual([]);
  });

  it("should collect warnings when the fetch fails", async () => {
    vi.mocked(client.getSummary).mockRejectedValueOnce(new Error("timeout"));
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalAlertCount).toBe(0);
    expect(output.warnings).toEqual(["[alertSummary(tomcat)] timeout"]);
  });
});

describe("get_error_summary handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-error-summary.js");
    mod.register(server);
    handler = tools.get("get_error_summary")!.handler;
  });

  it("should return errors with resolved names/messages and service error rates", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalErrors).toBe(15);
    expect(output.totalTransactions).toBe(150);
    expect(output.overallErrorRate).toBe(10);

    const errors = output.errors as Array<Record<string, unknown>>;
    expect(errors[0].summaryKeyName).toBe("/api/foo");
    expect(errors[0].errorMessage).toBe("NullPointerException: foo is null");
    expect(errors[1].summaryKeyName).toBe("already-resolved-error");
    expect(errors[1].errorMessage).toBeUndefined();

    const rates = output.serviceErrorRates as Array<Record<string, unknown>>;
    expect(rates[0]).toEqual({ service: "/api/b", totalCount: 50, errorCount: 20, errorRate: 40 });
    expect(rates[1]).toEqual({ service: "/api/a", totalCount: 100, errorCount: 5, errorRate: 5 });
  });

  it("should use getSummaryByObjHash when obj_hash is provided", async () => {
    const result = await handler({ obj_hash: 9 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalErrors).toBe(2);
    expect(output.totalTransactions).toBe(20);
    expect(output.overallErrorRate).toBe(10);
    const errors = output.errors as Array<Record<string, unknown>>;
    expect(errors[0]).toEqual({ summaryKeyName: "obj-error", count: 2, errorHash: 0 });
  });

  it("should handle empty error results", async () => {
    vi.mocked(client.getSummary).mockResolvedValueOnce([]);
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalErrors).toBe(0);
    expect(output.overallErrorRate).toBe(0);
    expect(output.errors).toEqual([]);
  });

  it("should collect warnings when the error fetch fails", async () => {
    vi.mocked(client.getSummary).mockRejectedValueOnce(new Error("boom"));
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalErrors).toBe(0);
    const warnings = output.warnings as string[];
    expect(warnings).toContain("[errorSummary(tomcat)] boom");
  });
});

describe("get_ip_summary handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-ip-summary.js");
    mod.register(server);
    handler = tools.get("get_ip_summary")!.handler;
  });

  it("should return ips resolved and sorted with pctOfTotal", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalRequests).toBe(80);
    expect(output.uniqueIps).toBe(2);
    const ips = output.ips as Array<Record<string, unknown>>;
    expect(ips[0]).toEqual({ ip: "10.0.0.99", count: 50, pctOfTotal: 62.5 });
    expect(ips[1]).toEqual({ ip: "10.0.0.5", count: 30, pctOfTotal: 37.5 });
  });

  it("should respect max_count", async () => {
    const result = await handler({ max_count: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const ips = output.ips as Array<Record<string, unknown>>;
    expect(ips).toHaveLength(1);
    expect(ips[0].ip).toBe("10.0.0.99");
  });

  it("should use getSummaryByObjHash when obj_hash is provided", async () => {
    const result = await handler({ obj_hash: 5 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalRequests).toBe(5);
    expect(output.uniqueIps).toBe(1);
    const ips = output.ips as Array<Record<string, unknown>>;
    expect(ips[0]).toEqual({ ip: "10.1.1.1", count: 5, pctOfTotal: 100 });
  });

  it("should handle empty results", async () => {
    vi.mocked(client.getSummary).mockResolvedValueOnce([]);
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalRequests).toBe(0);
    expect(output.uniqueIps).toBe(0);
    expect(output.ips).toEqual([]);
  });

  it("should collect warnings when the fetch fails", async () => {
    vi.mocked(client.getSummary).mockRejectedValueOnce(new Error("timeout"));
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalRequests).toBe(0);
    const warnings = output.warnings as string[];
    expect(warnings).toContain("[ipSummary(tomcat)] timeout");
  });
});

describe("get_user_agent_summary handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-user-agent-summary.js");
    mod.register(server);
    handler = tools.get("get_user_agent_summary")!.handler;
  });

  it("should return user agents sorted with truncation and pctOfTotal", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalRequests).toBe(50);
    expect(output.uniqueUserAgents).toBe(2);
    const uas = output.userAgents as Array<Record<string, unknown>>;
    expect(uas[0]).toEqual({ userAgent: "Mozilla/5.0 Chrome", count: 40, pctOfTotal: 80 });
    expect((uas[1].userAgent as string).length).toBe(153);
    expect(uas[1].userAgent as string).toBe("x".repeat(150) + "...");
    expect(uas[1].count).toBe(10);
  });

  it("should respect max_count", async () => {
    const result = await handler({ max_count: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const uas = output.userAgents as Array<Record<string, unknown>>;
    expect(uas).toHaveLength(1);
    expect(uas[0].userAgent).toBe("Mozilla/5.0 Chrome");
  });

  it("should use getSummaryByObjHash when obj_hash is provided", async () => {
    const result = await handler({ obj_hash: 5 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalRequests).toBe(5);
    const uas = output.userAgents as Array<Record<string, unknown>>;
    expect(uas[0]).toEqual({ userAgent: "obj-ua", count: 5, pctOfTotal: 100 });
  });

  it("should handle empty results", async () => {
    vi.mocked(client.getSummary).mockResolvedValueOnce([]);
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalRequests).toBe(0);
    expect(output.uniqueUserAgents).toBe(0);
    expect(output.userAgents).toEqual([]);
  });

  it("should collect warnings when the fetch fails", async () => {
    vi.mocked(client.getSummary).mockRejectedValueOnce(new Error("timeout"));
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalRequests).toBe(0);
    const warnings = output.warnings as string[];
    expect(warnings).toContain("[userAgentSummary(tomcat)] timeout");
  });
});

describe("get_service_summary handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-service-summary.js");
    mod.register(server);
    handler = tools.get("get_service_summary")!.handler;
  });

  it("should return enriched services and api calls with default count sort", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const services = output.services as Array<Record<string, unknown>>;
    expect(services[0]).toEqual({
      service: "/api/a", count: 100, errorCount: 5, elapsedSum: 5000,
      errorRate: 5, avgElapsed: 50, cpuSum: 200, avgCpu: 2, memorySum: 1000, avgMemory: 10,
    });
    expect(services[1].service).toBe("/api/b");

    const apiCalls = output.apiCalls as Array<Record<string, unknown>>;
    expect(apiCalls).toEqual([{ service: "external-payment-api", count: 20, errorCount: 2, elapsedSum: 800, avgElapsed: 40 }]);

    const totals = output.totals as Record<string, unknown>;
    expect(totals).toEqual({ totalServiceCalls: 150, totalErrors: 25, overallAvgElapsed: 73, overallErrorRate: 16.67 });
  });

  it("should sort by each sort_by key", async () => {
    const byCount = parseToolOutput(await handler({ sort_by: "count" }, {})) as Record<string, unknown>;
    expect((byCount.services as Array<Record<string, unknown>>)[0].service).toBe("/api/a");

    const byErrorCount = parseToolOutput(await handler({ sort_by: "error_count" }, {})) as Record<string, unknown>;
    expect((byErrorCount.services as Array<Record<string, unknown>>)[0].service).toBe("/api/b");

    const byAvgElapsed = parseToolOutput(await handler({ sort_by: "avg_elapsed" }, {})) as Record<string, unknown>;
    expect((byAvgElapsed.services as Array<Record<string, unknown>>)[0].service).toBe("/api/b");

    const byElapsedSum = parseToolOutput(await handler({ sort_by: "elapsed_sum" }, {})) as Record<string, unknown>;
    expect((byElapsedSum.services as Array<Record<string, unknown>>)[0].service).toBe("/api/b");

    const byErrorRate = parseToolOutput(await handler({ sort_by: "error_rate" }, {})) as Record<string, unknown>;
    expect((byErrorRate.services as Array<Record<string, unknown>>)[0].service).toBe("/api/b");
  });

  it("should skip api call fetch when include_api_calls is false", async () => {
    const result = await handler({ include_api_calls: false }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.apiCalls).toEqual([]);
  });

  it("should use getSummaryByObjHash when obj_hash is provided", async () => {
    const result = await handler({ obj_hash: 5 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const services = output.services as Array<Record<string, unknown>>;
    expect(services[0].service).toBe("/api/obj");
    expect(output.apiCalls).toEqual([]);
  });

  it("should skip api call fetch for obj_hash when include_api_calls is false", async () => {
    const result = await handler({ obj_hash: 5, include_api_calls: false }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.apiCalls).toEqual([]);
  });

  it("should sort multiple api calls by elapsedSum", async () => {
    vi.mocked(client.getSummary)
      .mockResolvedValueOnce([]) // service (unused in this test)
      .mockResolvedValueOnce([
        { summaryKeyName: "slow-api", count: 5, errorCount: 0, elapsedSum: 5000, cpuSum: 0, memorySum: 0 },
        { summaryKeyName: "fast-api", count: 10, errorCount: 0, elapsedSum: 100, cpuSum: 0, memorySum: 0 },
        { summaryKeyName: "zero-api", count: 0, errorCount: 0, elapsedSum: 0, cpuSum: 0, memorySum: 0 },
      ]);
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const apiCalls = output.apiCalls as Array<Record<string, unknown>>;
    expect(apiCalls.map(c => c.service)).toEqual(["slow-api", "fast-api", "zero-api"]);
    expect(apiCalls[2].avgElapsed).toBe(0);
  });

  it("should handle empty service results", async () => {
    vi.mocked(client.getSummary).mockResolvedValueOnce([]);
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.services).toEqual([]);
    const totals = output.totals as Record<string, unknown>;
    expect(totals).toEqual({ totalServiceCalls: 0, totalErrors: 0, overallAvgElapsed: 0, overallErrorRate: 0 });
  });

  it("should collect warnings when the service fetch fails", async () => {
    vi.mocked(client.getSummary).mockRejectedValueOnce(new Error("boom"));
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.services).toEqual([]);
    const warnings = output.warnings as string[];
    expect(warnings).toContain("[serviceSummary(tomcat)] boom");
  });
});

describe("get_visitor_stats handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-visitor-stats.js");
    mod.register(server);
    handler = tools.get("get_visitor_stats")!.handler;
  });

  describe("realtime mode", () => {
    it("should return total for obj_hashes", async () => {
      const result = await handler({ mode: "realtime", obj_hashes: "10,20" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.mode).toBe("realtime");
      expect(output.objHashes).toBe("10,20");
      expect(output.total).toBe(22);
    });

    it("should return visitors for a single obj_hash", async () => {
      const result = await handler({ mode: "realtime", obj_hash: 7 }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.visitors).toEqual([{ objHash: 7, count: 7 }]);
      expect(output.total).toBe(7);
    });

    it("should return per-objType visitors by default", async () => {
      const result = await handler({ mode: "realtime" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.visitors).toEqual([{ objType: "tomcat", count: 15 }]);
      expect(output.total).toBe(15);
    });

    it("should collect warnings when the fetch fails", async () => {
      vi.mocked(client.getVisitorRealtimeByObjType).mockRejectedValueOnce(new Error("down"));
      const result = await handler({ mode: "realtime" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.total).toBe(0);
      const warnings = output.warnings as string[];
      expect(warnings).toContain("[visitorRealtime(tomcat)] down");
    });

    it("should collect warnings for the obj_hashes branch", async () => {
      vi.mocked(client.getVisitorRealtimeByObjHashes).mockRejectedValueOnce(new Error("down"));
      const result = await handler({ mode: "realtime", obj_hashes: "10,20" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.total).toBe(0);
      const warnings = output.warnings as string[];
      expect(warnings).toContain("[visitorRealtime(hashes:10,20)] down");
    });

    it("should collect warnings for the obj_hash branch", async () => {
      vi.mocked(client.getVisitorRealtimeByObjHash).mockRejectedValueOnce(new Error("down"));
      const result = await handler({ mode: "realtime", obj_hash: 7 }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.total).toBe(0);
      const warnings = output.warnings as string[];
      expect(warnings).toContain("[visitorRealtime(obj:7)] down");
    });
  });

  describe("daily mode", () => {
    it("should return visitors for a single obj_hash", async () => {
      const result = await handler({ mode: "daily", obj_hash: 5 }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.visitors).toEqual([{ objHash: 5, count: 120 }]);
      expect(output.total).toBe(120);
    });

    it("should use the provided date and per-objType visitors", async () => {
      const result = await handler({ mode: "daily", date: "20240101" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.date).toBe("20240101");
      expect(output.visitors).toEqual([{ objType: "tomcat", count: 500 }]);
      expect(output.total).toBe(500);
    });

    it("should default the date to today", async () => {
      const result = await handler({ mode: "daily" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.date).toBe(todayYmd());
    });

    it("should collect warnings when the fetch fails", async () => {
      vi.mocked(client.getVisitorDailyByObjType).mockRejectedValueOnce(new Error("boom"));
      const result = await handler({ mode: "daily" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.total).toBe(0);
      const warnings = output.warnings as string[];
      expect(warnings).toContain("[visitorDaily(tomcat)] boom");
    });

    it("should collect warnings for the obj_hash branch", async () => {
      vi.mocked(client.getVisitorDailyByObjHash).mockRejectedValueOnce(new Error("boom"));
      const result = await handler({ mode: "daily", obj_hash: 5 }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.total).toBe(0);
      const warnings = output.warnings as string[];
      expect(warnings).toContain("[visitorDaily(obj:5)] boom");
    });
  });

  describe("hourly mode", () => {
    it("should return hourly data for matching agents", async () => {
      const result = await handler({ mode: "hourly", obj_type: "tomcat" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.agents).toEqual(["/app/tomcat1", "/app/tomcat2"]);
      expect(output.hourlyData).toEqual([{ hour: "2024010100", count: 10 }]);
      expect(output.timeRange).toBeDefined();
    });

    it("should return an error when no agents match", async () => {
      const result = await handler({ mode: "hourly", obj_type: "nonexistent" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output).toEqual({ mode: "hourly", error: "No matching agents found" });
    });

    it("should include all alive agents when obj_type is not provided", async () => {
      const result = await handler({ mode: "hourly" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.agents).toEqual(["/app/tomcat1", "/app/tomcat2"]);
    });

    it("should collect warnings when the fetch fails", async () => {
      vi.mocked(client.getVisitorHourly).mockRejectedValueOnce(new Error("boom"));
      const result = await handler({ mode: "hourly", obj_type: "tomcat" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.hourlyData).toEqual([]);
      const warnings = output.warnings as string[];
      expect(warnings).toContain("[visitorHourly] boom");
    });
  });

  describe("group mode", () => {
    it("should use provided obj_hashes directly", async () => {
      const result = await handler({ mode: "group", obj_hashes: "100,200" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.objHashes).toBe("100,200");
      expect(output.groupData).toEqual({ totalVisitors: 999 });
    });

    it("should resolve obj_hashes from obj_type when not provided", async () => {
      const result = await handler({ mode: "group", obj_type: "tomcat" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.objHashes).toBe("1,2");
      expect(output.groupData).toEqual({ totalVisitors: 999 });
    });

    it("should return an error when no agents match", async () => {
      const result = await handler({ mode: "group", obj_type: "nonexistent" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output).toEqual({ mode: "group", error: "No matching agents found" });
    });

    it("should include all alive agents when obj_type is not provided", async () => {
      const result = await handler({ mode: "group" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.objHashes).toBe("1,2");
    });

    it("should collect warnings when the fetch fails", async () => {
      vi.mocked(client.getVisitorGroup).mockRejectedValueOnce(new Error("boom"));
      const result = await handler({ mode: "group", obj_hashes: "1,2" }, {});
      const output = parseToolOutput(result) as Record<string, unknown>;
      expect(output.groupData).toBeNull();
      const warnings = output.warnings as string[];
      expect(warnings).toContain("[visitorGroup] boom");
    });
  });
});
