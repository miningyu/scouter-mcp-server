import { jsonStringify } from "../client/index.js";
import { finalizeOutput } from "../operations/shared-utils.js";

/**
 * The transport-neutral helpers now live in operations/shared-utils.ts so the CLI
 * can use them too. They stay re-exported here for existing importers.
 */
export * from "../operations/shared-utils.js";

/** MCP-side renderer: finalize an operation output and wrap it as tool content. */
export function buildResponse(output: Record<string, unknown>, warnings: string[]) {
  return { content: [{ type: "text" as const, text: jsonStringify(finalizeOutput(output, warnings)) }] };
}
