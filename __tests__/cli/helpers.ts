import { vi } from "vitest";
import type { CliDependencies } from "../../cli/deps.js";
import type { CliIo } from "../../cli/output.js";
import type { ConnectionInfo, ScouterClient } from "../../client/index.js";
import { createMockClient } from "../operations/mock-client.js";

export interface CapturedIo extends CliIo {
  out: string[];
  err: string[];
  stdoutText(): string;
  stderrText(): string;
}

export function captureIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: text => { out.push(text); },
    stderr: text => { err.push(text); },
    stdoutText: () => out.join("\n"),
    stderrText: () => err.join("\n"),
  };
}

export const DEFAULT_CONNECTION: ConnectionInfo = {
  protocol: "http",
  endpoint: "http://scouter.example:6180",
  endpointConfigured: true,
  authConfigured: true,
  apiId: "reader",
  writeEnabled: false,
  maskPii: true,
};

export function stubDeps(overrides: {
  client?: ScouterClient;
  connection?: Partial<ConnectionInfo>;
} = {}): CliDependencies & { closed: () => number } {
  const client = overrides.client ?? createMockClient();
  const closeClient = vi.fn().mockResolvedValue(undefined);
  return {
    createClient: () => client,
    closeClient,
    describeConnection: () => ({ ...DEFAULT_CONNECTION, ...overrides.connection }),
    closed: () => closeClient.mock.calls.length,
  };
}
