import { describe, it, expect, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(repoRoot, "dist", "index.js");

/** Drives the built entry point over stdio and returns whatever it wrote. */
function runEntry(args: string[], stdin?: string, timeoutMs = 15_000): Promise<{
  code: number | null; stdout: string; stderr: string;
}> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: repoRoot,
      env: { ...process.env, SCOUTER_API_URL: "http://127.0.0.1:59999" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });

    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });
}

beforeAll(() => {
  if (existsSync(entry)) return;
  const build = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: repoRoot, encoding: "utf8" });
  expect(build.status, build.stderr).toBe(0);
}, 120_000);

describe("stdio MCP entry point", () => {
  it("starts an MCP server when given no arguments", async () => {
    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    const { stdout, stderr } = await runEntry([], `${initialize}\n`);
    const response = JSON.parse(stdout.split("\n").filter(Boolean)[0]);
    expect(response.id).toBe(1);
    expect(response.result.serverInfo.name).toBe("scouter-apm");
    expect(stderr).toContain("Scouter MCP Server running on stdio");
  }, 30_000);

  it("lists its tools over MCP", async () => {
    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ].map(r => JSON.stringify(r)).join("\n");

    const { stdout } = await runEntry([], `${requests}\n`);
    const listResponse = stdout.split("\n").filter(Boolean)
      .map(line => JSON.parse(line))
      .find(msg => msg.id === 2);
    expect(listResponse.result.tools).toHaveLength(25);
    expect(listResponse.result.tools.map((t: { name: string }) => t.name)).toContain("get_system_overview");
  }, 30_000);

  it("writes nothing but JSON-RPC to stdout", async () => {
    const initialize = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    const { stdout } = await runEntry([], `${initialize}\n`);
    for (const line of stdout.split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line), line).not.toThrow();
      expect(JSON.parse(line).jsonrpc).toBe("2.0");
    }
  }, 30_000);
});

describe("CLI entry point", () => {
  it("runs the CLI instead of the server when given arguments", async () => {
    const { code, stdout } = await runEntry(["tools", "list", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).count).toBe(25);
  }, 30_000);

  it("exits non-zero on a usage error and keeps stdout clean", async () => {
    const { code, stdout, stderr } = await runEntry(["tools", "describe", "no_such_tool"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown operation");
  }, 30_000);
});
