import { z } from "zod";
import { defineOperation, OperationInputError, type OperationContext } from "./definition.js";
import { catchWarn, UnsupportedOperationError } from "../client/index.js";

const inputShape = {
  operation: z.enum(["get", "create"]).describe("'get' retrieves a stored URL by key, 'create' creates a shortened URL"),
  key: z.string().optional().describe("Shortened URL key (required for 'get' operation)"),
  url: z.string().optional().describe("Long URL to shorten (required for 'create' operation)"),
};

export const operation = defineOperation({
  name: "manage_shortener",
  title: "Manage Shortener",
  description: "[HTTP mode only] Manage Scouter's URL shortener service. 'get' retrieves the original URL from a shortened key. 'create' generates a shortened key for a long URL.",
  inputShape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  execute,
});

async function execute(ctx: OperationContext, args: { operation: "get" | "create"; key?: string; url?: string }) {
  try {
    const warnings: string[] = [];

    if (args.operation === "get") {
      if (!args.key) throw new OperationInputError("Error: 'key' is required for get operation");
      const result = await catchWarn(ctx.client.getShortener(args.key), null, warnings, "getShortener");
      const output: Record<string, unknown> = { operation: "get", key: args.key, url: result };
      if (warnings.length > 0) output.warnings = warnings;
      return output;
    }

    if (!args.url) throw new OperationInputError("Error: 'url' is required for create operation");
    const result = await catchWarn(ctx.client.createShortener(args.url), null, warnings, "createShortener");
    const output: Record<string, unknown> = { operation: "create", originalUrl: args.url, shortenedKey: result };
    if (warnings.length > 0) output.warnings = warnings;
    return output;
  } catch (e) {
    if (e instanceof UnsupportedOperationError) {
      return { error: "This operation requires HTTP mode", detail: e.message, hint: "Configure SCOUTER_API_URL instead of SCOUTER_TCP_HOST to enable this feature" };
    }
    throw e;
  }
}
