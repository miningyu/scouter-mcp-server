import { describe, it, expect } from "vitest";
import { CliUsageError, flag, parseArgs, stringOption } from "../../cli/args.js";

const SPEC = { input: "string", json: "boolean", output: "string" } as const;

describe("parseArgs", () => {
  it("collects positionals", () => {
    expect(parseArgs(["run", "get_system_overview"], SPEC).positionals)
      .toEqual(["run", "get_system_overview"]);
  });

  it("reads a space-separated option value", () => {
    expect(parseArgs(["--input", "{}"], SPEC).options.input).toBe("{}");
  });

  it("reads an =-separated option value", () => {
    expect(parseArgs(["--input={\"a\":1}"], SPEC).options.input).toBe('{"a":1}');
  });

  it("reads a boolean flag", () => {
    expect(parseArgs(["--json"], SPEC).options.json).toBe(true);
  });

  it("keeps a value that looks like an option", () => {
    expect(parseArgs(["--input", "--json"], SPEC).options.input).toBe("--json");
  });

  it("treats everything after -- as positional", () => {
    expect(parseArgs(["--", "--json"], SPEC).positionals).toEqual(["--json"]);
  });

  it("rejects an unknown option", () => {
    expect(() => parseArgs(["--nope"], SPEC)).toThrow(CliUsageError);
  });

  it("names the known options when rejecting", () => {
    expect(() => parseArgs(["--nope"], SPEC)).toThrow(/--input, --json, --output/);
  });

  it("rejects an option missing its value", () => {
    expect(() => parseArgs(["--input"], SPEC)).toThrow(/requires a value/);
  });

  it("rejects a value given to a flag", () => {
    expect(() => parseArgs(["--json=yes"], SPEC)).toThrow(/takes no value/);
  });

  it("reads options from anywhere in the argv", () => {
    const parsed = parseArgs(["get_system_overview", "--json", "extra"], SPEC);
    expect(parsed.positionals).toEqual(["get_system_overview", "extra"]);
    expect(flag(parsed, "json")).toBe(true);
  });

  it("returns undefined for an absent string option", () => {
    expect(stringOption(parseArgs([], SPEC), "input")).toBeUndefined();
  });

  it("returns false for an absent flag", () => {
    expect(flag(parseArgs([], SPEC), "json")).toBe(false);
  });
});
