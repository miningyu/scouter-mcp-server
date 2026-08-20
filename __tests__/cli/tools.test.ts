import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../cli/index.js";
import { EXIT_FAILURE, EXIT_FORBIDDEN, EXIT_OK, EXIT_USAGE } from "../../cli/output.js";
import { createMockClient } from "../operations/mock-client.js";
import { captureIo, stubDeps } from "./helpers.js";

let originalWrite: string | undefined;
const tempDirs: string[] = [];

beforeEach(() => {
  originalWrite = process.env.SCOUTER_ENABLE_WRITE;
  delete process.env.SCOUTER_ENABLE_WRITE;
});

afterEach(async () => {
  if (originalWrite === undefined) delete process.env.SCOUTER_ENABLE_WRITE;
  else process.env.SCOUTER_ENABLE_WRITE = originalWrite;
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scouter-cli-tools-"));
  tempDirs.push(dir);
  return dir;
}

describe("tools list", () => {
  it("lists only read-only operations when write is disabled", async () => {
    const io = captureIo();
    const code = await runCli(["tools", "list", "--json"], io, stubDeps());
    const payload = JSON.parse(io.stdoutText());
    expect(code).toBe(EXIT_OK);
    expect(payload.count).toBe(25);
    expect(payload.writeEnabled).toBe(false);
    expect(payload.operations.every((o: { readOnly: boolean }) => o.readOnly)).toBe(true);
  });

  it("lists all 31 operations when write is enabled", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const io = captureIo();
    await runCli(["tools", "list", "--json"], io, stubDeps());
    expect(JSON.parse(io.stdoutText()).count).toBe(31);
  });

  it("can show unrunnable operations with --all", async () => {
    const io = captureIo();
    await runCli(["tools", "list", "--json", "--all"], io, stubDeps());
    const payload = JSON.parse(io.stdoutText());
    expect(payload.count).toBe(31);
    expect(payload.operations.find((o: { name: string }) => o.name === "control_thread").runnable).toBe(false);
  });

  it("prints a readable table without --json", async () => {
    const io = captureIo();
    await runCli(["tools", "list"], io, stubDeps());
    expect(io.stdoutText()).toContain("get_system_overview");
    expect(io.stdoutText()).toContain("SCOUTER_ENABLE_WRITE=true");
  });

  it("never opens a client just to list", async () => {
    const deps = stubDeps();
    const createClient = vi.spyOn(deps, "createClient");
    await runCli(["tools", "list"], captureIo(), deps);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("tools describe", () => {
  it("describes input fields with type, requiredness and defaults", async () => {
    const io = captureIo();
    const code = await runCli(["tools", "describe", "search_transactions", "--json"], io, stubDeps());
    const payload = JSON.parse(io.stdoutText());
    expect(code).toBe(EXIT_OK);
    const maxCount = payload.input.find((f: { name: string }) => f.name === "max_count");
    expect(maxCount).toMatchObject({ type: "number", required: false, default: 50 });
    expect(maxCount.description).toBeTruthy();
  });

  it("marks a required field as required", async () => {
    const io = captureIo();
    await runCli(["tools", "describe", "lookup_text", "--json"], io, stubDeps());
    const payload = JSON.parse(io.stdoutText());
    expect(payload.input.find((f: { name: string }) => f.name === "hashes").required).toBe(true);
  });

  it("lists enum values", async () => {
    const io = captureIo();
    await runCli(["tools", "describe", "lookup_text", "--json"], io, stubDeps());
    const payload = JSON.parse(io.stdoutText());
    expect(payload.input.find((f: { name: string }) => f.name === "type").values).toContain("sql");
  });

  it("reports read-only, destructive and idempotent metadata", async () => {
    const io = captureIo();
    await runCli(["tools", "describe", "control_thread", "--json"], io, stubDeps());
    const payload = JSON.parse(io.stdoutText());
    expect(payload.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(payload.access).toContain("destructive");
    expect(payload.runnable).toBe(false);
  });

  it("rejects an unknown operation", async () => {
    const io = captureIo();
    const code = await runCli(["tools", "describe", "no_such_tool"], io, stubDeps());
    expect(code).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("Unknown operation 'no_such_tool'");
    expect(io.out).toHaveLength(0);
  });

  it("asks for an operation name when none is given", async () => {
    const io = captureIo();
    expect(await runCli(["tools", "describe"], io, stubDeps())).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("needs an operation name");
  });
});

describe("tools run", () => {
  it("runs an operation and prints its result as JSON", async () => {
    const io = captureIo();
    const code = await runCli(["tools", "run", "get_system_overview"], io, stubDeps());
    const result = JSON.parse(io.stdoutText());
    expect(code).toBe(EXIT_OK);
    expect(result.agents.aliveCount).toBe(2);
    expect(io.err).toHaveLength(0);
  });

  it("passes --input through to the operation", async () => {
    const io = captureIo();
    await runCli(["tools", "run", "search_transactions", "--input", '{"max_count":1}'], io, stubDeps());
    const result = JSON.parse(io.stdoutText());
    expect(result.returned).toBe(1);
  });

  it("rejects malformed --input JSON", async () => {
    const io = captureIo();
    const code = await runCli(["tools", "run", "get_system_overview", "--input", "{oops"], io, stubDeps());
    expect(code).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("not valid JSON");
    expect(io.out).toHaveLength(0);
  });

  it("rejects input that fails schema validation", async () => {
    const io = captureIo();
    const code = await runCli(["tools", "run", "search_transactions", "--input", '{"max_count":"lots"}'], io, stubDeps());
    expect(code).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("max_count");
    expect(io.out).toHaveLength(0);
  });

  it("rejects an unknown operation", async () => {
    const io = captureIo();
    expect(await runCli(["tools", "run", "nope"], io, stubDeps())).toBe(EXIT_USAGE);
  });

  it("rejects a stray positional argument", async () => {
    const io = captureIo();
    const code = await runCli(["tools", "run", "get_system_overview", "{}"], io, stubDeps());
    expect(code).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("--input");
  });

  it("reports a connection failure on stderr with a non-zero exit code", async () => {
    const io = captureIo();
    const client = createMockClient({ getObjects: vi.fn().mockRejectedValue(new Error("401 Unauthorized")) } as never);
    const code = await runCli(["tools", "run", "get_system_overview"], io, stubDeps({ client }));
    expect(code).toBe(EXIT_FAILURE);
    expect(io.stderrText()).toContain("401 Unauthorized");
    expect(io.out).toHaveLength(0);
  });

  it("closes the client after a successful run", async () => {
    const deps = stubDeps();
    await runCli(["tools", "run", "get_system_overview"], captureIo(), deps);
    expect(deps.closed()).toBe(1);
  });

  it("closes the client after a failed run", async () => {
    const client = createMockClient({ getObjects: vi.fn().mockRejectedValue(new Error("down")) } as never);
    const deps = stubDeps({ client });
    await runCli(["tools", "run", "get_system_overview"], captureIo(), deps);
    expect(deps.closed()).toBe(1);
  });

  it("writes a large result to --output and prints only the path and summary", async () => {
    const io = captureIo();
    const path = join(await tempDir(), "overview.json");
    const code = await runCli(["tools", "run", "get_system_overview", "--output", path], io, stubDeps());
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(await readFile(path, "utf8")).agents.aliveCount).toBe(2);
    const printed = JSON.parse(io.stdoutText());
    expect(printed.savedTo).toBe(path);
    expect(printed.summary.keys.agents).toBe("object");
  });
});

describe("write safety", () => {
  it("refuses a write operation when SCOUTER_ENABLE_WRITE is unset", async () => {
    const io = captureIo();
    const code = await runCli(
      ["tools", "run", "set_configure", "--input", '{"target":"server","values":"a=b"}'],
      io, stubDeps(),
    );
    expect(code).toBe(EXIT_FORBIDDEN);
    expect(io.stderrText()).toContain("SCOUTER_ENABLE_WRITE=true");
    expect(io.out).toHaveLength(0);
  });

  it("allows a write operation once SCOUTER_ENABLE_WRITE=true", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const io = captureIo();
    const code = await runCli(
      ["tools", "run", "set_configure", "--input", '{"target":"server","values":"a=b"}'],
      io, stubDeps(),
    );
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(io.stdoutText()).result).toBe("saved");
  });

  it("refuses a destructive operation without --yes", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const io = captureIo();
    const code = await runCli(
      ["tools", "run", "control_thread", "--input", '{"obj_hash":1,"thread_id":2,"action":"interrupt"}'],
      io, stubDeps(),
    );
    expect(code).toBe(EXIT_FORBIDDEN);
    expect(io.stderrText()).toContain("--yes");
  });

  it("runs a destructive operation with --yes", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const io = captureIo();
    const code = await runCli(
      ["tools", "run", "control_thread", "--yes", "--input", '{"obj_hash":1,"thread_id":2,"action":"interrupt"}'],
      io, stubDeps(),
    );
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(io.stdoutText()).result).toBe("OK");
  });

  it("still refuses a destructive operation with --yes when write is disabled", async () => {
    const io = captureIo();
    const code = await runCli(
      ["tools", "run", "remove_inactive_objects", "--yes", "--input", "{}"],
      io, stubDeps(),
    );
    expect(code).toBe(EXIT_FORBIDDEN);
    expect(io.stderrText()).toContain("SCOUTER_ENABLE_WRITE=true");
  });
});

describe("tools subcommand dispatch", () => {
  it("rejects a missing subcommand", async () => {
    const io = captureIo();
    expect(await runCli(["tools"], io, stubDeps())).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("list, describe or run");
  });

  it("rejects an unknown subcommand", async () => {
    const io = captureIo();
    expect(await runCli(["tools", "frobnicate"], io, stubDeps())).toBe(EXIT_USAGE);
  });
});
