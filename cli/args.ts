/**
 * A deliberately small argv parser.
 *
 * node:util's parseArgs would do the job, but it only exists from Node 18.3 and this
 * package declares node>=18. Importing it eagerly would crash the MCP server on older
 * runtimes, so the CLI carries these ~50 lines instead of taking on that risk or a
 * third-party dependency.
 */

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export type OptionType = "string" | "boolean";

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
}

export function parseArgs(argv: string[], spec: Record<string, OptionType>): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  let optionsEnded = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (optionsEnded || !token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      optionsEnded = true;
      continue;
    }

    const eq = token.indexOf("=");
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);
    const type = spec[name];

    if (!type) {
      throw new CliUsageError(`Unknown option '--${name}'. Known options: ${knownOptions(spec)}`);
    }
    if (type === "boolean") {
      if (inlineValue !== undefined) {
        throw new CliUsageError(`Option '--${name}' is a flag and takes no value.`);
      }
      options[name] = true;
      continue;
    }
    const value = inlineValue ?? argv[++i];
    if (value === undefined) {
      throw new CliUsageError(`Option '--${name}' requires a value.`);
    }
    options[name] = value;
  }

  return { positionals, options };
}

function knownOptions(spec: Record<string, OptionType>): string {
  const names = Object.keys(spec);
  return names.length > 0 ? names.map(n => `--${n}`).join(", ") : "(none)";
}

export function stringOption(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name];
  return typeof value === "string" ? value : undefined;
}

export function flag(args: ParsedArgs, name: string): boolean {
  return args.options[name] === true;
}
