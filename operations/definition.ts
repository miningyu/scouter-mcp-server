import type { z } from "zod";
import type { ScouterClient } from "../client/interface.js";

/**
 * Everything an operation needs in order to talk to Scouter.
 *
 * Deliberately transport-neutral: the MCP server and the CLI each build their own
 * context and call the very same operations. An operation never knows which one
 * invoked it.
 */
export interface OperationContext {
  client: ScouterClient;
  /** Returns [objType] when given, otherwise every alive object type. */
  resolveObjType(objType?: string): Promise<string[]>;
  /** Every alive object type, cached for a short while. */
  discoverObjTypes(): Promise<string[]>;
}

/** Mirrors the MCP tool annotations so both surfaces describe an operation identically. */
export interface OperationAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}

/**
 * Parsed operation input. Each operation narrows this to its own argument type;
 * the registry stays generic so all 31 operations fit in one list.
 */
export type OperationInput = Record<string, any>;

export interface OperationDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputShape: Shape;
  annotations: OperationAnnotations;
  /**
   * Returns a plain JavaScript value — never MCP content and never a CLI string.
   * MCP renders it as JSON text, the CLI prints or writes it as JSON.
   */
  execute(ctx: OperationContext, input: OperationInput): Promise<unknown>;
}

export type AnyOperation = OperationDefinition<z.ZodRawShape>;

export function defineOperation<Shape extends z.ZodRawShape>(
  definition: OperationDefinition<Shape>,
): OperationDefinition<Shape> {
  return definition;
}

export function isWriteOperation(operation: AnyOperation): boolean {
  return !operation.annotations.readOnlyHint;
}

export function isDestructiveOperation(operation: AnyOperation): boolean {
  return operation.annotations.destructiveHint;
}

/** Caller passed arguments the operation cannot work with. */
export class OperationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationInputError";
  }
}

/** A write operation was attempted while SCOUTER_ENABLE_WRITE is not "true". */
export class OperationPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationPermissionError";
  }
}

/** A destructive operation was attempted without explicit confirmation. */
export class OperationConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationConfirmationError";
  }
}
