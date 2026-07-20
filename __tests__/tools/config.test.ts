import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
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

vi.mock("../../client/index.js", () => {
  const mockClient = {
    getServerConfig: vi.fn(),
    getObjectConfig: vi.fn(),
    setServerConfig: vi.fn(),
    setObjectConfig: vi.fn(),
    setServerConfigKv: vi.fn(),
    setTypeConfigKv: vi.fn(),
    getAlertScripting: vi.fn(),
    readAlertScriptingLog: vi.fn(),
    setAlertConfigScripting: vi.fn(),
    setAlertRuleScripting: vi.fn(),
    kvGet: vi.fn(),
    kvSet: vi.fn(),
    kvSetTtl: vi.fn(),
    kvGetBulk: vi.fn(),
    kvSetBulk: vi.fn(),
    kvSpaceGet: vi.fn(),
    kvSpaceSet: vi.fn(),
    kvSpaceSetTtl: vi.fn(),
    kvSpaceGetBulk: vi.fn(),
    kvSpaceSetBulk: vi.fn(),
    kvPrivateGet: vi.fn(),
    kvPrivateSet: vi.fn(),
    kvPrivateSetTtl: vi.fn(),
    kvPrivateGetBulk: vi.fn(),
    kvPrivateSetBulk: vi.fn(),
    getShortener: vi.fn(),
    createShortener: vi.fn(),
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

describe("get_configure handler", () => {
  let handler: Handler;

  beforeAll(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-configure.js");
    mod.register(server);
    handler = tools.get("get_configure")!.handler;
  });

  it("should return server config with configStateList filtered to overridden values only", async () => {
    vi.mocked(client.getServerConfig).mockResolvedValueOnce({
      descMap: { a: "desc" },
      valueTypeMap: { a: "string" },
      valueTypeDescMap: { a: "desc" },
      configStateList: [
        { key: "net_collector_ip", value: "10.0.0.1", def: "127.0.0.1", extra: "ignored" },
        { key: "log_dir", value: "./logs", def: "./logs" },
      ],
    });

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.target).toBe("server");
    const config = output.config as Record<string, unknown>;
    expect(config.descMap).toBeUndefined();
    expect(config.valueTypeMap).toBeUndefined();
    expect(config.valueTypeDescMap).toBeUndefined();
    expect(config.configStateList).toEqual([
      { key: "net_collector_ip", value: "10.0.0.1", def: "127.0.0.1" },
    ]);
    expect(output.warnings).toBeUndefined();
  });

  it("should return agent config when obj_hash is provided", async () => {
    vi.mocked(client.getObjectConfig).mockResolvedValueOnce({ hostname: "agent1" });

    const result = await handler({ obj_hash: 42 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.target).toBe("agent");
    expect(output.objHash).toBe(42);
    expect(output.config).toEqual({ hostname: "agent1" });
    expect(client.getObjectConfig).toHaveBeenCalledWith(42);
  });

  it("should return null config and a warning when getServerConfig fails", async () => {
    vi.mocked(client.getServerConfig).mockRejectedValueOnce(new Error("connection refused"));

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.config).toBeNull();
    expect(output.warnings).toEqual(["[serverConfig] connection refused"]);
  });

  it("should pass through a null server config with no warnings", async () => {
    vi.mocked(client.getServerConfig).mockResolvedValueOnce(null);

    const result = await handler({}, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.config).toBeNull();
    expect(output.warnings).toBeUndefined();
  });

  it("should return an HTTP-mode-required error when getObjectConfig throws UnsupportedOperationError", async () => {
    vi.mocked(client.getObjectConfig).mockRejectedValueOnce(new UnsupportedOperationError("getObjectConfig"));

    const result = await handler({ obj_hash: 1 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("This operation requires HTTP mode");
    expect(output.detail).toContain("getObjectConfig");
    expect(output.hint).toContain("SCOUTER_API_URL");
  });

  it("should return null config and a warning when getObjectConfig fails", async () => {
    vi.mocked(client.getObjectConfig).mockRejectedValueOnce(new Error("agent unreachable"));

    const result = await handler({ obj_hash: 5 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.config).toBeNull();
    expect(output.warnings).toEqual(["[objectConfig] agent unreachable"]);
  });
});

describe("set_configure handler", () => {
  let handler: Handler;

  beforeAll(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/set-configure.js");
    mod.register(server);
    handler = tools.get("set_configure")!.handler;
  });

  it("should save server config", async () => {
    vi.mocked(client.setServerConfig).mockResolvedValueOnce("OK");
    const result = await handler({ target: "server", values: "log_dir=./logs" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output).toEqual({ target: "server", result: "OK" });
    expect(client.setServerConfig).toHaveBeenCalledWith("log_dir=./logs");
  });

  it("should error when server target is missing values", async () => {
    const result = await handler({ target: "server" }, {});
    expect(result.content[0].text).toBe("Error: 'values' is required for server target");
  });

  it("should save agent config", async () => {
    vi.mocked(client.setObjectConfig).mockResolvedValueOnce("OK");
    const result = await handler({ target: "agent", obj_hash: 7, values: "log_dir=./logs" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output).toEqual({ target: "agent", objHash: 7, result: "OK" });
    expect(client.setObjectConfig).toHaveBeenCalledWith(7, "log_dir=./logs");
  });

  it("should error when agent target is missing obj_hash", async () => {
    const result = await handler({ target: "agent", values: "x=y" }, {});
    expect(result.content[0].text).toBe("Error: 'obj_hash' is required for agent target");
  });

  it("should error when agent target is missing values", async () => {
    const result = await handler({ target: "agent", obj_hash: 1 }, {});
    expect(result.content[0].text).toBe("Error: 'values' is required for agent target");
  });

  it("should save server_kv", async () => {
    vi.mocked(client.setServerConfigKv).mockResolvedValueOnce(true);
    const result = await handler({ target: "server_kv", key: "k1", value: "v1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output).toEqual({ target: "server_kv", key: "k1", result: true });
    expect(client.setServerConfigKv).toHaveBeenCalledWith("k1", "v1");
  });

  it("should error when server_kv target is missing key/value", async () => {
    const result = await handler({ target: "server_kv", key: "k1" }, {});
    expect(result.content[0].text).toBe("Error: 'key' and 'value' are required for server_kv target");
  });

  it("should save type_kv", async () => {
    vi.mocked(client.setTypeConfigKv).mockResolvedValueOnce(true);
    const result = await handler({ target: "type_kv", obj_type: "tomcat", key: "k1", value: "v1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output).toEqual({ target: "type_kv", objType: "tomcat", key: "k1", result: true });
    expect(client.setTypeConfigKv).toHaveBeenCalledWith("tomcat", "k1", "v1");
  });

  it("should error when type_kv target is missing obj_type", async () => {
    const result = await handler({ target: "type_kv", key: "k1", value: "v1" }, {});
    expect(result.content[0].text).toBe("Error: 'obj_type' is required for type_kv target");
  });

  it("should error when type_kv target is missing key/value", async () => {
    const result = await handler({ target: "type_kv", obj_type: "tomcat" }, {});
    expect(result.content[0].text).toBe("Error: 'key' and 'value' are required for type_kv target");
  });

  it("should include a warning when setServerConfig fails", async () => {
    vi.mocked(client.setServerConfig).mockRejectedValueOnce(new Error("disk full"));
    const result = await handler({ target: "server", values: "x=y" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.result).toBeNull();
    expect(output.warnings).toEqual(["[setServerConfig] disk full"]);
  });

  it("should return an HTTP-mode-required error when setObjectConfig throws UnsupportedOperationError", async () => {
    vi.mocked(client.setObjectConfig).mockRejectedValueOnce(new UnsupportedOperationError("setObjectConfig"));
    const result = await handler({ target: "agent", obj_hash: 1, values: "x=y" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("This operation requires HTTP mode");
    expect(output.detail).toContain("setObjectConfig");
  });

  it("should include a warning when setObjectConfig fails", async () => {
    vi.mocked(client.setObjectConfig).mockRejectedValueOnce(new Error("agent offline"));
    const result = await handler({ target: "agent", obj_hash: 1, values: "x=y" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.result).toBeNull();
    expect(output.warnings).toEqual(["[setObjectConfig] agent offline"]);
  });

  it("should include a warning when setServerConfigKv fails", async () => {
    vi.mocked(client.setServerConfigKv).mockRejectedValueOnce(new Error("invalid key"));
    const result = await handler({ target: "server_kv", key: "k1", value: "v1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.result).toBeNull();
    expect(output.warnings).toEqual(["[setServerConfigKv] invalid key"]);
  });

  it("should include a warning when setTypeConfigKv fails", async () => {
    vi.mocked(client.setTypeConfigKv).mockRejectedValueOnce(new Error("unknown type"));
    const result = await handler({ target: "type_kv", obj_type: "tomcat", key: "k1", value: "v1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.result).toBeNull();
    expect(output.warnings).toEqual(["[setTypeConfigKv] unknown type"]);
  });
});

describe("get_alert_scripting handler", () => {
  let handler: Handler;

  beforeAll(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/get-alert-scripting.js");
    mod.register(server);
    handler = tools.get("get_alert_scripting")!.handler;
  });

  it("should return scripting stripped of desc maps without a compile log", async () => {
    vi.mocked(client.getAlertScripting).mockResolvedValueOnce({
      realCounterDescMap: { TPS: "desc" },
      pluginHelperDescMap: { helper: "desc" },
      script: "if (value > 100) alert()",
      threshold: 100,
    });

    const result = await handler({ counter_name: "TPS" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.counterName).toBe("TPS");
    const scripting = output.scripting as Record<string, unknown>;
    expect(scripting.realCounterDescMap).toBeUndefined();
    expect(scripting.pluginHelperDescMap).toBeUndefined();
    expect(scripting.script).toBe("if (value > 100) alert()");
    expect(output.compileLog).toBeUndefined();
  });

  it("should include compile log when include_compile_log and loop/index are provided", async () => {
    vi.mocked(client.getAlertScripting).mockResolvedValueOnce({ script: "x" });
    vi.mocked(client.readAlertScriptingLog).mockResolvedValueOnce({ log: "compiled OK" });

    const result = await handler({ counter_name: "TPS", include_compile_log: true, log_loop: 1, log_index: 2 }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.compileLog).toEqual({ log: "compiled OK" });
    expect(client.readAlertScriptingLog).toHaveBeenCalledWith(1, 2);
  });

  it("should not include compile log when log_loop/log_index are missing", async () => {
    vi.mocked(client.getAlertScripting).mockResolvedValueOnce({ script: "x" });

    const result = await handler({ counter_name: "TPS", include_compile_log: true }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.compileLog).toBeUndefined();
    expect(client.readAlertScriptingLog).not.toHaveBeenCalled();
  });

  it("should return null scripting and a warning when getAlertScripting fails", async () => {
    vi.mocked(client.getAlertScripting).mockRejectedValueOnce(new Error("not found"));

    const result = await handler({ counter_name: "TPS" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.scripting).toBeNull();
    expect(output.warnings).toEqual(["[alertScripting] not found"]);
  });

  it("should pass through a null scripting result with no warnings", async () => {
    vi.mocked(client.getAlertScripting).mockResolvedValueOnce(null);

    const result = await handler({ counter_name: "TPS" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.scripting).toBeNull();
    expect(output.warnings).toBeUndefined();
  });

  it("should return an HTTP-mode-required error when getAlertScripting throws UnsupportedOperationError", async () => {
    vi.mocked(client.getAlertScripting).mockRejectedValueOnce(new UnsupportedOperationError("getAlertScripting"));

    const result = await handler({ counter_name: "TPS" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("This operation requires HTTP mode");
    expect(output.detail).toContain("getAlertScripting");
  });
});

describe("set_alert_scripting handler", () => {
  let handler: Handler;

  beforeAll(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/set-alert-scripting.js");
    mod.register(server);
    handler = tools.get("set_alert_scripting")!.handler;
  });

  it("should save alert config scripting", async () => {
    vi.mocked(client.setAlertConfigScripting).mockResolvedValueOnce("OK");
    const result = await handler({ counter_name: "TPS", target: "config", values: "script body" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output).toEqual({ counterName: "TPS", target: "config", result: "OK" });
    expect(client.setAlertConfigScripting).toHaveBeenCalledWith("TPS", "script body");
  });

  it("should save alert rule scripting", async () => {
    vi.mocked(client.setAlertRuleScripting).mockResolvedValueOnce("OK");
    const result = await handler({ counter_name: "TPS", target: "rule", values: "rule body" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output).toEqual({ counterName: "TPS", target: "rule", result: "OK" });
    expect(client.setAlertRuleScripting).toHaveBeenCalledWith("TPS", "rule body");
  });

  it("should include a warning when setAlertConfigScripting fails", async () => {
    vi.mocked(client.setAlertConfigScripting).mockRejectedValueOnce(new Error("compile error"));
    const result = await handler({ counter_name: "TPS", target: "config", values: "bad script" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.result).toBeNull();
    expect(output.warnings).toEqual(["[setAlertConfigScripting] compile error"]);
  });

  it("should return an HTTP-mode-required error when setAlertRuleScripting throws UnsupportedOperationError", async () => {
    vi.mocked(client.setAlertRuleScripting).mockRejectedValueOnce(new UnsupportedOperationError("setAlertRuleScripting"));
    const result = await handler({ counter_name: "TPS", target: "rule", values: "x" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("This operation requires HTTP mode");
    expect(output.detail).toContain("setAlertRuleScripting");
  });
});

describe("manage_kv_store handler", () => {
  let handler: Handler;

  beforeAll(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/manage-kv-store.js");
    mod.register(server);
    handler = tools.get("manage_kv_store")!.handler;
  });

  const matrix: Array<{
    operation: "get" | "set" | "set_ttl" | "get_bulk" | "set_bulk";
    store: "global" | "custom" | "private";
    method: keyof typeof client;
    extraArgs: Record<string, unknown>;
    resolved: unknown;
  }> = [
    { operation: "get", store: "global", method: "kvGet", extraArgs: { key: "k1" }, resolved: "v1" },
    { operation: "get", store: "custom", method: "kvSpaceGet", extraArgs: { key: "k1", key_space: "ns1" }, resolved: "v2" },
    { operation: "get", store: "private", method: "kvPrivateGet", extraArgs: { key: "k1" }, resolved: "v3" },
    { operation: "set", store: "global", method: "kvSet", extraArgs: { key: "k1", value: "v1" }, resolved: true },
    { operation: "set", store: "custom", method: "kvSpaceSet", extraArgs: { key: "k1", value: "v1", key_space: "ns1" }, resolved: true },
    { operation: "set", store: "private", method: "kvPrivateSet", extraArgs: { key: "k1", value: "v1" }, resolved: true },
    { operation: "set_ttl", store: "global", method: "kvSetTtl", extraArgs: { key: "k1", ttl: 60 }, resolved: true },
    { operation: "set_ttl", store: "custom", method: "kvSpaceSetTtl", extraArgs: { key: "k1", key_space: "ns1", ttl: 60 }, resolved: true },
    { operation: "set_ttl", store: "private", method: "kvPrivateSetTtl", extraArgs: { key: "k1", ttl: 60 }, resolved: true },
    { operation: "get_bulk", store: "global", method: "kvGetBulk", extraArgs: { keys: "k1,k2" }, resolved: [] },
    { operation: "get_bulk", store: "custom", method: "kvSpaceGetBulk", extraArgs: { keys: "k1,k2", key_space: "ns1" }, resolved: [{ key: "k1", value: "v1" }] },
    { operation: "get_bulk", store: "private", method: "kvPrivateGetBulk", extraArgs: { keys: "k1,k2" }, resolved: [] },
    { operation: "set_bulk", store: "global", method: "kvSetBulk", extraArgs: { kvs: { k1: "v1" } }, resolved: [true] },
    { operation: "set_bulk", store: "custom", method: "kvSpaceSetBulk", extraArgs: { kvs: { k1: "v1" }, key_space: "ns1" }, resolved: [true] },
    { operation: "set_bulk", store: "private", method: "kvPrivateSetBulk", extraArgs: { kvs: { k1: "v1" } }, resolved: [true] },
  ];

  it.each(matrix)("handles $operation on $store store via $method", async ({ operation, store, method, extraArgs, resolved }) => {
    vi.mocked(client[method] as unknown as (...a: unknown[]) => Promise<unknown>).mockResolvedValueOnce(resolved);

    const result = await handler({ operation, store, ...extraArgs }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.operation).toBe(operation);
    expect(output.store).toBe(store);
    expect(output.result).toEqual(resolved);
    if (store === "custom") {
      expect(output.keySpace).toBe(extraArgs.key_space);
    } else {
      expect(output.keySpace).toBeUndefined();
    }
  });

  it("should default store to global and ttl to 0 when omitted", async () => {
    vi.mocked(client.kvSet).mockResolvedValueOnce(true);
    const result = await handler({ operation: "set", key: "k1", value: "v1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.store).toBe("global");
    expect(client.kvSet).toHaveBeenCalledWith("k1", "v1", 0);
  });

  it("should error when custom store is missing key_space", async () => {
    const result = await handler({ operation: "get", store: "custom", key: "k1" }, {});
    expect(result.content[0].text).toBe("Error: 'key_space' is required for custom store");
  });

  it("should error when get operation is missing key", async () => {
    const result = await handler({ operation: "get", store: "global" }, {});
    expect(result.content[0].text).toBe("Error: 'key' is required for get operation");
  });

  it("should error when set operation is missing value", async () => {
    const result = await handler({ operation: "set", store: "global", key: "k1" }, {});
    expect(result.content[0].text).toBe("Error: 'key' and 'value' are required for set operation");
  });

  it("should error when set_ttl operation is missing key", async () => {
    const result = await handler({ operation: "set_ttl", store: "global" }, {});
    expect(result.content[0].text).toBe("Error: 'key' is required for set_ttl operation");
  });

  it("should error when get_bulk operation is missing keys", async () => {
    const result = await handler({ operation: "get_bulk", store: "global" }, {});
    expect(result.content[0].text).toBe("Error: 'keys' is required for get_bulk operation");
  });

  it("should error when set_bulk operation is missing kvs", async () => {
    const result = await handler({ operation: "set_bulk", store: "global" }, {});
    expect(result.content[0].text).toBe("Error: 'kvs' is required for set_bulk operation");
  });

  it("should include a warning when kvGet fails", async () => {
    vi.mocked(client.kvGet).mockRejectedValueOnce(new Error("timeout"));
    const result = await handler({ operation: "get", store: "global", key: "k1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.result).toBeNull();
    expect(output.warnings).toEqual(["[kvGet] timeout"]);
  });

  it("should return an HTTP-mode-required error when kvSet throws UnsupportedOperationError", async () => {
    vi.mocked(client.kvSet).mockRejectedValueOnce(new UnsupportedOperationError("kvSet"));
    const result = await handler({ operation: "set", store: "global", key: "k1", value: "v1" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("This operation requires HTTP mode");
    expect(output.detail).toContain("kvSet");
  });
});

describe("manage_shortener handler", () => {
  let handler: Handler;

  beforeAll(async () => {
    const { server, tools } = createMockServer();
    const mod = await import("../../tools/manage-shortener.js");
    mod.register(server);
    handler = tools.get("manage_shortener")!.handler;
  });

  it("should get a stored url by key", async () => {
    vi.mocked(client.getShortener).mockResolvedValueOnce("https://example.com/original");
    const result = await handler({ operation: "get", key: "abc123" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output).toEqual({ operation: "get", key: "abc123", url: "https://example.com/original" });
  });

  it("should error when get operation is missing key", async () => {
    const result = await handler({ operation: "get" }, {});
    expect(result.content[0].text).toBe("Error: 'key' is required for get operation");
  });

  it("should create a shortened url", async () => {
    vi.mocked(client.createShortener).mockResolvedValueOnce("abc123");
    const result = await handler({ operation: "create", url: "https://example.com/original" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output).toEqual({ operation: "create", originalUrl: "https://example.com/original", shortenedKey: "abc123" });
  });

  it("should error when create operation is missing url", async () => {
    const result = await handler({ operation: "create" }, {});
    expect(result.content[0].text).toBe("Error: 'url' is required for create operation");
  });

  it("should include a warning when getShortener fails", async () => {
    vi.mocked(client.getShortener).mockRejectedValueOnce(new Error("key not found"));
    const result = await handler({ operation: "get", key: "missing" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.url).toBeNull();
    expect(output.warnings).toEqual(["[getShortener] key not found"]);
  });

  it("should return an HTTP-mode-required error when createShortener throws UnsupportedOperationError", async () => {
    vi.mocked(client.createShortener).mockRejectedValueOnce(new UnsupportedOperationError("createShortener"));
    const result = await handler({ operation: "create", url: "https://example.com" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.error).toBe("This operation requires HTTP mode");
    expect(output.detail).toContain("createShortener");
  });

  it("should include a warning when createShortener fails", async () => {
    vi.mocked(client.createShortener).mockRejectedValueOnce(new Error("service unavailable"));
    const result = await handler({ operation: "create", url: "https://example.com" }, {});
    const output = parseToolOutput(result) as Record<string, unknown>;
    expect(output.shortenedKey).toBeNull();
    expect(output.warnings).toEqual(["[createShortener] service unavailable"]);
  });
});

describe("Write tool registration gating (config/alert-scripting/kv-store/shortener)", () => {
  const originalEnv = process.env.SCOUTER_ENABLE_WRITE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SCOUTER_ENABLE_WRITE;
    } else {
      process.env.SCOUTER_ENABLE_WRITE = originalEnv;
    }
  });

  it("should not register set_configure, set_alert_scripting, manage_kv_store, or manage_shortener when SCOUTER_ENABLE_WRITE is unset", async () => {
    delete process.env.SCOUTER_ENABLE_WRITE;
    const { registerAllTools } = await import("../../tools/index.js");
    const { server, tools } = createMockServer();
    registerAllTools(server);
    expect(tools.has("set_configure")).toBe(false);
    expect(tools.has("set_alert_scripting")).toBe(false);
    expect(tools.has("manage_kv_store")).toBe(false);
    expect(tools.has("manage_shortener")).toBe(false);
    expect(tools.has("get_configure")).toBe(true);
    expect(tools.has("get_alert_scripting")).toBe(true);
  });

  it("should register set_configure, set_alert_scripting, manage_kv_store, and manage_shortener when SCOUTER_ENABLE_WRITE is 'true'", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const { registerAllTools, isWriteEnabled } = await import("../../tools/index.js");
    expect(isWriteEnabled()).toBe(true);
    const { server, tools } = createMockServer();
    registerAllTools(server);
    expect(tools.has("set_configure")).toBe(true);
    expect(tools.has("set_alert_scripting")).toBe(true);
    expect(tools.has("manage_kv_store")).toBe(true);
    expect(tools.has("manage_shortener")).toBe(true);
  });

  it("should not register write tools when SCOUTER_ENABLE_WRITE is 'false'", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "false";
    const { registerAllTools, isWriteEnabled } = await import("../../tools/index.js");
    expect(isWriteEnabled()).toBe(false);
    const { server, tools } = createMockServer();
    registerAllTools(server);
    expect(tools.has("manage_kv_store")).toBe(false);
    expect(tools.has("manage_shortener")).toBe(false);
  });
});
