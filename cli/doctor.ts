import { parseArgs, flag, CliUsageError } from "./args.js";
import type { CliDependencies } from "./deps.js";
import { EXIT_FAILURE, EXIT_OK, emitResult, type CliIo } from "./output.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  protocol: "http" | "tcp";
  endpoint: string;
  apiId: string;
  /** Reports only whether a password is configured — never its value. */
  apiPassword: "set" | "not set";
  writeEnabled: boolean;
  maskPii: boolean;
  checks: DoctorCheck[];
}

export async function buildDoctorReport(deps: CliDependencies): Promise<DoctorReport> {
  const info = deps.describeConnection();
  const checks: DoctorCheck[] = [];

  const endpointVar = info.protocol === "tcp" ? "SCOUTER_TCP_HOST" : "SCOUTER_API_URL";
  if (!info.endpointConfigured) {
    checks.push({
      name: "endpoint",
      status: "warn",
      detail: `${endpointVar} is not set; falling back to ${info.endpoint}`,
    });
  } else {
    checks.push({ name: "endpoint", status: "ok", detail: `${endpointVar} points at ${info.endpoint}` });
  }

  if (info.protocol === "tcp" && !Number.isFinite(Number(process.env.SCOUTER_TCP_PORT || "6100"))) {
    checks.push({ name: "port", status: "fail", detail: "SCOUTER_TCP_PORT is not a number" });
  }

  if (info.apiId && info.authConfigured) {
    checks.push({ name: "credentials", status: "ok", detail: "SCOUTER_API_ID and SCOUTER_API_PASSWORD are set" });
  } else if (info.apiId) {
    checks.push({ name: "credentials", status: "warn", detail: "SCOUTER_API_PASSWORD is not set" });
  } else {
    checks.push({ name: "credentials", status: "warn", detail: "SCOUTER_API_ID is not set; connecting anonymously" });
  }

  const client = deps.createClient();
  try {
    const objects = await client.getObjects();
    const alive = objects.filter(o => o.alive).length;
    checks.push({
      name: "connection",
      status: "ok",
      detail: `reached Scouter over ${info.protocol}: ${objects.length} object(s), ${alive} alive`,
    });
  } catch (e) {
    checks.push({
      name: "connection",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await deps.closeClient(client);
  }

  return {
    ok: checks.every(check => check.status !== "fail"),
    protocol: info.protocol,
    endpoint: info.endpoint,
    apiId: info.apiId || "(not set)",
    apiPassword: info.authConfigured ? "set" : "not set",
    writeEnabled: info.writeEnabled,
    maskPii: info.maskPii,
    checks,
  };
}

function renderReport(report: DoctorReport): string {
  const lines = [
    "Scouter connection",
    `  protocol   ${report.protocol}`,
    `  endpoint   ${report.endpoint}`,
    `  api id     ${report.apiId}`,
    `  password   ${report.apiPassword}`,
    `  write      ${report.writeEnabled ? "enabled" : "disabled"} (SCOUTER_ENABLE_WRITE)`,
    `  pii mask   ${report.maskPii ? "enabled" : "disabled"} (SCOUTER_MASK_PII)`,
    "",
    "Checks",
    ...report.checks.map(check => `  ${check.status.padEnd(5)} ${check.name.padEnd(12)} ${check.detail}`),
    "",
    `doctor: ${report.ok ? "ok" : "failed"}`,
  ];
  return lines.join("\n");
}

export async function doctorCommand(argv: string[], io: CliIo, deps: CliDependencies): Promise<number> {
  const args = parseArgs(argv, { json: "boolean", output: "string" });
  if (args.positionals.length > 0) {
    throw new CliUsageError(`'doctor' takes no arguments, got '${args.positionals[0]}'.`);
  }

  const report = await buildDoctorReport(deps);
  const outputFile = typeof args.options.output === "string" ? args.options.output : undefined;

  if (flag(args, "json") || outputFile) {
    await emitResult(io, report, { outputFile });
  } else {
    io.stdout(renderReport(report));
  }

  return report.ok ? EXIT_OK : EXIT_FAILURE;
}
