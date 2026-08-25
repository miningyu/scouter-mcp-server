import { z } from "zod";
import { defineOperation, type OperationContext } from "./definition.js";
import { catchWarn } from "../client/index.js";
import { isMaskPiiEnabled } from "./shared-utils.js";

const inputShape = {
  date: z.string().describe("Date in YYYYMMDD format"),
  txid: z.string().describe("Transaction ID (from search_transactions or get_realtime_xlogs)"),
};

export const operation = defineOperation({
  name: "get_raw_profile",
  title: "Get Raw Profile",
  description: "Get raw (non-decoded) profile steps for a transaction. Unlike get_transaction_detail which returns decoded/human-readable profile data, this returns the raw Step objects with hash IDs. Use lookup_text to resolve hash IDs to text. Useful when you need the raw step structure for programmatic analysis.",
  inputShape,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  execute,
});

async function execute(ctx: OperationContext, args: { date: string; txid: string }) {
  const warnings: string[] = [];

  const profile = await catchWarn(
    ctx.client.getRawProfile(args.date, args.txid),
    null, warnings, "rawProfile",
  );

  const maskedProfile = isMaskPiiEnabled() && Array.isArray(profile)
    ? profile.map((step: Record<string, unknown>) =>
        step.param !== undefined ? { ...step, param: "[masked]" } : step)
    : profile;

  const output: Record<string, unknown> = {
    date: args.date,
    txid: args.txid,
    profile: maskedProfile,
  };
  if (warnings.length > 0) output.warnings = warnings;
  if (isMaskPiiEnabled()) output.piiMasked = "Fields marked [masked] contain data that is hidden by SCOUTER_MASK_PII. Disable this env var to see actual values.";

  return output;
}
