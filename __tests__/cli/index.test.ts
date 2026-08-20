import { describe, it, expect } from "vitest";
import { runCli } from "../../cli/index.js";
import { EXIT_OK, EXIT_USAGE } from "../../cli/output.js";
import { captureIo, stubDeps } from "./helpers.js";

describe("runCli", () => {
  it("prints help when given no arguments", async () => {
    const io = captureIo();
    expect(await runCli([], io, stubDeps())).toBe(EXIT_OK);
    expect(io.stdoutText()).toContain("scouter-mcp-server");
    expect(io.stdoutText()).toContain("tools run");
  });

  it("prints help for --help", async () => {
    const io = captureIo();
    expect(await runCli(["--help"], io, stubDeps())).toBe(EXIT_OK);
    expect(io.stdoutText()).toContain("Exit codes");
  });

  it("documents the environment variables without any values", async () => {
    const io = captureIo();
    await runCli(["--help"], io, stubDeps());
    expect(io.stdoutText()).toContain("SCOUTER_API_PASSWORD");
    expect(io.stdoutText()).toContain("SCOUTER_ENABLE_WRITE=true");
  });

  it("prints the package version", async () => {
    const io = captureIo();
    expect(await runCli(["--version"], io, stubDeps())).toBe(EXIT_OK);
    expect(io.stdoutText()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("rejects an unknown command on stderr", async () => {
    const io = captureIo();
    expect(await runCli(["frobnicate"], io, stubDeps())).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("Unknown command 'frobnicate'");
    expect(io.out).toHaveLength(0);
  });
});
