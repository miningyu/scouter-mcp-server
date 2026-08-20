import { closeClient, createClient, describeConnection } from "../client/index.js";
import type { ConnectionInfo, ScouterClient } from "../client/index.js";

/** Injection seam so tests can drive the CLI without a Scouter server. */
export interface CliDependencies {
  createClient(): ScouterClient;
  closeClient(client: ScouterClient): Promise<void>;
  describeConnection(): ConnectionInfo;
}

export const defaultDependencies: CliDependencies = { createClient, closeClient, describeConnection };
