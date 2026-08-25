import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../cli/index.js";
import { EXIT_OK, EXIT_USAGE } from "../../cli/output.js";
import { createMockClient } from "../operations/mock-client.js";
import { captureIo, stubDeps } from "./helpers.js";

describe("overview", () => {
  it("runs get_system_overview and prints a summary", async () => {
    const io = captureIo();
    expect(await runCli(["overview"], io, stubDeps())).toBe(EXIT_OK);
    expect(io.stdoutText()).toContain("agents      2 alive, 1 dead");
    expect(io.stdoutText()).toContain("/dead/agent");
  });

  it("prints the raw operation result with --json", async () => {
    const io = captureIo();
    await runCli(["overview", "--json"], io, stubDeps());
    expect(JSON.parse(io.stdoutText()).agents.aliveCount).toBe(2);
  });

  it("narrows to one object type", async () => {
    const client = createMockClient();
    const io = captureIo();
    await runCli(["overview", "--obj-type", "redis", "--json"], io, stubDeps({ client }));
    expect(Object.keys(JSON.parse(io.stdoutText()).countersByType)).toEqual(["redis"]);
  });
});

describe("diagnose", () => {
  it("converts --since into time_range_minutes", async () => {
    const client = createMockClient();
    const io = captureIo();
    await runCli(["diagnose", "--since", "30m", "--json"], io, stubDeps({ client }));
    expect(JSON.parse(io.stdoutText()).timeRangeMinutes).toBe(30);
  });

  it("defaults to the last 10 minutes", async () => {
    const io = captureIo();
    await runCli(["diagnose", "--json"], io, stubDeps());
    expect(JSON.parse(io.stdoutText()).timeRangeMinutes).toBe(10);
  });

  it("prints a findings summary by default", async () => {
    const io = captureIo();
    expect(await runCli(["diagnose"], io, stubDeps())).toBe(EXIT_OK);
    expect(io.stdoutText()).toContain("findings");
    expect(io.stdoutText()).toContain("CRITICAL");
  });

  it("rejects an invalid --since", async () => {
    const io = captureIo();
    expect(await runCli(["diagnose", "--since", "soon"], io, stubDeps())).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("Invalid duration");
  });

  it("warns when --since exceeds the operation's 60-minute cap", async () => {
    const io = captureIo();
    await runCli(["diagnose", "--since", "6h", "--json"], io, stubDeps());
    expect(io.stderrText()).toContain("at most 60 minutes");
    expect(JSON.parse(io.stdoutText()).timeRangeMinutes).toBe(60);
  });
});

describe("transactions search", () => {
  it("passes the time window to search_transactions", async () => {
    const getXLogData = vi.fn().mockResolvedValue([]);
    const client = createMockClient({ getXLogData } as never);
    const io = captureIo();
    await runCli(["transactions", "search", "--since", "10m", "--json"], io, stubDeps({ client }));
    const [, startMillis, endMillis] = getXLogData.mock.calls[0];
    expect(endMillis - startMillis).toBe(600_000);
  });

  it("maps --limit onto max_count", async () => {
    const io = captureIo();
    await runCli(["transactions", "search", "--limit", "1", "--json"], io, stubDeps());
    expect(JSON.parse(io.stdoutText()).returned).toBe(1);
  });

  it("passes --service through as a filter", async () => {
    const searchXLogData = vi.fn().mockResolvedValue([]);
    const client = createMockClient({ searchXLogData } as never);
    const io = captureIo();
    await runCli(["transactions", "search", "--service", "/api/users", "--json"], io, stubDeps({ client }));
    expect(searchXLogData.mock.calls[0][1].service).toBe("/api/users");
  });

  it("defaults --limit to 20, matching the skill's guidance", async () => {
    const getXLogData = vi.fn().mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ txid: `t${i}`, elapsed: i, service: 0, error: 0 })),
    );
    const io = captureIo();
    await runCli(["transactions", "search", "--json"], io, stubDeps({ client: createMockClient({ getXLogData } as never) }));
    expect(JSON.parse(io.stdoutText()).returned).toBe(20);
  });

  it("surfaces operation warnings on stderr instead of hiding them behind a clean summary", async () => {
    const getXLogData = vi.fn().mockRejectedValue(new Error("HTTP 500"));
    const io = captureIo();
    const code = await runCli(["transactions", "search"], io, stubDeps({ client: createMockClient({ getXLogData } as never) }));
    expect(code).toBe(EXIT_OK);
    expect(io.stderrText()).toContain("HTTP 500");
  });

  it("prints the slowest transactions by default", async () => {
    const io = captureIo();
    expect(await runCli(["transactions", "search"], io, stubDeps())).toBe(EXIT_OK);
    expect(io.stdoutText()).toContain("found       2");
    expect(io.stdoutText()).toContain("tx1");
  });

  it("rejects a stray argument", async () => {
    const io = captureIo();
    expect(await runCli(["transactions", "search", "oops"], io, stubDeps())).toBe(EXIT_USAGE);
  });
});

describe("transactions get", () => {
  it("looks up the transaction by id", async () => {
    const getXLogDetail = vi.fn().mockResolvedValue({ txid: "tx1", elapsed: 5000, service: 123 });
    const client = createMockClient({ getXLogDetail, getProfileData: vi.fn().mockResolvedValue([]) } as never);
    const io = captureIo();
    expect(await runCli(["transactions", "get", "tx1"], io, stubDeps({ client }))).toBe(EXIT_OK);
    expect(getXLogDetail.mock.calls[0][1]).toBe("tx1");
    expect(io.stdoutText()).toContain("service     /api/users");
    expect(io.stdoutText()).toContain("elapsed     5000ms");
  });

  it("needs a transaction id", async () => {
    const io = captureIo();
    expect(await runCli(["transactions", "get"], io, stubDeps())).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("needs a transaction id");
  });

  it("accepts an explicit --date", async () => {
    const getXLogDetail = vi.fn().mockResolvedValue(null);
    const client = createMockClient({ getXLogDetail, getProfileData: vi.fn().mockResolvedValue([]) } as never);
    const io = captureIo();
    await runCli(["transactions", "get", "tx1", "--date", "20260101", "--json"], io, stubDeps({ client }));
    expect(getXLogDetail.mock.calls[0][0]).toBe("20260101");
  });
});

describe("transactions dispatch", () => {
  it("rejects a missing subcommand", async () => {
    const io = captureIo();
    expect(await runCli(["transactions"], io, stubDeps())).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("search or get");
  });

  it("rejects an unknown subcommand", async () => {
    const io = captureIo();
    expect(await runCli(["transactions", "delete"], io, stubDeps())).toBe(EXIT_USAGE);
  });
});

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("shortcuts reuse the registry", () => {
  it("writes a shortcut result to --output like tools run does", async () => {
    const io = captureIo();
    const dir = await mkdtemp(join(tmpdir(), "scouter-shortcut-"));
    tempDirs.push(dir);
    const path = join(dir, "overview.json");
    expect(await runCli(["overview", "--output", path], io, stubDeps())).toBe(EXIT_OK);
    expect(JSON.parse(io.stdoutText()).savedTo).toBe(path);
  });

  it("closes the client after a shortcut", async () => {
    const deps = stubDeps();
    await runCli(["overview"], captureIo(), deps);
    expect(deps.closed()).toBe(1);
  });
});
