import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { truncate, pctOfTotal, enrichSummary, buildResponse, bindSqlParams, isMaskPiiEnabled, maskXLogPii, maskRawResult } from "../tools/shared-utils.js";

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
  beforeEach(() => { process.env.SCOUTER_MASK_PII = "false"; });
  afterEach(() => { delete process.env.SCOUTER_MASK_PII; });

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

  it("should replace @{N} literal placeholders before ? bind params", () => {
    const sql = "SELECT * FROM t WHERE status = '@{1}' AND name = ?";
    const params = "'Y','John'";
    expect(bindSqlParams(sql, params)).toBe("SELECT * FROM t WHERE status = 'Y' AND name = 'John'");
  });

  it("should handle multiple @{N} placeholders", () => {
    const sql = "SELECT * FROM t WHERE a = '@{1}' AND b = @{2} AND c = ?";
    const params = "'active',100,'test'";
    expect(bindSqlParams(sql, params)).toBe("SELECT * FROM t WHERE a = 'active' AND b = 100 AND c = 'test'");
  });

  it("should handle @{N} only (no ? placeholders)", () => {
    const sql = "SELECT * FROM t WHERE status = '@{1}' AND flag = '@{2}'";
    const params = "'Y','N'";
    expect(bindSqlParams(sql, params)).toBe("SELECT * FROM t WHERE status = 'Y' AND flag = 'N'");
  });

  it("should handle @{N} with §-delimited params", () => {
    const sql = "SELECT * FROM t WHERE a = '@{1}' AND b = ?";
    const params = "'N'§'hello'";
    expect(bindSqlParams(sql, params)).toBe("SELECT * FROM t WHERE a = 'N' AND b = 'hello'");
  });

  it("should handle real-world Scouter SQL with mixed @{N} and ? placeholders", () => {
    const sql = "SELECT coalesce(c.yn, '@{1}') FROM t WHERE ptl_id = ? AND chnl_id = ? AND kind != '@{2}' LIMIT ?::numeric";
    const params = "'N','DEFAULT','PTL001','CH001',50";
    expect(bindSqlParams(sql, params)).toBe(
      "SELECT coalesce(c.yn, 'N') FROM t WHERE ptl_id = 'PTL001' AND chnl_id = 'CH001' AND kind != 'DEFAULT' LIMIT 50::numeric"
    );
  });

  it("should return SQL template when SCOUTER_MASK_PII is not false", () => {
    delete process.env.SCOUTER_MASK_PII;
    const sql = "SELECT * FROM users WHERE name=? AND age=?";
    expect(bindSqlParams(sql, "'John',30")).toBe(sql);
  });
});

describe("isMaskPiiEnabled", () => {
  afterEach(() => { delete process.env.SCOUTER_MASK_PII; });

  it("should return true by default (not set)", () => {
    delete process.env.SCOUTER_MASK_PII;
    expect(isMaskPiiEnabled()).toBe(true);
  });

  it("should return true when SCOUTER_MASK_PII=true", () => {
    process.env.SCOUTER_MASK_PII = "true";
    expect(isMaskPiiEnabled()).toBe(true);
  });

  it("should return false only when explicitly set to false", () => {
    process.env.SCOUTER_MASK_PII = "false";
    expect(isMaskPiiEnabled()).toBe(false);
  });
});

describe("maskXLogPii", () => {
  afterEach(() => { delete process.env.SCOUTER_MASK_PII; });

  it("should return entry unchanged when explicitly disabled", () => {
    process.env.SCOUTER_MASK_PII = "false";
    const entry = { ipaddr: "192.168.1.100", login: "admin", elapsed: 500 };
    expect(maskXLogPii(entry)).toEqual(entry);
  });

  it("should mask IP addresses (all field name variants)", () => {
    process.env.SCOUTER_MASK_PII = "true";
    const entry = { ipaddr: "192.168.1.100", ipAddr: "10.0.0.5", ip: "172.16.0.1" };
    const result = maskXLogPii(entry);
    expect(result.ipaddr).toBe("192.168.1.***");
    expect(result.ipAddr).toBe("10.0.0.***");
    expect(result.ip).toBe("172.16.0.***");
  });

  it("should mask login IDs", () => {
    process.env.SCOUTER_MASK_PII = "true";
    expect(maskXLogPii({ login: "username" }).login).toBe("us****me");
    expect(maskXLogPii({ login: "ab" }).login).toBe("**");
    expect(maskXLogPii({ login: "a" }).login).toBe("**");
  });

  it("should not mask empty login", () => {
    process.env.SCOUTER_MASK_PII = "true";
    expect(maskXLogPii({ login: "" }).login).toBe("");
  });

  it("should mask userAgent and ua", () => {
    process.env.SCOUTER_MASK_PII = "true";
    const entry = { userAgent: "Mozilla/5.0", ua: "Chrome" };
    const result = maskXLogPii(entry);
    expect(result.userAgent).toBe("[masked]");
    expect(result.ua).toBe("[masked]");
  });

  it("should preserve non-PII fields", () => {
    process.env.SCOUTER_MASK_PII = "true";
    const entry = { elapsed: 500, service: 12345, ipaddr: "1.2.3.4" };
    const result = maskXLogPii(entry);
    expect(result.elapsed).toBe(500);
    expect(result.service).toBe(12345);
  });
});

describe("maskRawResult", () => {
  afterEach(() => { delete process.env.SCOUTER_MASK_PII; });

  it("should mask array of objects", () => {
    process.env.SCOUTER_MASK_PII = "true";
    const data = [{ ipaddr: "1.2.3.4", login: "user1" }, { ipaddr: "5.6.7.8" }];
    const result = maskRawResult(data) as Array<Record<string, unknown>>;
    expect(result[0].ipaddr).toBe("1.2.3.***");
    expect(result[0].login).toBe("us****r1");
    expect(result[1].ipaddr).toBe("5.6.7.***");
  });

  it("should mask single object", () => {
    process.env.SCOUTER_MASK_PII = "true";
    const data = { ipaddr: "10.0.0.1", login: "admin" };
    const result = maskRawResult(data) as Record<string, unknown>;
    expect(result.ipaddr).toBe("10.0.0.***");
    expect(result.login).toBe("ad****in");
  });

  it("should return primitives as-is", () => {
    process.env.SCOUTER_MASK_PII = "true";
    expect(maskRawResult("hello")).toBe("hello");
    expect(maskRawResult(42)).toBe(42);
    expect(maskRawResult(null)).toBe(null);
  });
});
