import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type Handler = (args: Record<string, unknown>, extra?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

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

// Hash -> text lookup dictionary shared by resolveHashes()/resolveSummaryNames() across all
// six tool handlers under test. Keyed by TextType, matching client.lookupTexts(date, type, hashes).
const TEXT_DICT: Record<string, Record<number, string>> = {
  service: { 123: "/api/orders", 456: "/api/users", 502: "com.example.OrderService.process" },
  sql: { 501: "SELECT * FROM orders WHERE id = ?" },
  error: { 789: "NullPointerException" },
  apicall: { 503: "http://internal-api/service" },
};

vi.mock("../../client/index.js", () => {
  const mockClient = {
    getObjects: vi.fn().mockResolvedValue([
      { objHash: 1, objName: "/app/tomcat1", objType: "tomcat", address: "10.0.0.1", alive: true },
      { objHash: 2, objName: "/app/tomcat2", objType: "tomcat", address: "10.0.0.2", alive: true },
      { objHash: 3, objName: "/dead/agent", objType: "tomcat", address: "10.0.0.3", alive: false },
    ]),

    // --- get-raw-xlog ---
    getRawXLog: vi.fn().mockResolvedValue({
      txid: "tx1", gxid: "gx1", elapsed: 500, service: 123, error: "0",
      ipaddr: "192.168.1.100", login: "alice", objName: "/app/tomcat1",
    }),
    getRawXLogByGxid: vi.fn().mockResolvedValue([
      { txid: "tx1", gxid: "gx1", elapsed: 300, ipaddr: "10.0.0.5", login: "bob" },
      { txid: "tx2", gxid: "gx1", elapsed: 700, ipaddr: "10.0.0.6", login: "carol" },
    ]),
    searchRawXLog: vi.fn().mockResolvedValue([{ txid: "tx3", elapsed: 200, service: 456 }]),
    getPageableRawXLog: vi.fn().mockResolvedValue({ list: [{ txid: "tx4", elapsed: 150 }], hasNext: false }),
    getRealtimeRawXLog: vi.fn().mockResolvedValue({ list: [{ txid: "tx5", elapsed: 40 }], xlogLoop: 3, xlogIndex: 7 }),

    // --- get-raw-profile ---
    getRawProfile: vi.fn().mockResolvedValue([
      { stepType: "SQL", hash: 501, mainValue: "raw-sql", param: "42" },
      { stepType: "METHOD", hash: 502, mainValue: "raw-method" },
    ]),

    // --- get-transaction-detail / get-distributed-trace ---
    getXLogDetail: vi.fn().mockResolvedValue({
      txid: "tx1", gxid: "gx1", elapsed: 500, service: 123, error: 0,
      objName: "/app/tomcat1", ipaddr: "192.168.1.50", login: "alice",
    }),
    getProfileData: vi.fn().mockResolvedValue([
      { hash: 501, stepType: "SQL", mainValue: "raw-sql-501", step: { stepTypeName: "SQL", elapsed: 150, index: 0, param: "42" } },
      { hash: 502, stepType: "METHOD", mainValue: "raw-method-502", step: { stepTypeName: "METHOD", elapsed: 25, index: 1 } },
      { hash: 503, stepType: "APICALL", mainValue: "http://api.example.com/x", step: { stepTypeName: "APICALL", elapsed: 80, index: 2 } },
      { hash: 504, stepType: "METHOD", mainValue: "trivial", step: { stepTypeName: "METHOD", elapsed: 5, index: 3 } },
    ]),
    getXLogsByGxid: vi.fn().mockResolvedValue([
      { txid: "txA", gxid: "gx1", caller: "callerA", elapsed: 300, service: 456, objName: "/app/tomcat2", error: 0, ipaddr: "10.1.1.1" },
      { txid: "txB", gxid: "gx1", caller: "callerB", elapsed: 100, service: 123, objName: "/app/tomcat1", error: 789, ipaddr: "10.1.1.2" },
    ]),
    getMultiXLogs: vi.fn().mockResolvedValue([
      { txid: "txC", elapsed: 50, service: 123, objName: "/app/tomcat1", error: 0 },
    ]),

    // --- get-sql-analysis / diagnose-performance ---
    getSummary: vi.fn().mockImplementation(async (category: string) => {
      if (category === "sql") {
        return [
          { summaryKeyName: "SELECT * FROM orders WHERE id=1", count: 10, errorCount: 1, elapsedSum: 15000 },
          { summaryKeyName: "hash:501", count: 5, errorCount: 0, elapsedSum: 2000 },
        ];
      }
      if (category === "error") {
        return [{ summaryKeyName: "NullPointerException", count: 3, errorCount: 3, elapsedSum: 300 }];
      }
      if (category === "service") {
        return [
          { summaryKeyName: "/api/orders", count: 20, errorCount: 4, elapsedSum: 8000 },
          { summaryKeyName: "hash:502", count: 15, errorCount: 0, elapsedSum: 45000 },
        ];
      }
      return [];
    }),
    getSummaryByObjHash: vi.fn().mockResolvedValue([
      { summaryKeyName: "SELECT 1", count: 2, errorCount: 0, elapsedSum: 100 },
    ]),
    getRealtimeCounters: vi.fn().mockResolvedValue([
      { objHash: 1, objName: "/app/tomcat1", name: "ErrorRate", value: 10 },
      { objHash: 1, objName: "/app/tomcat1", name: "ElapsedTime", value: 4000 },
      { objHash: 1, objName: "/app/tomcat1", name: "ProcCpu", value: 90 },
      { objHash: 1, objName: "/app/tomcat1", name: "GcCount", value: 15 },
      { objHash: 1, objName: "/app/tomcat1", name: "HeapUsed", value: 900 },
      { objHash: 1, objName: "/app/tomcat1", name: "HeapTotal", value: 1000 },
      { objHash: 2, objName: "/app/tomcat2", name: "TPS", value: 50 },
      { objHash: 2, name: "TPS", value: 30 },
    ]),
    getActiveServices: vi.fn().mockResolvedValue([
      { objName: "/app/tomcat1", serviceName: "/api/slow", elapsed: 45000, mode: "THREAD", note: "" },
      { objName: "/app/tomcat2", serviceName: "/api/fast", elapsed: 200, mode: "THREAD" },
    ]),
    getRealtimeAlerts: vi.fn().mockResolvedValue({
      alerts: [
        { title: "A1", message: "m1", level: "warn", objName: "/app/tomcat1" },
        { title: "A2", message: "m2", level: "warn", objName: "/app/tomcat1" },
        { title: "A3", message: "m3", level: "warn", objName: "/app/tomcat1" },
        { title: "A4", message: "m4", level: "warn", objName: "/app/tomcat1" },
        { title: "A5", message: "m5", level: "warn", objName: "/app/tomcat1" },
        { title: "A6", message: "m6", level: "warn", objName: "/app/tomcat1" },
      ],
    }),

    lookupTexts: vi.fn().mockImplementation(async (_date: string, type: string, hashes: number[]) => {
      const map = TEXT_DICT[type] ?? {};
      const result: Record<string, string> = {};
      for (const h of hashes) if (map[h] !== undefined) result[String(h)] = map[h];
      return result;
    }),
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ===================== get_raw_xlog =====================

describe("get_raw_xlog handler", () => {
  let handler: Handler;
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-raw-xlog.js");
    mod.register(server);
    handler = tools.get("get_raw_xlog")!.handler;
    client = (await import("../../client/index.js")).client as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  it("single mode: returns raw xlog and masks/strips fields", async () => {
    const result = await handler({ mode: "single", date: "20260719", txid: "tx1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.mode).toBe("single");
    const raw = output.result as Record<string, unknown>;
    expect(raw.ipaddr).toBe("192.168.1.***");
    expect(raw.login).toBe("al****ce");
    expect(raw.error).toBeUndefined(); // stripEmpty removes string "0"
    expect(output.piiMasked).toBeTruthy();
  });

  it("single mode: errors when date/txid missing", async () => {
    const result = await handler({ mode: "single" }, {});
    expect(result.content[0].text).toContain("'date' and 'txid' are required for single mode");
  });

  it("gxid mode: returns array result via compactResult array branch", async () => {
    const result = await handler({ mode: "gxid", date: "20260719", gxid: "gx1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const raw = output.result as Array<Record<string, unknown>>;
    expect(raw).toHaveLength(2);
    expect(raw[0].ipaddr).toBe("10.0.0.***");
  });

  it("gxid mode: errors when date/gxid missing", async () => {
    const result = await handler({ mode: "gxid" }, {});
    expect(result.content[0].text).toContain("'date' and 'gxid' are required for gxid mode");
  });

  it("search mode: builds search params from optional filters", async () => {
    await handler({
      mode: "search", date: "20260719", start_time_millis: 100, end_time_millis: 200,
      service: "orders", ip: "10.0.0.1", login: "alice", obj_hash: 42,
    }, {});
    expect(client.searchRawXLog).toHaveBeenCalledWith("20260719", {
      startTimeMillis: "100", endTimeMillis: "200",
      service: "orders", ip: "10.0.0.1", login: "alice", objHash: "42",
    });
  });

  it("search mode: errors when date missing", async () => {
    const result = await handler({ mode: "search" }, {});
    expect(result.content[0].text).toContain("'date' is required for search mode");
  });

  it("pageable mode: builds page params and requires obj_hashes", async () => {
    await handler({
      mode: "pageable", date: "20260719", obj_hashes: "1,2", page_count: 500,
      last_txid: 99, last_xlog_time: 12345,
    }, {});
    expect(client.getPageableRawXLog).toHaveBeenCalledWith("20260719", {
      objHashes: "1,2", pageCount: "500", lastTxid: "99", lastXLogTime: "12345",
    });
  });

  it("pageable mode: errors when date missing", async () => {
    const result = await handler({ mode: "pageable", obj_hashes: "1" }, {});
    expect(result.content[0].text).toContain("'date' is required for pageable mode");
  });

  it("pageable mode: errors when obj_hashes missing", async () => {
    const result = await handler({ mode: "pageable", date: "20260719" }, {});
    expect(result.content[0].text).toContain("'obj_hashes' is required for pageable mode");
  });

  it("realtime mode: uses explicit obj_hashes without discovering agents", async () => {
    const result = await handler({ mode: "realtime", obj_hashes: "5,6" }, {});
    expect(client.getObjects).not.toHaveBeenCalled();
    expect(client.getRealtimeRawXLog).toHaveBeenCalledWith(0, 0, "5,6");
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.mode).toBe("realtime");
  });

  it("realtime mode: discovers alive agents when obj_hashes omitted", async () => {
    await handler({ mode: "realtime", xlog_loop: 3, xlog_index: 7 }, {});
    expect(client.getObjects).toHaveBeenCalled();
    expect(client.getRealtimeRawXLog).toHaveBeenCalledWith(3, 7, "1,2");
  });

  it("realtime mode: returns error when no alive agents found", async () => {
    client.getObjects.mockResolvedValueOnce([
      { objHash: 9, objName: "/dead", objType: "tomcat", address: "x", alive: false },
    ]);
    const result = await handler({ mode: "realtime" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("No matching agents found for realtime mode");
  });

  it("warning path: pushes warning and nulls result on rejection", async () => {
    client.getRawXLog.mockRejectedValueOnce(new Error("boom"));
    const result = await handler({ mode: "single", date: "20260719", txid: "tx1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.result).toBeNull();
    expect((output.warnings as string[])[0]).toContain("[rawXLog] boom");
  });
});

// ===================== get_raw_profile =====================

describe("get_raw_profile handler", () => {
  let handler: Handler;
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-raw-profile.js");
    mod.register(server);
    handler = tools.get("get_raw_profile")!.handler;
    client = (await import("../../client/index.js")).client as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  afterEach(() => {
    delete process.env.SCOUTER_MASK_PII;
  });

  it("masks param field on steps that have one, leaves others untouched", async () => {
    const result = await handler({ date: "20260719", txid: "tx1" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    const profile = output.profile as Array<Record<string, unknown>>;
    expect(profile[0].param).toBe("[masked]");
    expect(profile[0].mainValue).toBe("raw-sql");
    expect(profile[1].param).toBeUndefined();
    expect(output.piiMasked).toBeTruthy();
  });

  it("leaves param unmasked when SCOUTER_MASK_PII=false", async () => {
    process.env.SCOUTER_MASK_PII = "false";
    const result = await handler({ date: "20260719", txid: "tx1" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    const profile = output.profile as Array<Record<string, unknown>>;
    expect(profile[0].param).toBe("42");
    expect(output.piiMasked).toBeUndefined();
  });

  it("handles null profile (warning path) without masking crash", async () => {
    client.getRawProfile.mockRejectedValueOnce(new Error("timeout"));
    const result = await handler({ date: "20260719", txid: "tx1" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.profile).toBeNull();
    expect((output.warnings as string[])[0]).toContain("[rawProfile] timeout");
  });
});

// ===================== get_transaction_detail =====================

describe("get_transaction_detail handler", () => {
  let handler: Handler;
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-transaction-detail.js");
    mod.register(server);
    handler = tools.get("get_transaction_detail")!.handler;
    client = (await import("../../client/index.js")).client as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  it("resolves service name and profile steps, no truncation at default max_steps", async () => {
    const result = await handler({ txid: "tx1" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    const tx = output.transaction as Record<string, unknown>;
    expect(tx.serviceName).toBe("/api/orders");

    const profile = output.profile as Record<string, unknown>;
    expect(profile.totalSteps).toBe(4);
    expect(profile.returnedSteps).toBe(4);
    expect(profile.truncated).toBeUndefined();

    const sqlSummary = profile.sqlSummary as Record<string, unknown>;
    expect(sqlSummary.totalCount).toBe(1);
    expect(sqlSummary.totalElapsed).toBe(150);

    const apiCallSummary = profile.apiCallSummary as Record<string, unknown>;
    expect(apiCallSummary.totalCount).toBe(1);
  });

  it("masks SQL bind params by default and keeps executableSql as the unbound template", async () => {
    const result = await handler({ txid: "tx1" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    const profile = output.profile as Record<string, unknown>;
    const sqlSummary = profile.sqlSummary as Record<string, unknown>;
    const slowQueries = sqlSummary.slowQueries as Array<Record<string, unknown>>;
    expect(slowQueries[0].param).toBe("[masked]");
    expect(slowQueries[0].executableSql).toBe("SELECT * FROM orders WHERE id = ?");
  });

  it("binds real params into executableSql when masking is disabled", async () => {
    process.env.SCOUTER_MASK_PII = "false";
    try {
      const result = await handler({ txid: "tx1" });
      const output = parseToolOutput(result) as Record<string, unknown>;
      const profile = output.profile as Record<string, unknown>;
      const sqlSummary = profile.sqlSummary as Record<string, unknown>;
      const slowQueries = sqlSummary.slowQueries as Array<Record<string, unknown>>;
      expect(slowQueries[0].param).toBe("42");
      expect(slowQueries[0].executableSql).toBe("SELECT * FROM orders WHERE id = 42");
    } finally {
      delete process.env.SCOUTER_MASK_PII;
    }
  });

  it("truncates steps and prioritizes significant ones when max_steps is small", async () => {
    const result = await handler({ txid: "tx1", max_steps: 1 });
    const output = parseToolOutput(result) as Record<string, unknown>;
    const profile = output.profile as Record<string, unknown>;
    expect(profile.totalSteps).toBe(4);
    expect(profile.returnedSteps).toBe(3); // SQL + METHOD(elapsed>10) + APICALL are significant
    expect(profile.truncated).toBe(true);
    expect(profile.note).toContain("Showing 3 of 4 steps");
  });

  it("handles missing transaction and empty profile (warning path)", async () => {
    client.getXLogDetail.mockResolvedValueOnce(null);
    client.getProfileData.mockRejectedValueOnce(new Error("profile down"));
    const result = await handler({ txid: "missing" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.transaction).toBeNull();
    const profile = output.profile as Record<string, unknown>;
    expect(profile.totalSteps).toBe(0);
    expect(profile.returnedSteps).toBe(0);
    expect((output.warnings as string[]).some(w => w.includes("[profileData]"))).toBe(true);
  });

  it("defaults date to today when omitted", async () => {
    await handler({ txid: "tx1" });
    expect(client.getXLogDetail).toHaveBeenCalled();
    const [dateArg] = client.getXLogDetail.mock.calls[0];
    expect(dateArg).toMatch(/^\d{8}$/);
  });
});

// ===================== get_distributed_trace =====================

describe("get_distributed_trace handler", () => {
  let handler: Handler;
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-distributed-trace.js");
    mod.register(server);
    handler = tools.get("get_distributed_trace")!.handler;
    client = (await import("../../client/index.js")).client as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  it("errors when neither gxid nor txids provided", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("Either gxid or txids must be provided");
  });

  it("gxid mode: sorts transactions by elapsed and resolves names", async () => {
    const result = await handler({ gxid: "gx1" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(client.getXLogsByGxid).toHaveBeenCalledWith(expect.any(String), "gx1");
    expect(output.transactionCount).toBe(2);
    const txs = output.transactions as Array<Record<string, unknown>>;
    expect(txs[0].txid).toBe("txB"); // elapsed 100 < 300
    expect(txs[0].serviceName).toBe("/api/orders");
    expect(txs[0].errorMessage).toBe("NullPointerException");
    expect(txs[0].ipaddr).toBe("10.1.1.***"); // masked by compactXLog

    const chain = output.callChainSummary as Array<Record<string, unknown>>;
    expect(chain[0].hasError).toBe(true);
    expect(chain[1].hasError).toBe(false);
  });

  it("txids mode: uses getMultiXLogs instead of gxid lookup", async () => {
    const result = await handler({ txids: "txC" });
    expect(client.getMultiXLogs).toHaveBeenCalledWith(expect.any(String), "txC");
    expect(client.getXLogsByGxid).not.toHaveBeenCalled();
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.transactionCount).toBe(1);
  });

  it("include_profiles=true fetches a profile per transaction", async () => {
    const result = await handler({ gxid: "gx1", include_profiles: true });
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(client.getProfileData).toHaveBeenCalledTimes(2);
    const profiles = output.profiles as Record<string, unknown>;
    expect(Object.keys(profiles)).toEqual(expect.arrayContaining(["txA", "txB"]));
  });

  it("include_profiles=true with empty transactions never fetches profiles", async () => {
    client.getXLogsByGxid.mockResolvedValueOnce([]);
    const result = await handler({ gxid: "gx1", include_profiles: true });
    expect(client.getProfileData).not.toHaveBeenCalled();
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.transactionCount).toBe(0);
    expect(output.profiles).toBeUndefined();
  });

  it("warning path: falls back to empty list on gxid lookup failure", async () => {
    client.getXLogsByGxid.mockRejectedValueOnce(new Error("gxid down"));
    const result = await handler({ gxid: "gx1" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.transactionCount).toBe(0);
    expect((output.warnings as string[])[0]).toContain("[gxidLookup] gxid down");
  });
});

// ===================== get_sql_analysis =====================

describe("get_sql_analysis handler", () => {
  let handler: Handler;
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-sql-analysis.js");
    mod.register(server);
    handler = tools.get("get_sql_analysis")!.handler;
    client = (await import("../../client/index.js")).client as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  it("happy path: resolves hash-named SQL and computes totals", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalSqlCount).toBe(15);
    expect(output.totalSqlElapsed).toBe(17000);
    const sqls = output.sqls as Array<Record<string, unknown>>;
    expect(sqls.some(s => s.sql === "SELECT * FROM orders WHERE id = ?")).toBe(true);
  });

  it("defaults sort_by to elapsed_sum descending", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const sqls = output.sqls as Array<Record<string, unknown>>;
    expect(sqls[0].elapsedSum).toBe(15000);
    expect(sqls[1].elapsedSum).toBe(2000);
  });

  it("sort_by=count orders by count descending", async () => {
    const result = await handler({ sort_by: "count" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    const sqls = output.sqls as Array<Record<string, unknown>>;
    expect(sqls[0].count).toBe(10);
    expect(sqls[1].count).toBe(5);
  });

  it("sort_by=avg_elapsed orders by avgElapsed descending", async () => {
    const result = await handler({ sort_by: "avg_elapsed" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    const sqls = output.sqls as Array<Record<string, unknown>>;
    expect(sqls[0].avgElapsed).toBeGreaterThanOrEqual(sqls[1].avgElapsed as number);
  });

  it("sort_by=error_count orders by errorCount descending", async () => {
    const result = await handler({ sort_by: "error_count" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    const sqls = output.sqls as Array<Record<string, unknown>>;
    expect(sqls[0].errorCount).toBe(1);
  });

  it("max_count limits the number of returned sqls", async () => {
    const result = await handler({ max_count: 1 });
    const output = parseToolOutput(result) as Record<string, unknown>;
    const sqls = output.sqls as Array<Record<string, unknown>>;
    expect(sqls).toHaveLength(1);
  });

  it("obj_hash routes through getSummaryByObjHash instead of obj_type", async () => {
    const result = await handler({ obj_hash: 42 });
    expect(client.getSummaryByObjHash).toHaveBeenCalledWith("sql", 42, expect.any(Number), expect.any(Number));
    expect(client.getSummary).not.toHaveBeenCalled();
    const output = parseToolOutput(result) as Record<string, unknown>;
    const sqls = output.sqls as Array<Record<string, unknown>>;
    expect(sqls).toHaveLength(1);
    expect(sqls[0].sql).toBe("SELECT 1");
  });

  it("empty result: no sqls found produces zeroed totals", async () => {
    client.getSummary.mockResolvedValueOnce([]);
    const result = await handler({ obj_type: "custom" });
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalSqlCount).toBe(0);
    expect(output.totalSqlElapsed).toBe(0);
    expect(output.sqls).toEqual([]);
  });

  it("warns when a SQL hash cannot be resolved to text", async () => {
    client.getSummary.mockResolvedValueOnce([
      { summaryKeyName: "hash:99999", count: 1, errorCount: 0, elapsedSum: 100 },
    ]);
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect((output.warnings as string[]).some(w => w.includes("could not be resolved"))).toBe(true);
  });

  it("warning path: getSummary rejection falls back to empty list", async () => {
    client.getSummary.mockRejectedValueOnce(new Error("sql summary down"));
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalSqlCount).toBe(0);
    expect((output.warnings as string[])[0]).toContain("sqlSummary(tomcat)");
  });

  it("strips comments/whitespace and truncates long SQL text", async () => {
    const longSql = "SELECT " + "a".repeat(600) + " FROM t";
    client.getSummary.mockResolvedValueOnce([
      { summaryKeyName: `/* c */  SELECT   *   FROM   t`, count: 1, errorCount: 0, elapsedSum: 10 },
      { summaryKeyName: longSql, count: 1, errorCount: 0, elapsedSum: 5 },
    ]);
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const sqls = output.sqls as Array<Record<string, unknown>>;
    expect(sqls.some(s => s.sql === "SELECT * FROM t")).toBe(true);
    expect(sqls.some(s => (s.sql as string).endsWith("...") && (s.sql as string).length === 503)).toBe(true);
  });
});

// ===================== diagnose_performance =====================

describe("diagnose_performance handler", () => {
  let handler: Handler;
  let client: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/diagnose-performance.js");
    mod.register(server);
    handler = tools.get("diagnose_performance")!.handler;
    client = (await import("../../client/index.js")).client as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  it("happy path: produces findings sorted CRITICAL before WARNING before INFO", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    expect(findings.length).toBeGreaterThan(0);
    const severities = findings.map(f => f.severity);
    const firstWarnIdx = severities.indexOf("WARNING");
    const firstInfoIdx = severities.indexOf("INFO");
    const lastCriticalIdx = severities.lastIndexOf("CRITICAL");
    if (firstWarnIdx !== -1 && lastCriticalIdx !== -1) expect(lastCriticalIdx).toBeLessThan(firstWarnIdx);
    if (firstInfoIdx !== -1 && firstWarnIdx !== -1) expect(firstWarnIdx).toBeLessThan(firstInfoIdx);
  });

  it("flags dead agents as CRITICAL findings", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    const deadFinding = findings.find(f => f.category === "DEAD_AGENT");
    expect(deadFinding).toBeDefined();
    expect(deadFinding!.severity).toBe("CRITICAL");
    expect(deadFinding!.title).toContain("/dead/agent");
  });

  it("flags high error rate, high response time, high CPU and frequent GC", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    const byCategory = (c: string) => findings.find(f => f.category === c);
    expect(byCategory("HIGH_ERROR_RATE")?.severity).toBe("CRITICAL");
    expect(byCategory("HIGH_RESPONSE_TIME")?.severity).toBe("WARNING");
    expect(byCategory("HIGH_CPU")?.severity).toBe("WARNING");
    expect(byCategory("HIGH_GC")?.severity).toBe("WARNING");
  });

  it("backfills missing objName on counters from the object list by objHash", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    // TPS finding isn't generated, but avgTps should reflect both TPS entries (50 and 30)
    const snapshot = output.systemSnapshot as Record<string, unknown>;
    expect(snapshot.avgTps).toBeCloseTo(40, 5);
  });

  it("flags heap pressure when used/total ratio exceeds 0.85", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    const heapFinding = findings.find(f => f.category === "HEAP_PRESSURE");
    expect(heapFinding).toBeDefined();
    expect(heapFinding!.title).toContain("/app/tomcat1");
  });

  it("does not flag heap pressure when ratio is below threshold", async () => {
    client.getRealtimeCounters.mockResolvedValueOnce([
      { objHash: 1, objName: "/app/tomcat1", name: "HeapUsed", value: 500 },
      { objHash: 1, objName: "/app/tomcat1", name: "HeapTotal", value: 1000 },
    ]);
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    expect(findings.find(f => f.category === "HEAP_PRESSURE")).toBeUndefined();
  });

  it("flags long-running active services over 30s", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    const longRunning = findings.find(f => f.category === "LONG_ACTIVE_SERVICE");
    expect(longRunning).toBeDefined();
    expect(longRunning!.title).toContain("45000ms");
    const snapshot = output.systemSnapshot as Record<string, unknown>;
    expect(snapshot.maxActiveElapsed).toBe(45000);
    expect(snapshot.totalActiveServices).toBe(2);
  });

  it("caps alert findings to the first 5", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    const alertFindings = findings.filter(f => f.category === "ALERT");
    expect(alertFindings).toHaveLength(5);
  });

  it("flags slow SQL when average elapsed exceeds 1000ms", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    const slowSql = findings.find(f => f.category === "SLOW_SQL");
    expect(slowSql).toBeDefined();
    expect(slowSql!.title).toContain("slow SQL queries detected");
  });

  it("omits slow SQL finding when no query exceeds threshold", async () => {
    // Calls happen in source order within Promise.all: error, sql, service.
    client.getSummary
      .mockResolvedValueOnce([]) // error
      .mockResolvedValueOnce([{ summaryKeyName: "SELECT 1", count: 10, errorCount: 0, elapsedSum: 500 }]) // sql, avg=50 < 1000
      .mockResolvedValueOnce([]); // service
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    expect(findings.find(f => f.category === "SLOW_SQL")).toBeUndefined();
  });

  it("resolves hash-named top SQL and top services in the summary sections", async () => {
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const topSlowSqls = output.topSlowSqls as Array<Record<string, unknown>>;
    const topSlowServices = output.topSlowServices as Array<Record<string, unknown>>;
    const topErrorServices = output.topErrorServices as Array<Record<string, unknown>>;
    expect(topSlowSqls.some(s => s.sql === "SELECT * FROM orders WHERE id=1")).toBe(true);
    expect(topSlowServices.some(s => s.service === "com.example.OrderService.process")).toBe(true);
    expect(topErrorServices.some(s => s.service === "/api/orders" && s.errorRate === 20)).toBe(true);
  });

  it("produces no findings and zeroed snapshot when nothing crosses thresholds", async () => {
    client.getObjects.mockResolvedValueOnce([
      { objHash: 1, objName: "/app/tomcat1", objType: "tomcat", address: "10.0.0.1", alive: true },
    ]);
    client.getRealtimeCounters.mockResolvedValueOnce([]);
    client.getActiveServices.mockResolvedValueOnce([]);
    client.getRealtimeAlerts.mockResolvedValueOnce({ alerts: [] });
    client.getSummary
      .mockResolvedValueOnce([]) // error
      .mockResolvedValueOnce([]) // sql
      .mockResolvedValueOnce([]); // service
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.findings).toEqual([]);
    const snapshot = output.systemSnapshot as Record<string, unknown>;
    expect(snapshot.deadAgents).toBe(0);
    expect(snapshot.avgTps).toBe(0);
    expect(snapshot.totalActiveServices).toBe(0);
  });

  it("respects an explicit obj_type filter", async () => {
    await handler({ obj_type: "mysql" });
    expect(client.getRealtimeCounters).toHaveBeenCalledWith(expect.any(String), "mysql");
    expect(client.getActiveServices).toHaveBeenCalledWith("mysql");
  });

  it("caps time_range_minutes at 60 even when a larger value is requested", async () => {
    const result = await handler({ time_range_minutes: 120 });
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.timeRangeMinutes).toBe(60);
  });

  it("uses the requested time_range_minutes when within bounds", async () => {
    const result = await handler({ time_range_minutes: 5 });
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.timeRangeMinutes).toBe(5);
  });

  it("warning path: counters fetch failure is recorded and does not crash the report", async () => {
    client.getRealtimeCounters.mockRejectedValueOnce(new Error("counters down"));
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect((output.warnings as string[]).some(w => w.includes("[counters(tomcat)] counters down"))).toBe(true);
    // with no counters, none of the threshold findings should appear
    const findings = output.findings as Array<Record<string, unknown>>;
    expect(findings.find(f => f.category === "HIGH_ERROR_RATE")).toBeUndefined();
  });

  it("warning path: alerts fetch failure falls back to no alert findings", async () => {
    client.getRealtimeAlerts.mockRejectedValueOnce(new Error("alerts down"));
    const result = await handler({});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const findings = output.findings as Array<Record<string, unknown>>;
    expect(findings.filter(f => f.category === "ALERT")).toHaveLength(0);
    expect((output.warnings as string[]).some(w => w.includes("[alerts] alerts down"))).toBe(true);
  });
});
