import { describe, it, expect, vi, afterEach } from "vitest";
import { CliUsageError } from "../../cli/args.js";
import { durationMinutes, parseDuration, parseLimit, toOperationTimeInput, windowFromSince } from "../../cli/time-args.js";
import { millisToYmd } from "../../time-utils.js";

afterEach(() => { vi.useRealTimers(); });

describe("parseDuration", () => {
  it.each([
    ["45s", 45_000],
    ["30m", 1_800_000],
    ["2h", 7_200_000],
    ["1d", 86_400_000],
  ])("parses %s", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it("rejects a missing unit", () => {
    expect(() => parseDuration("30")).toThrow(CliUsageError);
  });

  it("rejects an unknown unit", () => {
    expect(() => parseDuration("30w")).toThrow(/Use a number followed by s, m, h or d/);
  });
});

describe("windowFromSince", () => {
  it("ends now and starts one duration earlier", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:00:00Z"));
    const window = windowFromSince("30m", "10m");
    expect(window.endMillis - window.startMillis).toBe(1_800_000);
    expect(window.endMillis).toBe(Date.now());
  });

  it("falls back to the default when --since is absent", () => {
    const window = windowFromSince(undefined, "10m");
    expect(window.endMillis - window.startMillis).toBe(600_000);
  });

  it("dates the window by its end, matching the operations' own default", () => {
    const window = windowFromSince("1h", "10m");
    expect(window.date).toBe(millisToYmd(window.endMillis));
  });

  it("keeps today's partition when the window crosses midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T00:30:00"));
    const window = windowFromSince("2h", "10m");
    expect(window.date).toBe("20260304");
  });

  it("produces operation input the time parser understands", () => {
    const input = toOperationTimeInput(windowFromSince("10m", "10m"));
    expect(input.date).toMatch(/^\d{8}$/);
    expect(input.start_time).toMatch(/^\d{13,}$/);
    expect(input.end_time).toMatch(/^\d{13,}$/);
  });
});

describe("durationMinutes", () => {
  it("converts to whole minutes", () => {
    expect(durationMinutes("30m", "10m")).toBe(30);
  });

  it("rounds a partial minute up", () => {
    expect(durationMinutes("90s", "10m")).toBe(2);
  });

  it("never returns less than one minute", () => {
    expect(durationMinutes("1s", "10m")).toBe(1);
  });
});

describe("parseLimit", () => {
  it("returns the fallback when absent", () => {
    expect(parseLimit(undefined, 50)).toBe(50);
  });

  it("parses a positive integer", () => {
    expect(parseLimit("20", 50)).toBe(20);
  });

  it.each(["0", "-1", "abc", "1.5"])("rejects %s", value => {
    expect(() => parseLimit(value, 50)).toThrow(CliUsageError);
  });

  it("names the caller's option in its error", () => {
    expect(() => parseLimit("0", 80, "--max-steps")).toThrow(/--max-steps/);
  });
});
