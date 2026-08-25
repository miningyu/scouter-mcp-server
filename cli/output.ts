import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const EXIT_OK = 0;
/** Something went wrong while talking to Scouter, or an unexpected failure. */
export const EXIT_FAILURE = 1;
/** The command line or the operation input was wrong. */
export const EXIT_USAGE = 2;
/** The operation is not allowed in this environment. */
export const EXIT_FORBIDDEN = 3;

export interface CliIo {
  /** Command results only. */
  stdout(text: string): void;
  /** Logs, diagnostics and error explanations. */
  stderr(text: string): void;
}

export const processIo: CliIo = {
  stdout: text => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
  stderr: text => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
};

/** Stable, sorted-key-free JSON so repeated runs diff cleanly. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

/** A compact description of a result, used when the body went to a file instead. */
export function summarize(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (value === null || typeof value !== "object") return { type: typeof value };
  const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    Array.isArray(item) ? `array(${item.length})` : item === null ? "null" : typeof item,
  ]);
  return { type: "object", keys: Object.fromEntries(entries) };
}

export interface EmitOptions {
  outputFile?: string;
}

/** Writes a result to stdout, or to a file with only its path and a summary on stdout. */
export async function emitResult(io: CliIo, result: unknown, options: EmitOptions = {}): Promise<void> {
  const json = toJson(result);
  if (!options.outputFile) {
    io.stdout(json);
    return;
  }
  const path = resolve(options.outputFile);
  await writeFile(path, `${json}\n`, "utf8");
  io.stdout(toJson({ savedTo: path, bytes: Buffer.byteLength(json, "utf8"), summary: summarize(result) }));
}
