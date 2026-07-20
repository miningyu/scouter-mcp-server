import { describe, it, expect, vi, beforeEach } from "vitest";
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
    getObjects: vi.fn().mockResolvedValue([]),
    getThreadList: vi.fn().mockResolvedValue([]),
    getAgentEnv: vi.fn().mockResolvedValue([]),
    getAgentSocket: vi.fn().mockResolvedValue([]),
    getHostTop: vi.fn().mockResolvedValue([]),
    getHostDisk: vi.fn().mockResolvedValue([]),
    getThreadDump: vi.fn().mockResolvedValue([]),
    getHeapHistogram: vi.fn().mockResolvedValue([]),
    getActiveServices: vi.fn().mockResolvedValue([]),
    getActiveServicesByObj: vi.fn().mockResolvedValue([]),
    getActiveThreadDetail: vi.fn().mockResolvedValue(null),
    getInteractionCounters: vi.fn().mockResolvedValue([]),
    getInteractionCountersByObjHashes: vi.fn().mockResolvedValue([]),
    lookupTexts: vi.fn().mockResolvedValue({}),
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

import { client } from "../../client/index.js";

describe("get_agent_info handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-agent-info.js");
    mod.register(server);
    handler = tools.get("get_agent_info")!.handler;
  });

  it("should return thread summary and active service threads by default", async () => {
    vi.mocked(client.getThreadList).mockResolvedValueOnce([
      { id: 1, name: "http-1", stat: "RUNNABLE", cpu: 5, txid: "tx1", elapsed: "120", service: "1001" },
      { id: 2, name: "http-2", stat: "WAITING", cpu: 0 },
      { id: 3, name: "http-3", stat: "RUNNABLE", cpu: 2, txid: "", service: "" },
    ]);

    const result = await handler({ obj_hash: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;

    expect(output.objHash).toBe(1);
    expect(output.timestamp).toBeTruthy();
    const threads = output.threads as Record<string, unknown>;
    expect(threads.totalCount).toBe(3);
    expect(threads.stateSummary).toEqual({ RUNNABLE: 2, WAITING: 1 });
    const active = threads.activeServiceThreads as Array<Record<string, unknown>>;
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(1);
    expect(output.env).toBeUndefined();
    expect(output.sockets).toBeUndefined();
  });

  it("should omit threads when include_threads is false", async () => {
    const result = await handler({ obj_hash: 1, include_threads: false }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.threads).toBeUndefined();
  });

  it("should include env and apply SKIP_PREFIXES filtering when include_env is true", async () => {
    vi.mocked(client.getAgentEnv).mockResolvedValueOnce([
      { name: "PASSWORD", value: "secret123" },
      { name: "java.version", value: "17" },
      { name: "sun.foo", value: "x" },
    ]);

    const result = await handler({ obj_hash: 1, include_env: true }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const env = output.env as Array<Record<string, unknown>>;
    expect(env.find(e => e.name === "sun.foo")).toBeUndefined();
    const pw = env.find(e => e.name === "PASSWORD");
    expect(pw?.value).toBe("secret123");
    const jv = env.find(e => e.name === "java.version");
    expect(jv?.value).toBe("17");
  });

  it("should include sockets and strip key/standby/stack and empty fields when include_sockets is true", async () => {
    vi.mocked(client.getAgentSocket).mockResolvedValueOnce([
      { key: "k1", standby: false, stack: "trace", local: "10.0.0.1:8080", remote: "", state: "ESTABLISHED", queue: "0" },
    ]);

    const result = await handler({ obj_hash: 1, include_sockets: true }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const sockets = output.sockets as Array<Record<string, unknown>>;
    expect(sockets).toHaveLength(1);
    expect(sockets[0]).not.toHaveProperty("key");
    expect(sockets[0]).not.toHaveProperty("standby");
    expect(sockets[0]).not.toHaveProperty("stack");
    expect(sockets[0]).not.toHaveProperty("remote");
    expect(sockets[0]).not.toHaveProperty("queue");
    expect(sockets[0].local).toBe("10.0.0.1:8080");
    expect(sockets[0].state).toBe("ESTABLISHED");
  });

  it("should collect a warning when getThreadList fails", async () => {
    vi.mocked(client.getThreadList).mockRejectedValueOnce(new Error("timeout"));

    const result = await handler({ obj_hash: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const warnings = output.warnings as string[];
    expect(warnings.some(w => w.includes("[threadList]") && w.includes("timeout"))).toBe(true);
    const threads = output.threads as Record<string, unknown>;
    expect(threads.totalCount).toBe(0);
  });
});

describe("get_host_info handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-host-info.js");
    mod.register(server);
    handler = tools.get("get_host_info")!.handler;
  });

  it("should return an error when no host agents are found", async () => {
    vi.mocked(client.getObjects).mockResolvedValueOnce([]);

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toContain("No host agents found");
  });

  it("should auto-discover known host types when neither obj_hash nor obj_type is given", async () => {
    vi.mocked(client.getObjects).mockResolvedValueOnce([
      { objHash: 5, objName: "/linuxhost", objType: "linux", alive: true, address: "", objFamily: "" },
      { objHash: 6, objName: "/tomcat1", objType: "tomcat", alive: true, address: "", objFamily: "" },
    ]);

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const hosts = output.hosts as Array<Record<string, unknown>>;
    expect(hosts).toHaveLength(1);
    expect(hosts[0].objName).toBe("/linuxhost");
  });

  it("should resolve host by obj_hash found in objects list", async () => {
    vi.mocked(client.getObjects).mockResolvedValueOnce([
      { objHash: 77, objName: "/myhost", objType: "linux", alive: true, address: "1.2.3.4", objFamily: "" },
    ]);

    const result = await handler({ obj_hash: 77 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const hosts = output.hosts as Array<Record<string, unknown>>;
    expect(hosts[0].objName).toBe("/myhost");
    expect(hosts[0].objType).toBe("linux");
  });

  it("should fall back to an unknown placeholder when obj_hash is not found among objects", async () => {
    vi.mocked(client.getObjects).mockResolvedValueOnce([]);

    const result = await handler({ obj_hash: 999 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const hosts = output.hosts as Array<Record<string, unknown>>;
    expect(hosts[0].objName).toBe("unknown(999)");
    expect(hosts[0].objType).toBe("unknown");
  });

  it("should summarize top processes and disk usage when resolved by obj_type", async () => {
    vi.mocked(client.getObjects).mockResolvedValueOnce([
      { objHash: 10, objName: "/host1", objType: "linux", alive: true, address: "", objFamily: "" },
    ]);
    vi.mocked(client.getHostTop).mockResolvedValueOnce([
      { PID: [100, 200], USER: ["root", "app"], CPU: [1.5, 2.5], MEM: [10, 20], NAME: ["java", "bash"], TIME: ["1:00", "0:30"] },
    ]);
    vi.mocked(client.getHostDisk).mockResolvedValueOnce([
      {
        Device: ["/dev/sda1", "tmpfs"],
        Total: [107374182400, 0],
        Used: [53687091200, 0],
        Free: [53687091200, 0],
        Pct: [50, 0],
        Type: ["ext4", "tmpfs"],
        Mount: ["/", "/dev/shm"],
      },
    ]);

    const result = await handler({ obj_type: "linux" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const hosts = output.hosts as Array<Record<string, unknown>>;
    const processes = hosts[0].processes as Record<string, unknown>;
    expect(processes.totalProcessCount).toBe(2);
    expect(processes.showingTop).toBe(2);
    const procList = processes.processes as Array<Record<string, unknown>>;
    expect(procList[0].pid).toBe(100);

    const disks = hosts[0].disks as Array<Record<string, unknown>>;
    expect(disks).toHaveLength(1);
    expect(disks[0].device).toBe("/dev/sda1");
    expect(disks[0].usedPct).toBe(50);
  });

  it("should skip processes/disks when include_top and include_disk are false", async () => {
    vi.mocked(client.getObjects).mockResolvedValueOnce([
      { objHash: 10, objName: "/host1", objType: "linux", alive: true, address: "", objFamily: "" },
    ]);

    const result = await handler({ obj_type: "linux", include_top: false, include_disk: false }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const hosts = output.hosts as Array<Record<string, unknown>>;
    expect(hosts[0].processes).toBeUndefined();
    expect(hosts[0].disks).toBeUndefined();
  });

  it("should collect a warning when getHostTop fails for a resolved host", async () => {
    vi.mocked(client.getObjects).mockResolvedValueOnce([
      { objHash: 10, objName: "/host1", objType: "linux", alive: true, address: "", objFamily: "" },
    ]);
    vi.mocked(client.getHostTop).mockRejectedValueOnce(new Error("timeout"));

    const result = await handler({ obj_type: "linux" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const warnings = output.warnings as string[];
    expect(warnings.some(w => w.includes("hostTop(/host1)") && w.includes("timeout"))).toBe(true);
    const hosts = output.hosts as Array<Record<string, unknown>>;
    expect(hosts[0].processes).toEqual([]);
  });
});

describe("get_thread_dump handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-thread-dump.js");
    mod.register(server);
    handler = tools.get("get_thread_dump")!.handler;
  });

  it("should parse packed parallel-array thread data and count states", async () => {
    vi.mocked(client.getThreadDump).mockResolvedValueOnce([
      {
        name: ["t1", "t2"], id: [1, 2], stat: ["RUNNABLE", "WAITING"],
        stack: ["stackA", ""], cpu: [10, 5], txid: ["tx1", ""], elapsed: [100, 200], service: [123, 0],
      },
    ]);

    const result = await handler({ obj_hash: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.threadCount).toBe(2);
    expect(output.summary).toEqual({ RUNNABLE: 1, WAITING: 1 });
    const threads = output.threads as Array<Record<string, unknown>>;
    expect(threads[0].stackTrace).toBe("stackA");
    expect(output.warnings).toBeUndefined();
  });

  it("should warn when no stack traces are available (TCP mode)", async () => {
    vi.mocked(client.getThreadDump).mockResolvedValueOnce([
      { name: ["t1"], id: [1], stat: ["RUNNABLE"], stack: [""], cpu: [1], txid: [""], elapsed: [10], service: [0] },
    ]);

    const result = await handler({ obj_hash: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const warnings = output.warnings as string[];
    expect(warnings.some(w => w.includes("Stack traces not available"))).toBe(true);
  });

  it("should include heap histogram when include_heap_histogram is true", async () => {
    vi.mocked(client.getHeapHistogram).mockResolvedValueOnce([
      { name: "java.lang.String", count: 100, bytes: 5000 },
    ]);

    const result = await handler({ obj_hash: 1, include_heap_histogram: true }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const heap = output.heapHistogram as Array<Record<string, unknown>>;
    expect(heap[0].name).toBe("java.lang.String");
  });

  it("should handle an empty thread dump without a stack-trace warning", async () => {
    vi.mocked(client.getThreadDump).mockResolvedValueOnce([]);

    const result = await handler({ obj_hash: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.threadCount).toBe(0);
    expect(output.summary).toEqual({});
    expect(output.threads).toEqual([]);
    expect(output.warnings).toBeUndefined();
  });

  it("should collect a warning when getThreadDump fails", async () => {
    vi.mocked(client.getThreadDump).mockRejectedValueOnce(new Error("timeout"));

    const result = await handler({ obj_hash: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const warnings = output.warnings as string[];
    expect(warnings.some(w => w.includes("[threadDump]") && w.includes("timeout"))).toBe(true);
    expect(output.threadCount).toBe(0);
  });
});

describe("list_active_services handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/list-active-services.js");
    mod.register(server);
    handler = tools.get("list_active_services")!.handler;
  });

  it("should return active services sorted by elapsed descending with a summary", async () => {
    vi.mocked(client.getActiveServices).mockResolvedValueOnce([
      { id: [1, 2], elapsed: [500, 1500], service: [111, 222], name: ["r1", "r2"], stat: ["THREAD", "SQL"], ip: ["1.1.1.1", "2.2.2.2"], sql: ["", "SELECT 1"] },
    ]);
    vi.mocked(client.lookupTexts).mockResolvedValueOnce({ "111": "/api/a", "222": "/api/b" });

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalActiveCount).toBe(2);
    const services = output.services as Array<Record<string, unknown>>;
    expect(services[0].elapsed).toBe(1500);
    expect(services[0].serviceName).toBe("/api/b");
    const summary = output.summary as Record<string, unknown>;
    expect(summary.longestElapsed).toBe(1500);
    expect(summary.avgElapsed).toBe(1000);
    expect(summary.sqlModeCount).toBe(1);
  });

  it("should filter by min_elapsed_ms", async () => {
    vi.mocked(client.getActiveServices).mockResolvedValueOnce([
      { id: [1, 2], elapsed: [500, 1500], service: [111, 222], name: ["r1", "r2"], stat: ["THREAD", "SQL"], ip: ["1.1.1.1", "2.2.2.2"], sql: ["", "SELECT 1"] },
    ]);
    vi.mocked(client.lookupTexts).mockResolvedValueOnce({ "111": "/api/a", "222": "/api/b" });

    const result = await handler({ min_elapsed_ms: 1000 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalActiveCount).toBe(1);
    const services = output.services as Array<Record<string, unknown>>;
    expect(services[0].elapsed).toBe(1500);
  });

  it("should fetch services for a specific obj_hash", async () => {
    vi.mocked(client.getActiveServicesByObj).mockResolvedValueOnce([
      { id: [5], elapsed: [300], service: [333], name: ["r3"], stat: ["THREAD"], ip: ["3.3.3.3"], sql: [""] },
    ]);
    vi.mocked(client.lookupTexts).mockResolvedValueOnce({ "333": "/api/c" });

    const result = await handler({ obj_hash: 42 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalActiveCount).toBe(1);
    expect(client.getActiveServicesByObj).toHaveBeenCalledWith(42);
  });

  it("should fetch thread detail and return early when thread_id and obj_hash are both provided", async () => {
    vi.mocked(client.getActiveThreadDetail).mockResolvedValueOnce({ thread: "info" });

    const result = await handler({ obj_hash: 1, thread_id: 99 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.objHash).toBe(1);
    expect(output.threadId).toBe(99);
    expect(output.threadDetail).toEqual({ thread: "info" });
    expect(output.services).toBeUndefined();
  });

  it("should handle an empty active service list", async () => {
    vi.mocked(client.getActiveServices).mockResolvedValueOnce([]);

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.totalActiveCount).toBe(0);
    const summary = output.summary as Record<string, unknown>;
    expect(summary.longestElapsed).toBe(0);
    expect(summary.avgElapsed).toBe(0);
  });

  it("should collect a warning when getActiveServices fails", async () => {
    vi.mocked(client.getActiveServices).mockRejectedValueOnce(new Error("fail"));

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const warnings = output.warnings as string[];
    expect(warnings.some(w => w.includes("activeService(tomcat)") && w.includes("fail"))).toBe(true);
    expect(output.totalActiveCount).toBe(0);
  });
});

describe("get_interaction_counters handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-interaction-counters.js");
    mod.register(server);
    handler = tools.get("get_interaction_counters")!.handler;
  });

  it("should return interactions sorted by count descending with a summary", async () => {
    vi.mocked(client.getInteractionCounters).mockResolvedValueOnce([
      { interactionType: "call", fromObjHash: 1, fromObjName: "svcA", toObjHash: 2, toObjName: "svcB", count: 100, errorCount: 5, totalElapsed: 2000 },
      { interactionType: "call", fromObjHash: 3, fromObjName: "svcC", toObjHash: 4, toObjName: "svcD", count: 50, errorCount: 0, totalElapsed: 500 },
    ]);

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const interactions = output.interactions as Array<Record<string, unknown>>;
    expect(interactions[0].count).toBe(100);
    expect(interactions[0].avgElapsed).toBe(20);
    const summary = output.summary as Record<string, unknown>;
    expect(summary.totalEdges).toBe(2);
    expect(summary.totalCalls).toBe(150);
    expect(summary.totalErrors).toBe(5);
    expect(summary.overallErrorRate).toBeCloseTo(3.33, 2);
  });

  it("should fall back to hash labels when obj names are missing", async () => {
    vi.mocked(client.getInteractionCounters).mockResolvedValueOnce([
      { fromObjHash: 9, toObjHash: 8, count: 1, errorCount: 0, totalElapsed: 10 },
    ]);

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const interactions = output.interactions as Array<Record<string, unknown>>;
    expect(interactions[0].from).toBe("hash:9");
    expect(interactions[0].to).toBe("hash:8");
    expect(interactions[0].interactionType).toBe("unknown");
    expect(interactions[0].avgElapsed).toBe(10);
  });

  it("should use obj_hashes when provided", async () => {
    vi.mocked(client.getInteractionCountersByObjHashes).mockResolvedValueOnce([
      { interactionType: "call", fromObjName: "A", toObjName: "B", count: 10, errorCount: 1, totalElapsed: 100 },
    ]);

    const result = await handler({ obj_hashes: "1,2" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const interactions = output.interactions as Array<Record<string, unknown>>;
    expect(interactions[0].from).toBe("A");
    expect(client.getInteractionCountersByObjHashes).toHaveBeenCalledWith("1,2");
  });

  it("should handle an empty interaction list", async () => {
    vi.mocked(client.getInteractionCounters).mockResolvedValueOnce([]);

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const summary = output.summary as Record<string, unknown>;
    expect(summary.totalEdges).toBe(0);
    expect(summary.totalCalls).toBe(0);
    expect(summary.overallErrorRate).toBe(0);
  });

  it("should collect a warning when getInteractionCounters fails", async () => {
    vi.mocked(client.getInteractionCounters).mockRejectedValueOnce(new Error("boom"));

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const warnings = output.warnings as string[];
    expect(warnings.some(w => w.includes("interactionCounters(tomcat)") && w.includes("boom"))).toBe(true);
    const interactions = output.interactions as unknown[];
    expect(interactions).toEqual([]);
  });
});

describe("lookup_text handler", () => {
  let handler: Handler;

  beforeEach(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/lookup-text.js");
    mod.register(server);
    handler = tools.get("lookup_text")!.handler;
  });

  it("should resolve hashes via client.lookupTexts and report unresolved hashes", async () => {
    vi.mocked(client.lookupTexts).mockResolvedValueOnce({ "123": "/api/users" });

    const result = await handler({ type: "service", hashes: "123,456" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.resolvedCount).toBe(1);
    const resolved = output.resolved as Record<string, string>;
    expect(resolved["123"]).toBe("/api/users");
    expect(output.unresolvedHashes).toEqual([456]);
    expect(output.note).toContain("1 hash(es) could not be resolved");
  });

  it("should compute IP addresses locally without calling client.lookupTexts", async () => {
    const callsBefore = vi.mocked(client.lookupTexts).mock.calls.length;

    const result = await handler({ type: "ip", hashes: "16909060" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    const resolved = output.resolved as Record<string, string>;
    expect(resolved["16909060"]).toBe("1.2.3.4");
    expect(vi.mocked(client.lookupTexts).mock.calls.length).toBe(callsBefore);
  });

  it("should return an error when no valid hashes are provided", async () => {
    const result = await handler({ type: "service", hashes: "abc,def" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("No valid hashes provided");
  });

  it("should default the date to today when not provided", async () => {
    vi.mocked(client.lookupTexts).mockResolvedValueOnce({ "123": "/api/users" });

    const result = await handler({ type: "service", hashes: "123" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.date).toBe(todayYmd());
  });

  it("should use the provided date parameter", async () => {
    vi.mocked(client.lookupTexts).mockResolvedValueOnce({ "123": "/api/users" });

    const result = await handler({ type: "service", hashes: "123", date: "20250101" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.date).toBe("20250101");
  });
});
