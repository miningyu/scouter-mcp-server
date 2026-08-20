import { createOperationContext } from "../../operations/context.js";
import { isWriteEnabled, runOperation } from "../../operations/execute.js";
import { getOperation, listAvailableOperations, operations } from "../../operations/registry.js";
import type { AnyOperation } from "../../operations/definition.js";
import { CliUsageError, flag, parseArgs, stringOption, type ParsedArgs } from "../args.js";
import type { CliDependencies } from "../deps.js";
import { EXIT_OK, emitResult, type CliIo } from "../output.js";
import { describeInputShape } from "../schema-info.js";

function accessLabel(operation: AnyOperation): string {
  const parts = [operation.annotations.readOnlyHint ? "read-only" : "write"];
  if (operation.annotations.destructiveHint) parts.push("destructive");
  parts.push(operation.annotations.idempotentHint ? "idempotent" : "non-idempotent");
  return parts.join(", ");
}

export async function listCommand(argv: string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, { json: "boolean", output: "string", all: "boolean" });
  if (args.positionals.length > 0) {
    throw new CliUsageError(`'tools list' takes no arguments, got '${args.positionals[0]}'.`);
  }

  const writeEnabled = isWriteEnabled();
  const available = flag(args, "all") ? operations : listAvailableOperations(writeEnabled);

  const payload = {
    writeEnabled,
    count: available.length,
    operations: available.map(operation => ({
      name: operation.name,
      title: operation.title,
      readOnly: operation.annotations.readOnlyHint,
      destructive: operation.annotations.destructiveHint,
      idempotent: operation.annotations.idempotentHint,
      runnable: operation.annotations.readOnlyHint || writeEnabled,
    })),
  };

  const outputFile = stringOption(args, "output");
  if (flag(args, "json") || outputFile) {
    await emitResult(io, payload, { outputFile });
    return EXIT_OK;
  }

  const width = Math.max(...available.map(o => o.name.length));
  const lines = [
    `${available.length} operation(s) runnable in this environment`,
    ...(writeEnabled ? [] : ["(write operations hidden — set SCOUTER_ENABLE_WRITE=true to include them)"]),
    "",
    ...available.map(o => `  ${o.name.padEnd(width)}  ${o.title}${o.annotations.destructiveHint ? "  [destructive]" : ""}`),
  ];
  io.stdout(lines.join("\n"));
  return EXIT_OK;
}

function requireOperation(name: string | undefined, command: string): AnyOperation {
  if (!name) throw new CliUsageError(`'${command}' needs an operation name. Run 'scouter-mcp-server tools list'.`);
  const operation = getOperation(name);
  if (!operation) {
    throw new CliUsageError(`Unknown operation '${name}'. Run 'scouter-mcp-server tools list' to see the available ones.`);
  }
  return operation;
}

export async function describeCommand(argv: string[], io: CliIo): Promise<number> {
  const args = parseArgs(argv, { json: "boolean", output: "string" });
  const operation = requireOperation(args.positionals[0], "tools describe");
  const fields = describeInputShape(operation.inputShape);

  const payload = {
    name: operation.name,
    title: operation.title,
    description: operation.description,
    annotations: operation.annotations,
    access: accessLabel(operation),
    runnable: operation.annotations.readOnlyHint || isWriteEnabled(),
    input: fields,
  };

  const outputFile = stringOption(args, "output");
  if (flag(args, "json") || outputFile) {
    await emitResult(io, payload, { outputFile });
    return EXIT_OK;
  }

  const lines = [
    `${operation.name} — ${operation.title}`,
    "",
    operation.description,
    "",
    `Access: ${payload.access}`,
    `Runnable now: ${payload.runnable ? "yes" : "no (set SCOUTER_ENABLE_WRITE=true)"}`,
    "",
    "Input",
  ];
  if (fields.length === 0) {
    lines.push("  (no input fields)");
  } else {
    const width = Math.max(...fields.map(f => f.name.length));
    for (const field of fields) {
      const bits = [field.type];
      if (field.values) bits.push(`one of ${field.values.join("|")}`);
      bits.push(field.required ? "required" : "optional");
      if (field.default !== undefined) bits.push(`default ${JSON.stringify(field.default)}`);
      lines.push(`  ${field.name.padEnd(width)}  ${bits.join(", ")}`);
      if (field.description) lines.push(`  ${" ".repeat(width)}  ${field.description}`);
    }
  }
  io.stdout(lines.join("\n"));
  return EXIT_OK;
}

export function parseInputJson(raw: string | undefined, operationName: string): unknown {
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new CliUsageError(
      `--input for '${operationName}' is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Runs an already-resolved operation. Shared by `tools run` and the shortcut commands. */
export async function executeOperation(
  operation: AnyOperation,
  input: unknown,
  args: ParsedArgs,
  io: CliIo,
  deps: CliDependencies,
): Promise<number> {
  const client = deps.createClient();
  try {
    const result = await runOperation(operation, createOperationContext(client), input, {
      destructiveConfirmed: flag(args, "yes"),
    });
    await emitResult(io, result, { outputFile: stringOption(args, "output") });
    return EXIT_OK;
  } finally {
    await deps.closeClient(client);
  }
}

export async function runCommand(argv: string[], io: CliIo, deps: CliDependencies): Promise<number> {
  const args = parseArgs(argv, { input: "string", output: "string", json: "boolean", yes: "boolean" });
  const operation = requireOperation(args.positionals[0], "tools run");
  if (args.positionals.length > 1) {
    throw new CliUsageError(`Unexpected argument '${args.positionals[1]}'. Pass operation input with --input '<json>'.`);
  }
  const input = parseInputJson(stringOption(args, "input"), operation.name);
  return executeOperation(operation, input, args, io, deps);
}

export async function toolsCommand(argv: string[], io: CliIo, deps: CliDependencies): Promise<number> {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case "list": return listCommand(rest, io);
    case "describe": return describeCommand(rest, io);
    case "run": return runCommand(rest, io, deps);
    case undefined:
      throw new CliUsageError("'tools' needs a subcommand: list, describe or run.");
    default:
      throw new CliUsageError(`Unknown 'tools' subcommand '${subcommand}'. Use list, describe or run.`);
  }
}
