import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { operations } from "../operations/registry.js";

const skillDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "scouter");
const read = (path: string) => readFileSync(join(skillDir, path), "utf8");

const SKILL = read("SKILL.md");
const COMMANDS = read("references/commands.md");
const WORKFLOWS = read("references/diagnosis-workflows.md");
const ALL = [SKILL, COMMANDS, WORKFLOWS].join("\n");

describe("skill packaging", () => {
  it("has frontmatter with a name and a description", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(SKILL);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter![1]).toMatch(/^name: scouter$/m);
    expect(frontmatter![1]).toMatch(/^description: .{40,}$/m);
  });

  it("ships both reference files", () => {
    expect(COMMANDS.length).toBeGreaterThan(500);
    expect(WORKFLOWS.length).toBeGreaterThan(500);
  });
});

describe("skill stays in sync with the CLI", () => {
  const names = new Set(operations.map(op => op.name));

  it("only names operations that exist", () => {
    const referenced = [...ALL.matchAll(/tools (?:run|describe) ([a-z_]+)/g)].map(m => m[1]);
    expect(referenced.length).toBeGreaterThan(5);
    for (const name of referenced) expect(names.has(name), name).toBe(true);
  });

  it("lists every operation somewhere in the reference", () => {
    for (const operation of operations) {
      expect(COMMANDS.includes(operation.name), operation.name).toBe(true);
    }
  });

  it("only names commands the CLI dispatches", () => {
    const dispatched = new Set(["doctor", "tools", "overview", "diagnose", "transactions", "--help", "--version"]);
    const referenced = [...ALL.matchAll(/scouter-mcp-server ([a-z-]+)/g)].map(m => m[1]);
    expect(referenced.length).toBeGreaterThan(10);
    for (const command of referenced) expect(dispatched.has(command), command).toBe(true);
  });
});

describe("skill never leaks credentials", () => {
  it("names environment variables but never a value", () => {
    expect(ALL).toContain("SCOUTER_API_PASSWORD");
    expect(ALL).not.toMatch(/SCOUTER_API_PASSWORD\s*=\s*\S/);
    expect(ALL).not.toMatch(/SCOUTER_API_ID\s*=\s*\S/);
  });

  it("requires user approval before write and destructive operations", () => {
    expect(SKILL).toContain("SCOUTER_ENABLE_WRITE=true");
    expect(SKILL).toMatch(/Never\*{0,2} run a write or destructive operation without asking/);
    expect(SKILL).toContain("--yes");
  });

  it("tells the agent to use --output for large results", () => {
    expect(SKILL).toContain("--output");
  });
});
