import { z } from "zod";
import { defineOperation, type OperationContext } from "./definition.js";
import { catchWarn, UnsupportedOperationError } from "../client/index.js";

const inputShape = {
  obj_hash: z.number().optional().describe(
    "Agent object hash. If provided, returns that agent's configuration. If omitted, returns server configuration.",
  ),
};

export const operation = defineOperation({
  name: "get_configure",
  title: "Get Configure",
  description: "[HTTP mode only] Read server or agent configuration (read-only). Without obj_hash, returns the collector server's scouter.conf. With obj_hash, returns that specific agent's configuration. Use get_system_overview to find agent hashes.",
  inputShape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  execute,
});

function stripConfigBloat(config: unknown): unknown {
  if (config === null || typeof config !== "object") return config;
  const raw = config as Record<string, unknown>;
  const { descMap: _, valueTypeMap: _2, valueTypeDescMap: _3, ...rest } = raw;
  if (rest.configStateList && Array.isArray(rest.configStateList)) {
    rest.configStateList = (rest.configStateList as Array<Record<string, unknown>>)
      .filter(item => String(item.value) !== String(item.def))
      .map(({ key, value, def }) => ({ key, value, def }));
  }
  return rest;
}

async function execute(ctx: OperationContext, args: { obj_hash?: number }) {
  try {
    const warnings: string[] = [];

    if (args.obj_hash !== undefined) {
      const config = await catchWarn(
        ctx.client.getObjectConfig(args.obj_hash),
        null, warnings, "objectConfig",
      );
      const output: Record<string, unknown> = {
        target: "agent",
        objHash: args.obj_hash,
        config: stripConfigBloat(config),
      };
      if (warnings.length > 0) output.warnings = warnings;
      return output;
    }

    const config = await catchWarn(
      ctx.client.getServerConfig(),
      null, warnings, "serverConfig",
    );
    const output: Record<string, unknown> = {
      target: "server",
      config: stripConfigBloat(config),
    };
    if (warnings.length > 0) output.warnings = warnings;
    return output;
  } catch (e) {
    if (e instanceof UnsupportedOperationError) {
      return { error: "This operation requires HTTP mode", detail: e.message, hint: "Configure SCOUTER_API_URL instead of SCOUTER_TCP_HOST to enable this feature" };
    }
    throw e;
  }
}
