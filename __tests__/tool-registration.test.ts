import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools, isWriteEnabled } from "../tools/index.js";

interface ToolRegistration {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
    };
  };
  callback: Function;
}

function createMockServer(): { server: McpServer; registrations: ToolRegistration[] } {
  const registrations: ToolRegistration[] = [];
  const server = {
    registerTool: vi.fn((name: string, config: ToolRegistration["config"], cb: Function) => {
      registrations.push({ name, config, callback: cb });
      return {} as never;
    }),
  } as unknown as McpServer;
  return { server, registrations };
}

const toolModules = import.meta.glob("../tools/*.ts", { eager: true }) as Record<
  string,
  { register?: (s: McpServer) => void; params?: Record<string, unknown> }
>;

const READ_ONLY_TOOLS = new Set([
  "get_system_overview", "diagnose_performance", "get_counter_trend",
  "get_realtime_xlogs", "search_transactions", "get_transaction_detail",
  "list_active_services", "get_distributed_trace", "get_service_summary",
  "get_sql_analysis", "get_error_summary", "get_interaction_counters",
  "get_visitor_stats", "get_ip_summary", "get_user_agent_summary",
  "get_alert_summary", "get_alert_scripting", "get_configure",
  "get_server_info", "get_host_info", "get_agent_info",
  "get_thread_dump", "get_raw_profile", "get_raw_xlog", "lookup_text",
]);

const WRITE_TOOLS = new Set([
  "set_configure", "set_alert_scripting",
  "manage_kv_store", "manage_shortener",
  "control_thread", "remove_inactive_objects",
]);

const DESTRUCTIVE_TOOLS = new Set([
  "control_thread", "remove_inactive_objects",
]);

const toolEntries = Object.entries(toolModules).filter(
  ([path]) => !path.includes("shared-utils") && !path.endsWith("/index.ts"),
);

describe("Tool Registration", () => {
  for (const [path, mod] of toolEntries) {
    const fileName = path.split("/").pop()!.replace(".ts", "");

    describe(fileName, () => {
      let registration: ToolRegistration;

      beforeAll(() => {
        const { server, registrations } = createMockServer();
        mod.register!(server);
        registration = registrations[0];
      });

      it("should export a register function", () => {
        expect(typeof mod.register).toBe("function");
      });

      it("should export params schema", () => {
        expect(mod.params).toBeDefined();
        expect(typeof mod.params).toBe("object");
      });

      it("should call registerTool", () => {
        expect(registration).toBeDefined();
        expect(registration.name).toBeTruthy();
      });

      it("should have a title", () => {
        expect(registration.config.title).toBeTruthy();
        expect(typeof registration.config.title).toBe("string");
      });

      it("should have a description", () => {
        expect(registration.config.description).toBeTruthy();
        expect(registration.config.description!.length).toBeGreaterThan(20);
      });

      it("should have inputSchema", () => {
        expect(registration.config.inputSchema).toBeDefined();
      });

      it("should have annotations with all three hints", () => {
        const annotations = registration.config.annotations;
        expect(annotations).toBeDefined();
        expect(typeof annotations!.readOnlyHint).toBe("boolean");
        expect(typeof annotations!.destructiveHint).toBe("boolean");
        expect(typeof annotations!.idempotentHint).toBe("boolean");
      });

      it("should have correct readOnlyHint", () => {
        const isReadOnly = READ_ONLY_TOOLS.has(registration.name);
        expect(registration.config.annotations!.readOnlyHint).toBe(isReadOnly);
      });

      it("should have correct destructiveHint", () => {
        const isDestructive = DESTRUCTIVE_TOOLS.has(registration.name);
        expect(registration.config.annotations!.destructiveHint).toBe(isDestructive);
      });

      it("should have a valid callback function", () => {
        expect(typeof registration.callback).toBe("function");
      });
    });
  }
});

describe("Tool Registry Integrity", () => {
  let allRegistrations: ToolRegistration[];

  beforeAll(() => {
    const { server, registrations } = createMockServer();
    for (const [, mod] of toolEntries) {
      if (typeof mod.register === "function") {
        mod.register(server);
      }
    }
    allRegistrations = registrations;
  });

  it("should register all 31 tools", () => {
    expect(allRegistrations).toHaveLength(31);
  });

  it("should have unique tool names", () => {
    const names = allRegistrations.map(r => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("should have unique titles", () => {
    const titles = allRegistrations.map(r => r.config.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("should not mark any read-only tool as destructive", () => {
    for (const reg of allRegistrations) {
      if (reg.config.annotations?.readOnlyHint) {
        expect(
          reg.config.annotations.destructiveHint,
          `${reg.name} is readOnly but also destructive`,
        ).toBe(false);
      }
    }
  });

  it("should use underscore naming convention for all tool names", () => {
    for (const reg of allRegistrations) {
      expect(reg.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe("Write Permission via SCOUTER_ENABLE_WRITE", () => {
  const originalEnv = process.env.SCOUTER_ENABLE_WRITE;

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.SCOUTER_ENABLE_WRITE;
    } else {
      process.env.SCOUTER_ENABLE_WRITE = originalEnv;
    }
  });

  it("should not register write tools when SCOUTER_ENABLE_WRITE is unset", () => {
    delete process.env.SCOUTER_ENABLE_WRITE;
    const { server, registrations } = createMockServer();
    registerAllTools(server);
    const names = new Set(registrations.map(r => r.name));
    for (const writeTool of WRITE_TOOLS) {
      expect(names.has(writeTool), `${writeTool} should not be registered`).toBe(false);
    }
    expect(registrations).toHaveLength(25);
  });

  it("should not register write tools when SCOUTER_ENABLE_WRITE is 'false'", () => {
    process.env.SCOUTER_ENABLE_WRITE = "false";
    const { server, registrations } = createMockServer();
    registerAllTools(server);
    const names = new Set(registrations.map(r => r.name));
    for (const writeTool of WRITE_TOOLS) {
      expect(names.has(writeTool), `${writeTool} should not be registered`).toBe(false);
    }
    expect(registrations).toHaveLength(25);
  });

  it("should register all tools including write tools when SCOUTER_ENABLE_WRITE is 'true'", () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const { server, registrations } = createMockServer();
    registerAllTools(server);
    const names = new Set(registrations.map(r => r.name));
    for (const writeTool of WRITE_TOOLS) {
      expect(names.has(writeTool), `${writeTool} should be registered`).toBe(true);
    }
    expect(registrations).toHaveLength(31);
  });

  it("should always register all read-only tools regardless of SCOUTER_ENABLE_WRITE", () => {
    delete process.env.SCOUTER_ENABLE_WRITE;
    const { server, registrations } = createMockServer();
    registerAllTools(server);
    const names = new Set(registrations.map(r => r.name));
    for (const readTool of READ_ONLY_TOOLS) {
      expect(names.has(readTool), `${readTool} should be registered`).toBe(true);
    }
  });

  it("isWriteEnabled should return false when env is unset", () => {
    delete process.env.SCOUTER_ENABLE_WRITE;
    expect(isWriteEnabled()).toBe(false);
  });

  it("isWriteEnabled should return true only when env is 'true'", () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    expect(isWriteEnabled()).toBe(true);
    process.env.SCOUTER_ENABLE_WRITE = "TRUE";
    expect(isWriteEnabled()).toBe(false);
    process.env.SCOUTER_ENABLE_WRITE = "1";
    expect(isWriteEnabled()).toBe(false);
  });
});
