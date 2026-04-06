import { describe, it, expect, vi, beforeAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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
