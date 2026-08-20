import type { z } from "zod";

export interface InputFieldInfo {
  name: string;
  type: string;
  required: boolean;
  default?: unknown;
  values?: string[];
  description?: string;
}

interface ZodNode {
  def?: { type: string; innerType?: ZodNode; defaultValue?: unknown; entries?: Record<string, unknown> };
  description?: string;
}

/**
 * Unwraps optional/default wrappers so `tools describe` can report the underlying
 * type, whether the field is required, and any schema default.
 */
export function describeField(name: string, schema: z.ZodType): InputFieldInfo {
  let node = schema as unknown as ZodNode;
  let required = true;
  let defaultValue: unknown;

  while (node?.def?.innerType) {
    const kind = node.def.type;
    if (kind === "optional" || kind === "nullable" || kind === "nullish") {
      required = false;
    } else if (kind === "default" || kind === "prefault") {
      const raw = node.def.defaultValue;
      defaultValue = typeof raw === "function" ? (raw as () => unknown)() : raw;
      required = false;
    } else {
      break;
    }
    node = node.def.innerType;
  }

  const info: InputFieldInfo = {
    name,
    type: node?.def?.type ?? "unknown",
    required,
    description: schema.description,
  };
  if (defaultValue !== undefined) info.default = defaultValue;
  if (info.type === "enum" && node.def?.entries) info.values = Object.keys(node.def.entries);
  return info;
}

export function describeInputShape(shape: z.ZodRawShape): InputFieldInfo[] {
  return Object.entries(shape).map(([name, schema]) => describeField(name, schema as z.ZodType));
}
