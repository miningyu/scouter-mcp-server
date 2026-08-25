import { z } from "zod";
import { defineOperation, type OperationContext } from "./definition.js";
import { catchWarn, UnsupportedOperationError } from "../client/index.js";

const inputShape = {
  counter_name: z.string().describe("Counter name to set alert scripting for (e.g., 'TPS', 'ElapsedTime')"),
  target: z.enum(["config", "rule"]).describe(
    "'config' to save alert configuration/script, 'rule' to save alert threshold rules",
  ),
  values: z.string().describe("Alert scripting configuration or rule content to save"),
};

export const operation = defineOperation({
  name: "set_alert_scripting",
  title: "Set Alert Scripting",
  description: "[HTTP mode only] Save alert scripting configuration or rules for a specific counter. Use 'config' target to save alert scripts and 'rule' target to save threshold rules. Use get_alert_scripting first to read current config before modifying.",
  inputShape,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  execute,
});

async function execute(ctx: OperationContext, args: { counter_name: string; target: "config" | "rule"; values: string }) {
  try {
    const warnings: string[] = [];

    const saveFunc = args.target === "config"
      ? ctx.client.setAlertConfigScripting
      : ctx.client.setAlertRuleScripting;

    const result = await catchWarn(
      saveFunc(args.counter_name, args.values),
      null, warnings, `setAlert${args.target === "config" ? "Config" : "Rule"}Scripting`,
    );

    const output: Record<string, unknown> = {
      counterName: args.counter_name,
      target: args.target,
      result,
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
