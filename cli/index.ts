import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OperationConfirmationError,
  OperationInputError,
  OperationPermissionError,
} from "../operations/definition.js";
import { CliUsageError } from "./args.js";
import { diagnoseCommand, overviewCommand, transactionsCommand } from "./commands/shortcuts.js";
import { toolsCommand } from "./commands/tools.js";
import { defaultDependencies, type CliDependencies } from "./deps.js";
import { doctorCommand } from "./doctor.js";
import { EXIT_FAILURE, EXIT_FORBIDDEN, EXIT_OK, EXIT_USAGE, processIo, type CliIo } from "./output.js";

const HELP = `scouter-mcp-server — Scouter APM access for MCP clients, humans and skills

  scouter-mcp-server                              start the stdio MCP server (no arguments)

  scouter-mcp-server doctor [--json]              check configuration and connectivity
  scouter-mcp-server tools list [--json] [--all]  list operations runnable in this environment
  scouter-mcp-server tools describe <name>        show an operation's input schema
  scouter-mcp-server tools run <name> --input '<json>' [--yes] [--output <file>]

Shortcuts (same operations, fewer keystrokes)
  scouter-mcp-server overview [--obj-type <type>] [--json]
  scouter-mcp-server diagnose [--since 30m] [--obj-type <type>] [--json]
  scouter-mcp-server transactions search [--since 10m] [--limit 20] [--service <name>] [--json]
  scouter-mcp-server transactions get <txid> [--date YYYYMMDD] [--json]

Options
  --json            print machine-readable JSON
  --input <json>    operation input, validated against its schema
  --output <file>   write the result to a file; stdout gets the path and a summary
  --yes             confirm a destructive operation
  --all             include operations this environment cannot run (tools list)
  --since <30m>     relative time window: s, m, h or d
  --limit <n>       maximum transactions to return

Environment
  SCOUTER_API_URL, SCOUTER_API_ID, SCOUTER_API_PASSWORD   HTTP mode
  SCOUTER_TCP_HOST, SCOUTER_TCP_PORT                      TCP mode
  SCOUTER_ENABLE_WRITE=true                               allow write operations
  SCOUTER_MASK_PII=false                                  show unmasked IPs, logins and SQL params

Results go to stdout; logs and error explanations go to stderr.
Exit codes: 0 ok, 1 failure, 2 usage or input error, 3 not permitted.`;

function readVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name === "scouter-mcp-server" && pkg.version) return pkg.version;
    } catch {
      // keep walking up
    }
    dir = dirname(dir);
  }
  return "unknown";
}

async function dispatch(argv: string[], io: CliIo, deps: CliDependencies): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "doctor": return doctorCommand(rest, io, deps);
    case "tools": return toolsCommand(rest, io, deps);
    case "overview": return overviewCommand(rest, io, deps);
    case "diagnose": return diagnoseCommand(rest, io, deps);
    case "transactions": return transactionsCommand(rest, io, deps);
    default:
      throw new CliUsageError(`Unknown command '${command}'. Run 'scouter-mcp-server --help'.`);
  }
}

export async function runCli(
  argv: string[],
  io: CliIo = processIo,
  deps: CliDependencies = defaultDependencies,
): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    io.stdout(HELP);
    return EXIT_OK;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    io.stdout(readVersion());
    return EXIT_OK;
  }

  try {
    return await dispatch(argv, io, deps);
  } catch (e) {
    if (e instanceof CliUsageError || e instanceof OperationInputError) {
      io.stderr(e.message);
      return EXIT_USAGE;
    }
    if (e instanceof OperationPermissionError || e instanceof OperationConfirmationError) {
      io.stderr(e.message);
      return EXIT_FORBIDDEN;
    }
    io.stderr(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return EXIT_FAILURE;
  }
}
