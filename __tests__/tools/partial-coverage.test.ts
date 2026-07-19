import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatYmd } from "../../time-utils.js";

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
    controlThread: vi.fn(),
    getServerInfo: vi.fn(),
    getCounterModel: vi.fn(),
    getCounterHistory: vi.fn(),
    getCounterHistoryByObjHashes: vi.fn(),
    getCounterStat: vi.fn(),
    getCounterStatByObjHashes: vi.fn(),
    getLatestCounter: vi.fn(),
    getLatestCounterByObjHashes: vi.fn(),
  };

  class MockUnsupportedOperationError extends Error {
    constructor(method: string) {
      super(`${method} is not supported via TCP; use HTTP mode`);
      this.name = "UnsupportedOperationError";
    }
  }

  return {
    client: mockClient,
    jsonStringify: (obj: unknown) => JSON.stringify(obj, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2),
    catchWarn: async <T>(promise: Promise<T>, fallback: T, warnings: string[], ctx: string): Promise<T> => {
      try {
        return await promise;
      } catch (e) {
        if (e instanceof MockUnsupportedOperationError) throw e;
        warnings.push(`[${ctx}] ${e instanceof Error ? e.message : String(e)}`);
        return fallback;
      }
    },
    resolveObjType: async (objType?: string) => objType ? [objType] : ["tomcat"],
    discoverObjTypes: async () => ["tomcat"],
    UnsupportedOperationError: MockUnsupportedOperationError,
  };
});

import { client, UnsupportedOperationError } from "../../client/index.js";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("control_thread handler (UnsupportedOperationError path)", () => {
  let handler: Handler;

  beforeAll(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/control-thread.js");
    mod.register(server);
    handler = tools.get("control_thread")!.handler;
  });

  it("should return an HTTP-mode-required error when controlThread throws UnsupportedOperationError", async () => {
    vi.mocked(client.controlThread).mockRejectedValueOnce(new UnsupportedOperationError("controlThread"));

    const result = await handler({ obj_hash: 1, thread_id: 100, action: "stop" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("This operation requires HTTP mode");
    expect(output.detail).toContain("controlThread");
    expect(output.hint).toContain("SCOUTER_API_URL");
  });

  it("should rethrow non-UnsupportedOperationError errors raised while serializing the response", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    vi.mocked(client.controlThread).mockResolvedValueOnce(circular);

    await expect(handler({ obj_hash: 1, thread_id: 100, action: "resume" }, {})).rejects.toThrow(/circular/i);
  });

  it("should collect a warning and return a null result when controlThread fails with a generic error", async () => {
    vi.mocked(client.controlThread).mockRejectedValueOnce(new Error("agent unreachable"));

    const result = await handler({ obj_hash: 1, thread_id: 100, action: "suspend" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.result).toBeNull();
    expect(output.warnings).toEqual(["[controlThread] agent unreachable"]);
  });
});

describe("get_server_info handler (counter model families + UnsupportedOperationError path)", () => {
  let handler: Handler;

  beforeAll(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-server-info.js");
    mod.register(server);
    handler = tools.get("get_server_info")!.handler;
  });

  it("should group counter model families with display names and drop families with no counters", async () => {
    vi.mocked(client.getServerInfo).mockResolvedValueOnce([{ id: 0, version: "2.21.3" }]);
    vi.mocked(client.getCounterModel).mockResolvedValueOnce({
      families: [
        {
          name: "Response",
          counters: [
            { name: "TPS", displayName: "Transactions/sec", unit: "tps" },
            { name: "Elapsed", displayName: "Elapsed Time", unit: "ms" },
          ],
        },
        { name: "Empty", counters: [] },
        { name: "NoCountersField" },
      ],
    });

    const result = await handler({ include_counter_model: true }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const counterModel = output.counterModel as Array<Record<string, unknown>>;
    expect(counterModel).toHaveLength(1);
    expect(counterModel[0].family).toBe("Response");
    expect(counterModel[0].counters).toEqual([
      { name: "TPS", displayName: "Transactions/sec", unit: "tps" },
      { name: "Elapsed", displayName: "Elapsed Time", unit: "ms" },
    ]);
  });

  it("should return an HTTP-mode-required error when getServerInfo throws UnsupportedOperationError", async () => {
    vi.mocked(client.getServerInfo).mockRejectedValueOnce(new UnsupportedOperationError("getServerInfo"));

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("This operation requires HTTP mode");
    expect(output.detail).toContain("getServerInfo");
    expect(output.hint).toContain("SCOUTER_API_URL");
  });

  it("should rethrow non-UnsupportedOperationError errors raised while serializing the response", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    vi.mocked(client.getServerInfo).mockResolvedValueOnce([circular]);

    await expect(handler({}, {})).rejects.toThrow(/circular/i);
  });

  it("should collect a warning when getServerInfo fails with a generic error", async () => {
    vi.mocked(client.getServerInfo).mockRejectedValueOnce(new Error("connection refused"));

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.warnings).toEqual(["[serverInfo] connection refused"]);
    expect(output.servers).toEqual([]);
  });
});

