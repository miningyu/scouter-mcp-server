import { describe, it, expect } from "vitest";
import { truncate, pctOfTotal, enrichSummary, buildResponse, bindSqlParams } from "../tools/shared-utils.js";

describe("truncate", () => {
  it("should return string as-is when within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("should truncate and append ellipsis", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("should handle exact limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("pctOfTotal", () => {
  it("should calculate percentage", () => {
    expect(pctOfTotal(25, 100)).toBe(25);
  });

  it("should return 0 when total is 0", () => {
    expect(pctOfTotal(10, 0)).toBe(0);
  });

  it("should round to 2 decimals", () => {
    expect(pctOfTotal(1, 3)).toBe(33.33);
  });
});

describe("enrichSummary", () => {
  it("should compute all derived fields", () => {
    const result = enrichSummary({
      count: 100,
      errorCount: 10,
      elapsedSum: 5000,
      cpuSum: 2000,
      memorySum: 1000,
    });
    expect(result.count).toBe(100);
    expect(result.errorCount).toBe(10);
    expect(result.errorRate).toBe(10);
    expect(result.avgElapsed).toBe(50);
    expect(result.avgCpu).toBe(20);
    expect(result.avgMemory).toBe(10);
  });

  it("should handle zero counts", () => {
    const result = enrichSummary({ count: 0 });
    expect(result.errorRate).toBe(0);
    expect(result.avgElapsed).toBe(0);
  });

  it("should handle undefined fields", () => {
    const result = enrichSummary({});
    expect(result.count).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.elapsedSum).toBe(0);
  });
});

describe("buildResponse", () => {
  it("should build MCP response with warnings", () => {
    const output: Record<string, unknown> = { data: "test" };
    const result = buildResponse(output, ["warn1"]);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain('"data": "test"');
    expect(result.content[0].text).toContain('"warnings"');
    expect(result.content[0].text).toContain("warn1");
  });

  it("should omit warnings when empty", () => {
    const output: Record<string, unknown> = { data: "test" };
    const result = buildResponse(output, []);
    expect(result.content[0].text).not.toContain("warnings");
  });
});

describe("bindSqlParams", () => {
  it("should substitute comma-separated params into ? placeholders", () => {
    const sql = "SELECT * FROM users WHERE name=? AND age=?";
    const params = "'John',30";
    expect(bindSqlParams(sql, params)).toBe("SELECT * FROM users WHERE name='John' AND age=30");
  });

  it("should handle §-delimited params", () => {
    const sql = "SELECT * FROM t WHERE a=? AND b=?";
    const params = "'hello'§123";
    expect(bindSqlParams(sql, params)).toBe("SELECT * FROM t WHERE a='hello' AND b=123");
  });

  it("should handle quoted strings containing commas", () => {
    const sql = "INSERT INTO t(a, b) VALUES (?, ?)";
    const params = "'hello, world','foo'";
    expect(bindSqlParams(sql, params)).toBe("INSERT INTO t(a, b) VALUES ('hello, world', 'foo')");
  });

  it("should handle null param values", () => {
    const sql = "INSERT INTO t(a, b) VALUES (?, ?)";
    const params = "'val',null";
    expect(bindSqlParams(sql, params)).toBe("INSERT INTO t(a, b) VALUES ('val', null)");
  });

  it("should return original SQL when paramStr is empty", () => {
    const sql = "SELECT 1";
    expect(bindSqlParams(sql, "")).toBe("SELECT 1");
    expect(bindSqlParams(sql, null)).toBe("SELECT 1");
    expect(bindSqlParams(sql, undefined)).toBe("SELECT 1");
  });

  it("should leave extra ? placeholders when fewer params than placeholders", () => {
    const sql = "SELECT * FROM t WHERE a=? AND b=? AND c=?";
    const params = "'x','y'";
    expect(bindSqlParams(sql, params)).toBe("SELECT * FROM t WHERE a='x' AND b='y' AND c=?");
  });

  it("should not replace ? inside quoted strings in SQL", () => {
    const sql = "SELECT * FROM t WHERE a='literal?' AND b=?";
    const params = "42";
    expect(bindSqlParams(sql, params)).toBe("SELECT * FROM t WHERE a='literal?' AND b=42");
  });

  it("should handle escaped single quotes in params", () => {
    const sql = "SELECT * FROM t WHERE a=?";
    const params = "'it''s a test'";
    expect(bindSqlParams(sql, params)).toBe("SELECT * FROM t WHERE a='it''s a test'");
  });

  it("should handle binary placeholder params", () => {
    const sql = "INSERT INTO t(data) VALUES (?)";
    const params = "[bytes]";
    expect(bindSqlParams(sql, params)).toBe("INSERT INTO t(data) VALUES ([bytes])");
  });
});
