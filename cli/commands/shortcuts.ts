import { getOperation } from "../../operations/registry.js";
import type { AnyOperation } from "../../operations/definition.js";
import { CliUsageError, flag, parseArgs, stringOption, type ParsedArgs } from "../args.js";
import type { CliDependencies } from "../deps.js";
import { EXIT_OK, type CliIo } from "../output.js";
import { durationMinutes, parseLimit, toOperationTimeInput, windowFromSince } from "../time-args.js";
import { executeOperation } from "./tools.js";

/**
 * Convenience wrappers over the most common investigation steps. They only translate
 * command-line arguments into operation input — the query itself always comes from
 * the registry, never from a second implementation here.
 */

const COMMON_OPTIONS = { json: "boolean", output: "string", yes: "boolean" } as const;

function operationOrThrow(name: string): AnyOperation {
  const operation = getOperation(name);
  if (!operation) throw new CliUsageError(`Operation '${name}' is missing from the registry.`);
  return operation;
}

async function runShortcut(
  operationName: string,
  input: Record<string, unknown>,
  args: ParsedArgs,
  io: CliIo,
  deps: CliDependencies,
  summarize: (result: any) => string,
): Promise<number> {
  const operation = operationOrThrow(operationName);
  if (flag(args, "json") || stringOption(args, "output")) {
    return executeOperation(operation, input, args, io, deps);
  }

  const collected: string[] = [];
  const collectingIo: CliIo = { stdout: text => collected.push(text), stderr: io.stderr };
  const code = await executeOperation(operation, input, args, collectingIo, deps);
  if (code !== EXIT_OK) return code;
  const result = JSON.parse(collected.join("\n"));
  // partial failures land in warnings — a summary must not present them as clean zeros
  if (Array.isArray(result?.warnings)) {
    for (const warning of result.warnings) io.stderr(`warning: ${warning}`);
  }
  io.stdout(summarize(result));
  return EXIT_OK;
}

export function overviewCommand(argv: string[], io: CliIo, deps: CliDependencies): Promise<number> {
  const args = parseArgs(argv, { ...COMMON_OPTIONS, "obj-type": "string" });
  const objType = stringOption(args, "obj-type");
  const input = objType ? { obj_type: objType } : {};

  return runShortcut("get_system_overview", input, args, io, deps, result => {
    const alerts = (result.recentAlerts?.alerts ?? []).length;
    const lines = [
      `agents      ${result.agents.aliveCount} alive, ${result.agents.deadCount} dead`,
      `types       ${Object.keys(result.countersByType).join(", ") || "(none)"}`,
      `alerts      ${alerts}`,
    ];
    for (const agent of result.agents.dead ?? []) lines.push(`  down      ${agent.objName} (${agent.objType})`);
    lines.push("", "Run with --json for the full snapshot.");
    return lines.join("\n");
  });
}

export function diagnoseCommand(argv: string[], io: CliIo, deps: CliDependencies): Promise<number> {
  const args = parseArgs(argv, { ...COMMON_OPTIONS, since: "string", "obj-type": "string" });
  const objType = stringOption(args, "obj-type");
  const minutes = durationMinutes(stringOption(args, "since"), "10m");
  if (minutes > 60) {
    io.stderr(`warning: diagnose analyzes at most 60 minutes; --since was clamped from ${minutes}m to 60m`);
  }
  const input: Record<string, unknown> = {
    time_range_minutes: Math.min(minutes, 60),
  };
  if (objType) input.obj_type = objType;

  return runShortcut("diagnose_performance", input, args, io, deps, result => {
    const findings = result.findings ?? [];
    const bySeverity = findings.reduce((acc: Record<string, number>, f: { severity: string }) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    }, {});
    const lines = [
      `range       last ${result.timeRangeMinutes} minute(s)`,
      `findings    ${findings.length} (${Object.entries(bySeverity).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"})`,
      "",
      ...findings.slice(0, 5).map((f: { severity: string; title: string }) => `  ${f.severity.padEnd(8)} ${f.title}`),
      "",
      "Run with --json for full findings and suggested actions.",
    ];
    return lines.join("\n");
  });
}

