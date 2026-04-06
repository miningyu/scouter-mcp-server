import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  now,
  minutesAgo,
  todayYmd,
  formatYmd,
  formatYmdHms,
  parseTimeToMillis,
  millisToYmdHms,
  millisToIso,
} from "../time-utils.js";

describe("now", () => {
  it("should return current timestamp in milliseconds", () => {
    const before = Date.now();
    const result = now();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

describe("minutesAgo", () => {
  it("should subtract the given minutes from now", () => {
    const before = Date.now();
    const result = minutesAgo(10);
    const expected = before - 10 * 60 * 1000;
    expect(result).toBeGreaterThanOrEqual(expected - 10);
    expect(result).toBeLessThanOrEqual(expected + 10);
  });

  it("should return now for 0 minutes", () => {
    const before = Date.now();
    const result = minutesAgo(0);
    expect(result).toBeGreaterThanOrEqual(before - 5);
    expect(result).toBeLessThanOrEqual(before + 5);
  });
});

describe("todayYmd", () => {
  it("should return today in YYYYMMDD format", () => {
    const result = todayYmd();
    expect(result).toMatch(/^\d{8}$/);
    const d = new Date();
    const expected = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    expect(result).toBe(expected);
  });
});

describe("formatYmd", () => {
  it("should format date as YYYYMMDD", () => {
    expect(formatYmd(new Date(2024, 0, 5))).toBe("20240105");
  });

  it("should pad single-digit month and day", () => {
    expect(formatYmd(new Date(2024, 2, 9))).toBe("20240309");
  });

  it("should handle December", () => {
    expect(formatYmd(new Date(2024, 11, 31))).toBe("20241231");
  });
});

describe("formatYmdHms", () => {
  it("should format date as YYYYMMDDHHmmss", () => {
    const date = new Date(2024, 3, 5, 14, 30, 45);
    expect(formatYmdHms(date)).toBe("20240405143045");
  });

  it("should pad single-digit hours/minutes/seconds", () => {
    const date = new Date(2024, 0, 1, 1, 2, 3);
    expect(formatYmdHms(date)).toBe("20240101010203");
  });
});

describe("parseTimeToMillis", () => {
  it("should return fallback for undefined input", () => {
    expect(parseTimeToMillis(undefined, 12345)).toBe(12345);
  });

  it("should return fallback for empty string", () => {
    expect(parseTimeToMillis("", 12345)).toBe(12345);
  });

  it("should parse epoch milliseconds (13+ digits)", () => {
    expect(parseTimeToMillis("1712336400000", 0)).toBe(1712336400000);
  });

  it("should parse ISO date string", () => {
    const iso = "2024-04-05T14:30:00Z";
    const expected = Date.parse(iso);
    expect(parseTimeToMillis(iso, 0)).toBe(expected);
  });

  it("should parse 6-digit HHMMSS format with today's date", () => {
    const result = parseTimeToMillis("143045", 0);
    expect(result).toBeGreaterThan(0);
    expect(typeof result).toBe("number");
    expect(Number.isNaN(result)).toBe(false);
  });

  it("should parse 6-digit HHMMSS with explicit date context", () => {
    const result = parseTimeToMillis("090000", 0, "20240105");
    expect(result).toBeGreaterThan(0);
    expect(typeof result).toBe("number");
    expect(Number.isNaN(result)).toBe(false);
  });

  it("should return fallback for unparseable input", () => {
    expect(parseTimeToMillis("not-a-date", 999)).toBe(999);
  });
});

describe("millisToYmdHms", () => {
  it("should convert millis to YYYYMMDDHHmmss", () => {
    const date = new Date(2024, 3, 5, 14, 30, 45);
    expect(millisToYmdHms(date.getTime())).toBe("20240405143045");
  });
});

describe("millisToIso", () => {
  it("should convert millis to ISO string", () => {
    const result = millisToIso(1712336400000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    expect(new Date(result).getTime()).toBe(1712336400000);
  });
});
