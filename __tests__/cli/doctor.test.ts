import { describe, it, expect, vi } from "vitest";
import { doctorCommand } from "../../cli/doctor.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "../../cli/output.js";
import { runCli } from "../../cli/index.js";
import { createMockClient } from "../operations/mock-client.js";
import { captureIo, stubDeps } from "./helpers.js";

describe("doctor", () => {
  it("reports the selected protocol and endpoint", async () => {
    const io = captureIo();
    const code = await doctorCommand([], io, stubDeps());
    expect(code).toBe(EXIT_OK);
    expect(io.stdoutText()).toContain("protocol   http");
    expect(io.stdoutText()).toContain("http://scouter.example:6180");
  });

  it("says TCP when TCP is configured", async () => {
    const io = captureIo();
    await doctorCommand([], io, stubDeps({
      connection: { protocol: "tcp", endpoint: "scouter.internal:6100" },
    }));
    expect(io.stdoutText()).toContain("protocol   tcp");
    expect(io.stdoutText()).toContain("scouter.internal:6100");
  });

  it("never prints the password, only whether one is set", async () => {
    process.env.SCOUTER_API_PASSWORD = "super-secret";
    try {
      const io = captureIo();
      await doctorCommand([], io, stubDeps());
      expect(io.stdoutText()).toContain("password   set");
      expect(io.stdoutText()).not.toContain("super-secret");
    } finally {
      delete process.env.SCOUTER_API_PASSWORD;
    }
  });

  it("warns when no endpoint env var is set", async () => {
    const io = captureIo();
    const code = await doctorCommand([], io, stubDeps({ connection: { endpointConfigured: false } }));
    expect(io.stdoutText()).toContain("warn  endpoint");
    expect(io.stdoutText()).toContain("SCOUTER_API_URL is not set");
    expect(code).toBe(EXIT_OK);
  });

  it("warns when credentials are missing", async () => {
    const io = captureIo();
    await doctorCommand([], io, stubDeps({ connection: { apiId: "", authConfigured: false } }));
    expect(io.stdoutText()).toContain("SCOUTER_API_ID is not set");
  });

  it("verifies the connection and reports agent counts", async () => {
    const io = captureIo();
    await doctorCommand([], io, stubDeps());
    expect(io.stdoutText()).toContain("3 object(s), 2 alive");
  });

  it("exits non-zero when the connection fails", async () => {
    const io = captureIo();
    const client = createMockClient({
      getObjects: vi.fn().mockRejectedValue(new Error("401 Unauthorized")),
    } as never);
    const code = await doctorCommand([], io, stubDeps({ client }));
    expect(code).toBe(EXIT_FAILURE);
    expect(io.stdoutText()).toContain("fail  connection");
    expect(io.stdoutText()).toContain("401 Unauthorized");
    expect(io.stdoutText()).toContain("doctor: failed");
  });

  it("closes the client even when the connection fails", async () => {
    const client = createMockClient({ getObjects: vi.fn().mockRejectedValue(new Error("nope")) } as never);
    const deps = stubDeps({ client });
    await doctorCommand([], captureIo(), deps);
    expect(deps.closed()).toBe(1);
  });

  it("emits JSON with --json", async () => {
    const io = captureIo();
    const code = await doctorCommand(["--json"], io, stubDeps());
    const report = JSON.parse(io.stdoutText());
    expect(code).toBe(EXIT_OK);
    expect(report.ok).toBe(true);
    expect(report.protocol).toBe("http");
    expect(report.apiPassword).toBe("set");
    expect(report.checks.map((c: { name: string }) => c.name)).toContain("connection");
  });

  it("reports ok:false in JSON when a check fails", async () => {
    const io = captureIo();
    const client = createMockClient({ getObjects: vi.fn().mockRejectedValue(new Error("down")) } as never);
    await doctorCommand(["--json"], io, stubDeps({ client }));
    expect(JSON.parse(io.stdoutText()).ok).toBe(false);
  });

  it("rejects stray arguments", async () => {
    const io = captureIo();
    const code = await runCli(["doctor", "extra"], io, stubDeps());
    expect(code).toBe(EXIT_USAGE);
    expect(io.stderrText()).toContain("takes no arguments");
    expect(io.out).toHaveLength(0);
  });
});
