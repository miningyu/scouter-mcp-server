import { describe, it, expect } from "vitest";
import { jsonStringify, catchWarn, UnsupportedOperationError } from "../client/index.js";

describe("jsonStringify", () => {
  it("should serialize simple objects", () => {
    const result = jsonStringify({ hello: "world" });
    expect(result).toContain('"hello": "world"');
  });

  it("should handle BigInt values", () => {
    const result = jsonStringify({ big: 9007199254740993n });
    expect(result).toContain("9007199254740993");
  });

  it("should handle nested objects", () => {
    const result = jsonStringify({ a: { b: { c: 1 } } });
    const parsed = JSON.parse(result);
    expect(parsed.a.b.c).toBe(1);
  });

  it("should handle arrays", () => {
    const result = jsonStringify([1, 2, 3]);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it("should handle null and undefined", () => {
    const result = jsonStringify({ a: null, b: undefined });
    const parsed = JSON.parse(result);
    expect(parsed.a).toBeNull();
    expect(parsed.b).toBeUndefined();
  });

  it("should truncate very long output", () => {
    const largeObj: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) {
      largeObj[`key_${i}`] = "x".repeat(20);
    }
    const result = jsonStringify(largeObj);
    expect(result).toContain("truncated");
    expect(result.length).toBeLessThanOrEqual(80_100);
  });
});

describe("catchWarn", () => {
  it("should return resolved value on success", async () => {
    const warnings: string[] = [];
    const result = await catchWarn(Promise.resolve(42), 0, warnings, "test");
    expect(result).toBe(42);
    expect(warnings).toHaveLength(0);
  });

  it("should return fallback and add warning on failure", async () => {
    const warnings: string[] = [];
    const result = await catchWarn(
      Promise.reject(new Error("boom")),
      "default",
      warnings,
      "test-context",
    );
    expect(result).toBe("default");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[test-context]");
    expect(warnings[0]).toContain("boom");
  });

  it("should rethrow UnsupportedOperationError", async () => {
    const warnings: string[] = [];
    await expect(
      catchWarn(
        Promise.reject(new UnsupportedOperationError("someMethod")),
        "default",
        warnings,
        "test",
      ),
    ).rejects.toThrow(UnsupportedOperationError);
  });

  it("should handle non-Error rejections", async () => {
    const warnings: string[] = [];
    const result = await catchWarn(
      Promise.reject("string error"),
      [],
      warnings,
      "ctx",
    );
    expect(result).toEqual([]);
    expect(warnings[0]).toContain("string error");
  });
});

describe("UnsupportedOperationError", () => {
  it("should include method name in message", () => {
    const err = new UnsupportedOperationError("getServerConfig");
    expect(err.message).toContain("getServerConfig");
    expect(err.message).toContain("TCP");
  });

  it("should be instanceof Error", () => {
    const err = new UnsupportedOperationError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UnsupportedOperationError);
  });
});
