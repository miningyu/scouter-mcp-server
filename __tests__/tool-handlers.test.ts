import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

vi.mock("../client/index.js", () => {
  const mockClient = {
    getObjects: vi.fn().mockResolvedValue([
      { objHash: 1, objName: "/app/tomcat1", objType: "tomcat", address: "10.0.0.1", alive: true },
      { objHash: 2, objName: "/app/tomcat2", objType: "tomcat", address: "10.0.0.2", alive: true },
      { objHash: 3, objName: "/dead/agent", objType: "tomcat", address: "10.0.0.3", alive: false },
    ]),
    getRealtimeCounters: vi.fn().mockResolvedValue([
      { objHash: 1, objName: "/app/tomcat1", name: "TPS", value: 120 },
      { objHash: 2, objName: "/app/tomcat2", name: "TPS", value: 80 },
    ]),
    getActiveServiceStepCount: vi.fn().mockResolvedValue([]),
    getRealtimeAlerts: vi.fn().mockResolvedValue({ alerts: [] }),
    getActiveServices: vi.fn().mockResolvedValue([]),
    getSummary: vi.fn().mockResolvedValue([]),
    getSummaryByObjHash: vi.fn().mockResolvedValue([]),
    getXLogData: vi.fn().mockResolvedValue([
      { txid: "tx1", elapsed: 5000, service: 123, error: 0, sqlCount: 3, sqlTime: 200 },
      { txid: "tx2", elapsed: 1000, service: 456, error: 789, sqlCount: 1, sqlTime: 50 },
    ]),
    searchXLogData: vi.fn().mockResolvedValue([]),
    lookupTexts: vi.fn().mockResolvedValue({ "123": "/api/users", "456": "/api/orders", "789": "NullPointerException" }),
    getRealtimeXLogData: vi.fn().mockResolvedValue({ xlogs: [], xlogLoop: 1, xlogIndex: 2 }),
    getCounterHistory: vi.fn().mockResolvedValue([
      {
        objName: "/app/tomcat1", objHash: 1,
        valueList: Array.from({ length: 10 }, (_, i) => ({ time: 1700000000000 + i * 2000, value: 100 + i })),
      },
    ]),
    getCounterStat: vi.fn().mockResolvedValue([]),
    getLatestCounter: vi.fn().mockResolvedValue([
      { objName: "/app/tomcat1", objHash: 1, valueList: [{ time: 1700000000000, value: 42 }] },
    ]),
    getServerInfo: vi.fn().mockResolvedValue([{ id: 0, version: "2.21.3" }]),
    getCounterModel: vi.fn().mockResolvedValue({ TPS: { display: "TPS", unit: "count/sec" } }),
    controlThread: vi.fn().mockResolvedValue("OK"),
    removeInactiveAll: vi.fn().mockResolvedValue("removed"),
    removeInactiveServer: vi.fn().mockResolvedValue("removed"),
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

describe("get_system_overview handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../tools/get-system-overview.js");
    mod.register(server);
    handler = tools.get("get_system_overview")!.handler;
  });

  it("should return agents, counters, and alerts", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.timestamp).toBeTruthy();
    expect(output.agents).toBeDefined();
    const agents = output.agents as Record<string, unknown>;
    expect(agents.aliveCount).toBe(2);
    expect(agents.deadCount).toBe(1);
  });

  it("should include countersByType", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.countersByType).toBeDefined();
  });

  it("should filter by obj_type", async () => {
    const result = await handler({ obj_type: "tomcat" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.countersByType).toBeDefined();
  });
});

describe("search_transactions handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../tools/search-transactions.js");
    mod.register(server);
    handler = tools.get("search_transactions")!.handler;
  });

  it("should return sorted transactions with statistics", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalFound).toBe(2);
    expect(output.returned).toBe(2);
    expect(output.transactions).toBeDefined();
    const txs = output.transactions as Array<Record<string, unknown>>;
    expect(txs[0].elapsed).toBeGreaterThanOrEqual(txs[1].elapsed as number);
  });

  it("should include statistics", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const stats = output.statistics as Record<string, number>;
    expect(stats.totalCount).toBe(2);
    expect(stats.maxElapsed).toBe(5000);
  });

  it("should respect max_count limit", async () => {
    const result = await handler({ max_count: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.returned).toBe(1);
  });

  it("should resolve service names", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const txs = output.transactions as Array<Record<string, unknown>>;
    expect(txs.some(t => t.serviceName === "/api/users" || t.serviceName === "/api/orders")).toBe(true);
  });
});

describe("get_counter_trend handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../tools/get-counter-trend.js");
    mod.register(server);
    handler = tools.get("get_counter_trend")!.handler;
  });

  it("should return counter series with stats", async () => {
    const result = await handler({ counter: "TPS" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.counter).toBe("TPS");
    expect(output.precision).toBe("2sec");
    const series = output.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(1);
    expect(series[0].objName).toBe("/app/tomcat1");
    expect(series[0].dataPoints).toBeDefined();
  });

  it("should compute min/max/avg stats", async () => {
    const result = await handler({ counter: "TPS" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const series = output.series as Array<Record<string, unknown>>;
    const stats = series[0].stats as Record<string, number>;
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(109);
    expect(stats.latest).toBe(109);
    expect(stats.avg).toBeCloseTo(104.5, 1);
  });

  it("should handle latest_sec mode", async () => {
    const result = await handler({ counter: "TPS", latest_sec: 60 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.latestSec).toBe(60);
  });
});

describe("get_realtime_xlogs handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../tools/get-realtime-xlogs.js");
    mod.register(server);
    handler = tools.get("get_realtime_xlogs")!.handler;
  });

  it("should return xlogs with next offsets", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.xlogCount).toBe(0);
    const offsets = output.nextOffsets as Record<string, number>;
    expect(offsets.xlogLoop).toBe(1);
    expect(offsets.xlogIndex).toBe(2);
  });
});

describe("control_thread handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../tools/control-thread.js");
    mod.register(server);
    handler = tools.get("control_thread")!.handler;
  });

  it("should return control result", async () => {
    const result = await handler({ obj_hash: 1, thread_id: 100, action: "resume" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.objHash).toBe(1);
    expect(output.threadId).toBe(100);
    expect(output.action).toBe("resume");
    expect(output.result).toBe("OK");
  });
});

describe("remove_inactive_objects handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../tools/remove-inactive-objects.js");
    mod.register(server);
    handler = tools.get("remove_inactive_objects")!.handler;
  });

  it("should remove all inactive when no server_id", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.scope).toBe("all servers");
  });

  it("should remove for specific server", async () => {
    const result = await handler({ server_id: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.scope).toBe("server 1");
  });
});

describe("get_server_info handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../tools/get-server-info.js");
    mod.register(server);
    handler = tools.get("get_server_info")!.handler;
  });

  it("should return server info", async () => {
    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.servers).toBeDefined();
  });

  it("should include counter model when requested", async () => {
    const result = await handler({ include_counter_model: true }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.counterModel).toBeDefined();
  });
});
