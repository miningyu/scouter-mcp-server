import { millisToYmd, now } from "../time-utils.js";
import { CliUsageError } from "./args.js";

const DURATION_RE = /^(\d+)(s|m|h|d)$/;
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parses a relative duration such as 30m, 2h or 1d into milliseconds. */
export function parseDuration(value: string): number {
  const match = DURATION_RE.exec(value.trim());
  if (!match) {
    throw new CliUsageError(`Invalid duration '${value}'. Use a number followed by s, m, h or d — for example 30m.`);
  }
  return Number(match[1]) * UNIT_MS[match[2]];
}

export interface TimeWindow {
  /** YYYYMMDD of the window start, which is how Scouter partitions its data. */
  date: string;
  /** Epoch milliseconds, accepted as-is by the operations' time parsing. */
  startMillis: number;
  endMillis: number;
}

/** Turns --since into the date / start_time / end_time inputs the operations expect. */
export function windowFromSince(since: string | undefined, defaultDuration: string): TimeWindow {
  const duration = parseDuration(since ?? defaultDuration);
  const endMillis = now();
  const startMillis = endMillis - duration;
  return { date: millisToYmd(startMillis), startMillis, endMillis };
}

export function toOperationTimeInput(window: TimeWindow): Record<string, string> {
  return {
    date: window.date,
    start_time: String(window.startMillis),
    end_time: String(window.endMillis),
  };
}

export function durationMinutes(since: string | undefined, defaultDuration: string): number {
  return Math.max(1, Math.ceil(parseDuration(since ?? defaultDuration) / 60_000));
}

export function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliUsageError(`Invalid --limit '${value}'. Use a positive integer.`);
  }
  return parsed;
}
