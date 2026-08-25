import { z } from "zod";
import {
  OperationConfirmationError,
  OperationInputError,
  OperationPermissionError,
  isDestructiveOperation,
  isWriteOperation,
  type AnyOperation,
  type OperationContext,
} from "./definition.js";

export function isWriteEnabled(): boolean {
  return process.env.SCOUTER_ENABLE_WRITE === "true";
}

export interface RunOperationOptions {
  /** Defaults to isWriteEnabled(). */
  writeEnabled?: boolean;
  /** Destructive operations refuse to run unless this is true. */
  destructiveConfirmed?: boolean;
  /** Set to false when the caller has already validated against inputShape. */
  validateInput?: boolean;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  ${path}: ${issue.message}`;
    })
    .join("\n");
}

export function parseOperationInput(operation: AnyOperation, raw: unknown): Record<string, unknown> {
  // strict: a mistyped key must fail loudly instead of silently widening the query
  const parsed = z.strictObject(operation.inputShape).safeParse(raw ?? {});
  if (!parsed.success) {
    throw new OperationInputError(
      `Invalid input for '${operation.name}':\n${formatIssues(parsed.error)}`,
    );
  }
  return parsed.data as Record<string, unknown>;
}

/**
 * The single execution path shared by MCP and CLI. Permission checks live here so
 * no surface can reach a write operation by going around tool registration.
 */
export async function runOperation(
  operation: AnyOperation,
  ctx: OperationContext,
  rawInput: unknown,
  options: RunOperationOptions = {},
): Promise<unknown> {
  const writeEnabled = options.writeEnabled ?? isWriteEnabled();

  if (isWriteOperation(operation) && !writeEnabled) {
    throw new OperationPermissionError(
      `'${operation.name}' is a write operation. Set SCOUTER_ENABLE_WRITE=true to allow it.`,
    );
  }
  if (isDestructiveOperation(operation) && options.destructiveConfirmed !== true) {
    throw new OperationConfirmationError(
      `'${operation.name}' is destructive and needs explicit confirmation (pass --yes).`,
    );
  }

  const input = options.validateInput === false
    ? (rawInput as Record<string, unknown>)
    : parseOperationInput(operation, rawInput);

  return operation.execute(ctx, input);
}