describe("get_counter_trend handler (obj_hashes and stat-API branches)", () => {
  let handler: Handler;

  beforeAll(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-counter-trend.js");
    mod.register(server);
    handler = tools.get("get_counter_trend")!.handler;
  });

  it("should use getCounterHistoryByObjHashes when obj_hashes is provided within the default (short) window", async () => {
    vi.mocked(client.getCounterHistoryByObjHashes).mockResolvedValueOnce([
      { objName: "/app/tomcat1", objHash: 1, valueList: [{ time: 1700000000000, value: 50 }] },
    ]);

    const result = await handler({ counter: "TPS", obj_hashes: "1,2" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.precision).toBe("2sec");
    const series = output.series as Array<Record<string, unknown>>;
    expect(series[0].objName).toBe("/app/tomcat1");
    expect(client.getCounterHistoryByObjHashes).toHaveBeenCalledWith("TPS", "1,2", expect.any(Number), expect.any(Number));
    expect(client.getCounterStatByObjHashes).not.toHaveBeenCalled();
  });

  it("should use getCounterStatByObjHashes when obj_hashes is provided and the range exceeds 2 hours", async () => {
    vi.mocked(client.getCounterStatByObjHashes).mockResolvedValueOnce([
      { objName: "/app/tomcat1", objHash: 1, valueList: [{ time: 1700000000000, value: 75 }] },
    ]);

    const startMillis = Date.parse("2024-01-01T00:00:00Z");
    const endMillis = Date.parse("2024-01-01T05:00:00Z");
    const result = await handler({
      counter: "TPS", obj_hashes: "1,2",
      start_time: "2024-01-01T00:00:00Z", end_time: "2024-01-01T05:00:00Z",
    }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.precision).toBe("5min");
    const series = output.series as Array<Record<string, unknown>>;
    expect(series[0].objName).toBe("/app/tomcat1");
    expect(client.getCounterStatByObjHashes).toHaveBeenCalledWith(
      "TPS", "1,2", formatYmd(new Date(startMillis)), formatYmd(new Date(endMillis)),
    );
    expect(client.getCounterHistoryByObjHashes).not.toHaveBeenCalled();
  });

  it("should use getCounterStat per obj_type when the range exceeds 2 hours without obj_hashes", async () => {
    vi.mocked(client.getCounterStat).mockResolvedValueOnce([
      { objName: "/app/tomcat1", objHash: 1, valueList: [{ time: 1700000000000, value: 30 }] },
    ]);

    const startMillis = Date.parse("2024-01-01T00:00:00Z");
    const endMillis = Date.parse("2024-01-01T05:00:00Z");
    const result = await handler({
      counter: "TPS", obj_type: "tomcat",
      start_time: "2024-01-01T00:00:00Z", end_time: "2024-01-01T05:00:00Z",
    }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.precision).toBe("5min");
    const series = output.series as Array<Record<string, unknown>>;
    expect(series[0].objName).toBe("/app/tomcat1");
    expect(client.getCounterStat).toHaveBeenCalledWith(
      "TPS", "tomcat", formatYmd(new Date(startMillis)), formatYmd(new Date(endMillis)),
    );
    expect(client.getCounterHistory).not.toHaveBeenCalled();
  });

  it("should use getLatestCounterByObjHashes when latest_sec and obj_hashes are both provided", async () => {
    vi.mocked(client.getLatestCounterByObjHashes).mockResolvedValueOnce([
      { objName: "/app/tomcat1", objHash: 1, valueList: [{ time: 1700000000000, value: 42 }] },
    ]);

    const result = await handler({ counter: "TPS", latest_sec: 60, obj_hashes: "1,2" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.latestSec).toBe(60);
    const series = output.series as Array<Record<string, unknown>>;
    expect(series[0].objName).toBe("/app/tomcat1");
    expect(client.getLatestCounterByObjHashes).toHaveBeenCalledWith("TPS", "1,2", 60);
    expect(client.getLatestCounter).not.toHaveBeenCalled();
  });

  it("should down-sample series with more than 200 data points and report original/sampled counts", async () => {
    const rawPoints = Array.from({ length: 250 }, (_, i) => ({ time: 1700000000000 + i * 2000, value: i }));
    vi.mocked(client.getCounterHistory).mockResolvedValueOnce([
      { objName: "/app/tomcat1", objHash: 1, valueList: rawPoints },
    ]);

    const result = await handler({ counter: "TPS", obj_type: "tomcat" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const series = output.series as Array<Record<string, unknown>>;
    expect(series[0].originalCount).toBe(250);
    const dataPoints = series[0].dataPoints as Array<Record<string, unknown>>;
    expect(dataPoints.length).toBeLessThan(250);
    expect(series[0].sampledTo).toBe(dataPoints.length);
    expect(dataPoints[dataPoints.length - 1]).toEqual(rawPoints[249]);
  });

  it("should default stats to zero and dataPoints to an empty array when a series entry has no valueList", async () => {
    vi.mocked(client.getCounterHistory).mockResolvedValueOnce([
      { objName: "/app/tomcat1", objHash: 1 },
    ]);

    const result = await handler({ counter: "TPS", obj_type: "tomcat" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const series = output.series as Array<Record<string, unknown>>;
    expect(series[0].dataPoints).toEqual([]);
    expect(series[0].originalCount).toBeUndefined();
    const stats = series[0].stats as Record<string, number>;
    expect(stats).toEqual({ min: 0, max: 0, avg: 0, latest: 0 });
  });

  it("should collect a warning when getCounterHistory fails for a resolved obj_type", async () => {
    vi.mocked(client.getCounterHistory).mockRejectedValueOnce(new Error("timeout"));

    const result = await handler({ counter: "TPS", obj_type: "tomcat" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const warnings = output.warnings as string[];
    expect(warnings.some(w => w.includes("counterHistory(tomcat)") && w.includes("timeout"))).toBe(true);
    expect(output.series).toEqual([]);
  });

  it("should default stats to zero when a latest_sec series entry has no valueList", async () => {
    vi.mocked(client.getLatestCounter).mockResolvedValueOnce([
      { objName: "/app/tomcat1", objHash: 1 },
    ]);

    const result = await handler({ counter: "TPS", latest_sec: 30, obj_type: "tomcat" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const series = output.series as Array<Record<string, unknown>>;
    expect(series[0].dataPoints).toEqual([]);
    const stats = series[0].stats as Record<string, number>;
    expect(stats).toEqual({ min: 0, max: 0, avg: 0, latest: 0 });
  });

  it("should down-sample a latest_sec series with more than 60 data points", async () => {
    const rawPoints = Array.from({ length: 80 }, (_, i) => ({ time: 1700000000000 + i * 1000, value: i }));
    vi.mocked(client.getLatestCounter).mockResolvedValueOnce([
      { objName: "/app/tomcat1", objHash: 1, valueList: rawPoints },
    ]);

    const result = await handler({ counter: "TPS", latest_sec: 60, obj_type: "tomcat" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const series = output.series as Array<Record<string, unknown>>;
    expect(series[0].originalCount).toBe(80);
    const dataPoints = series[0].dataPoints as Array<Record<string, unknown>>;
    expect(dataPoints.length).toBeLessThan(80);
    expect(series[0].sampledTo).toBe(dataPoints.length);
  });

  it("should collect a warning when getLatestCounter fails for a resolved obj_type", async () => {
    vi.mocked(client.getLatestCounter).mockRejectedValueOnce(new Error("boom"));

    const result = await handler({ counter: "TPS", latest_sec: 30, obj_type: "tomcat" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const warnings = output.warnings as string[];
    expect(warnings.some(w => w.includes("counterLatest(tomcat)") && w.includes("boom"))).toBe(true);
    expect(output.series).toEqual([]);
  });
});
