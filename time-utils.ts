export function now(): number {
  return Date.now();
}

export function minutesAgo(minutes: number): number {
  return now() - minutes * 60 * 1000;
}

export function todayYmd(): string {
  return formatYmd(new Date());
}

export function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function formatYmdHms(date: Date): string {
  const ymd = formatYmd(date);
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${ymd}${h}${min}${s}`;
}

export function parseTimeToMillis(input: string | undefined, fallback: number, dateContext?: string): number {
  if (!input) return fallback;

  if (/^\d{13,}$/.test(input)) return Number(input);

  const parsed = Date.parse(input);
  if (!isNaN(parsed)) return parsed;

  if (/^\d{6}$/.test(input)) {
    const ymd = dateContext && /^\d{8}$/.test(dateContext) ? dateContext : todayYmd();
    return Date.parse(
      `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${input.slice(0, 2)}:${input.slice(2, 4)}:${input.slice(4, 6)}`
    );
  }

  return fallback;
}

export function millisToYmdHms(millis: number): string {
  return formatYmdHms(new Date(millis));
}

export function millisToYmd(millis: number): string {
  return formatYmd(new Date(millis));
}

export function millisToIso(millis: number): string {
  return new Date(millis).toISOString();
}
