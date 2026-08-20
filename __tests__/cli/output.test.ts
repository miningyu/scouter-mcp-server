import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitResult, summarize, toJson } from "../../cli/output.js";
import { captureIo } from "./helpers.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scouter-cli-"));
  created.push(dir);
  return dir;
}

describe("toJson", () => {
  it("pretty-prints", () => {
    expect(toJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("stringifies BigInt", () => {
    expect(toJson({ big: 1n })).toContain('"1"');
  });
});

describe("summarize", () => {
  it("describes an array", () => {
    expect(summarize([1, 2, 3])).toEqual({ type: "array", length: 3 });
  });

  it("describes an object's top-level keys", () => {
    expect(summarize({ a: [1, 2], b: "x", c: null })).toEqual({
      type: "object",
      keys: { a: "array(2)", b: "string", c: "null" },
    });
  });

  it("describes a scalar", () => {
    expect(summarize(42)).toEqual({ type: "number" });
  });
});

describe("emitResult", () => {
  it("prints the result to stdout by default", async () => {
    const io = captureIo();
    await emitResult(io, { a: 1 });
    expect(JSON.parse(io.stdoutText())).toEqual({ a: 1 });
    expect(io.err).toHaveLength(0);
  });

  it("writes the result to a file when asked", async () => {
    const io = captureIo();
    const path = join(await tempDir(), "result.json");
    await emitResult(io, { transactions: [1, 2], total: 2 }, { outputFile: path });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ transactions: [1, 2], total: 2 });
  });

  it("prints only the path and a summary when writing to a file", async () => {
    const io = captureIo();
    const path = join(await tempDir(), "result.json");
    await emitResult(io, { transactions: [1, 2], total: 2 }, { outputFile: path });
    const printed = JSON.parse(io.stdoutText());
    expect(printed.savedTo).toBe(path);
    expect(printed.bytes).toBeGreaterThan(0);
    expect(printed.summary).toEqual({ type: "object", keys: { transactions: "array(2)", total: "number" } });
    expect(io.stdoutText()).not.toContain("\"total\": 2");
  });
});
