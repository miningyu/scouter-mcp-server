import { describe, it, expect } from "vitest";
import { z } from "zod";
import { getOperation, listAvailableOperations, operations } from "../../operations/registry.js";
import { isDestructiveOperation, isWriteOperation } from "../../operations/definition.js";

const READ_ONLY_OPERATIONS = [
  "get_system_overview", "diagnose_performance", "get_counter_trend",
  "get_realtime_xlogs", "search_transactions", "get_transaction_detail",
  "list_active_services", "get_distributed_trace", "get_service_summary",
  "get_sql_analysis", "get_error_summary", "get_interaction_counters",
  "get_visitor_stats", "get_ip_summary", "get_user_agent_summary",
  "get_alert_summary", "get_alert_scripting", "get_configure",
  "get_server_info", "get_host_info", "get_agent_info",
  "get_thread_dump", "get_raw_profile", "get_raw_xlog", "lookup_text",
];

const WRITE_OPERATIONS = [
  "set_configure", "set_alert_scripting",
  "manage_kv_store", "manage_shortener",
  "control_thread", "remove_inactive_objects",
];

const DESTRUCTIVE_OPERATIONS = ["control_thread", "remove_inactive_objects"];

describe("operation registry", () => {
  it("holds all 31 operations", () => {
    expect(operations).toHaveLength(31);
  });

  it("has no duplicate operation names", () => {
    const names = operations.map(op => op.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no duplicate titles", () => {
    const titles = operations.map(op => op.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("exposes every read-only operation", () => {
    for (const name of READ_ONLY_OPERATIONS) {
      expect(getOperation(name), name).toBeDefined();
      expect(getOperation(name)!.annotations.readOnlyHint, name).toBe(true);
    }
  });

  it("exposes every write operation", () => {
    for (const name of WRITE_OPERATIONS) {
      const op = getOperation(name);
      expect(op, name).toBeDefined();
      expect(op!.annotations.readOnlyHint, name).toBe(false);
      expect(isWriteOperation(op!), name).toBe(true);
    }
  });

  it("marks exactly the destructive operations as destructive", () => {
    for (const op of operations) {
      expect(isDestructiveOperation(op), op.name).toBe(DESTRUCTIVE_OPERATIONS.includes(op.name));
    }
  });

  it("never marks a read-only operation destructive", () => {
    for (const op of operations) {
      if (op.annotations.readOnlyHint) expect(op.annotations.destructiveHint, op.name).toBe(false);
    }
  });

  it("gives every operation complete metadata", () => {
    for (const op of operations) {
      expect(op.name, op.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(op.title, op.name).toBeTruthy();
      expect(op.description.length, op.name).toBeGreaterThan(20);
      expect(typeof op.annotations.readOnlyHint, op.name).toBe("boolean");
      expect(typeof op.annotations.destructiveHint, op.name).toBe("boolean");
      expect(typeof op.annotations.idempotentHint, op.name).toBe("boolean");
      expect(typeof op.execute, op.name).toBe("function");
    }
  });

  it("gives every operation a parseable Zod input shape", () => {
    for (const op of operations) {
      expect(() => z.object(op.inputShape), op.name).not.toThrow();
      for (const [field, schema] of Object.entries(op.inputShape)) {
        expect((schema as z.ZodType).description, `${op.name}.${field}`).toBeTruthy();
      }
    }
  });

  it("returns undefined for an unknown operation", () => {
    expect(getOperation("no_such_operation")).toBeUndefined();
  });

  it("hides write operations when write is disabled", () => {
    const available = listAvailableOperations(false);
    expect(available).toHaveLength(25);
    expect(available.every(op => op.annotations.readOnlyHint)).toBe(true);
  });

  it("exposes every operation when write is enabled", () => {
    expect(listAvailableOperations(true)).toHaveLength(31);
  });

  it("derives availability from SCOUTER_ENABLE_WRITE when not told", () => {
    const original = process.env.SCOUTER_ENABLE_WRITE;
    try {
      delete process.env.SCOUTER_ENABLE_WRITE;
      expect(listAvailableOperations()).toHaveLength(25);
      process.env.SCOUTER_ENABLE_WRITE = "true";
      expect(listAvailableOperations()).toHaveLength(31);
    } finally {
      if (original === undefined) delete process.env.SCOUTER_ENABLE_WRITE;
      else process.env.SCOUTER_ENABLE_WRITE = original;
    }
  });
});
