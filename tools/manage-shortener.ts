import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client, jsonStringify, catchWarn, UnsupportedOperationError } from "../client/index.js";

export const params = {
  operation: z.enum(["get", "create"]).describe("'get' retrieves a stored URL by key, 'create' creates a shortened URL"),
  key: z.string().optional().describe("Shortened URL key (required for 'get' operation)"),
  url: z.string().optional().describe("Long URL to shorten (required for 'create' operation)"),
};

export function register(server: McpServer) {
  server.registerTool("manage_shortener", {
    title: "Manage Shortener",
    description: "[HTTP mode only] Manage Scouter's URL shortener service. 'get' retrieves the original URL from a shortened key. 'create' generates a shortened key for a long URL.",
    inputSchema: params,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, handler);
}

async function handler(args: { operation: "get" | "create"; key?: string; url?: string }) {
  try {
    const warnings: string[] = [];

    if (args.operation === "get") {
      if (!args.key) return { content: [{ type: "text" as const, text: "Error: 'key' is required for get operation" }] };
      const result = await catchWarn(client.getShortener(args.key), null, warnings, "getShortener");
      const output: Record<string, unknown> = { operation: "get", key: args.key, url: result };
      if (warnings.length > 0) output.warnings = warnings;
      return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
    }

    if (!args.url) return { content: [{ type: "text" as const, text: "Error: 'url' is required for create operation" }] };
    const result = await catchWarn(client.createShortener(args.url), null, warnings, "createShortener");
    const output: Record<string, unknown> = { operation: "create", originalUrl: args.url, shortenedKey: result };
    if (warnings.length > 0) output.warnings = warnings;
    return { content: [{ type: "text" as const, text: jsonStringify(output) }] };
  } catch (e) {
    if (e instanceof UnsupportedOperationError) {
      return { content: [{ type: "text" as const, text: jsonStringify({ error: "This operation requires HTTP mode", detail: e.message, hint: "Configure SCOUTER_API_URL instead of SCOUTER_TCP_HOST to enable this feature" }) }] };
    }
    throw e;
  }
}