function transactionsSearch(argv: string[], io: CliIo, deps: CliDependencies): Promise<number> {
  const args = parseArgs(argv, {
    ...COMMON_OPTIONS,
    since: "string", limit: "string", service: "string", ip: "string", login: "string", "obj-hashes": "string",
  });
  if (args.positionals.length > 0) {
    throw new CliUsageError(`Unexpected argument '${args.positionals[0]}' for 'transactions search'.`);
  }

  const input: Record<string, unknown> = {
    ...toOperationTimeInput(windowFromSince(stringOption(args, "since"), "10m")),
    max_count: parseLimit(stringOption(args, "limit"), 20),
  };
  for (const [option, field] of [["service", "service"], ["ip", "ip"], ["login", "login"], ["obj-hashes", "obj_hashes"]] as const) {
    const value = stringOption(args, option);
    if (value) input[field] = value;
  }

  return runShortcut("search_transactions", input, args, io, deps, result => {
    const lines = [
      `range       ${result.searchRange.startTime} .. ${result.searchRange.endTime}`,
      `found       ${result.totalFound} (showing ${result.returned})`,
      `errors      ${result.statistics.errorCount}`,
      `elapsed     avg ${result.statistics.avgElapsed}ms, p90 ${result.statistics.p90Elapsed}ms, max ${result.statistics.maxElapsed}ms`,
      "",
      ...result.transactions.slice(0, 10).map((t: Record<string, unknown>) =>
        `  ${String(t.elapsed).padStart(7)}ms  ${t.txid}  ${t.serviceName ?? ""}${t.errorMessage ? `  ! ${t.errorMessage}` : ""}`),
      "",
      "Inspect one with: scouter-mcp-server transactions get <txid> --json",
    ];
    return lines.join("\n");
  });
}

function transactionsGet(argv: string[], io: CliIo, deps: CliDependencies): Promise<number> {
  const args = parseArgs(argv, { ...COMMON_OPTIONS, date: "string", "max-steps": "string" });
  const txid = args.positionals[0];
  if (!txid) throw new CliUsageError("'transactions get' needs a transaction id.");
  if (args.positionals.length > 1) {
    throw new CliUsageError(`Unexpected argument '${args.positionals[1]}' for 'transactions get'.`);
  }

  const input: Record<string, unknown> = { txid };
  const date = stringOption(args, "date");
  if (date) input.date = date;
  const maxSteps = stringOption(args, "max-steps");
  if (maxSteps) input.max_steps = parseLimit(maxSteps, 80, "--max-steps");

  return runShortcut("get_transaction_detail", input, args, io, deps, result => {
    const tx = result.transaction ?? {};
    const profile = result.profile ?? {};
    const lines = [
      `txid        ${txid}`,
      `service     ${tx.serviceName ?? "(unknown)"}`,
      `elapsed     ${tx.elapsed ?? "?"}ms`,
      ...(tx.errorMessage ? [`error       ${tx.errorMessage}`] : []),
      `steps       ${profile.returnedSteps ?? 0} of ${profile.totalSteps ?? 0}`,
      `sql         ${profile.sqlSummary?.totalCount ?? 0} statement(s), ${profile.sqlSummary?.totalElapsed ?? 0}ms`,
      `api calls   ${profile.apiCallSummary?.totalCount ?? 0}`,
      "",
      "Run with --json for the full profile, or --output <file> for a large one.",
    ];
    return lines.join("\n");
  });
}

export function transactionsCommand(argv: string[], io: CliIo, deps: CliDependencies): Promise<number> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case "search": return transactionsSearch(rest, io, deps);
    case "get": return transactionsGet(rest, io, deps);
    case undefined:
      throw new CliUsageError("'transactions' needs a subcommand: search or get.");
    default:
      throw new CliUsageError(`Unknown 'transactions' subcommand '${subcommand}'. Use search or get.`);
  }
}
