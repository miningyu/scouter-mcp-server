import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { register as registerControlThread } from "./control-thread.js";
import { register as registerDiagnosePerformance } from "./diagnose-performance.js";
import { register as registerGetAgentInfo } from "./get-agent-info.js";
import { register as registerGetAlertScripting } from "./get-alert-scripting.js";
import { register as registerGetAlertSummary } from "./get-alert-summary.js";
import { register as registerGetConfigure } from "./get-configure.js";
import { register as registerGetCounterTrend } from "./get-counter-trend.js";
import { register as registerGetDistributedTrace } from "./get-distributed-trace.js";
import { register as registerGetErrorSummary } from "./get-error-summary.js";
import { register as registerGetHostInfo } from "./get-host-info.js";
import { register as registerGetInteractionCounters } from "./get-interaction-counters.js";
import { register as registerGetIpSummary } from "./get-ip-summary.js";
import { register as registerGetRawProfile } from "./get-raw-profile.js";
import { register as registerGetRawXlog } from "./get-raw-xlog.js";
import { register as registerGetRealtimeXlogs } from "./get-realtime-xlogs.js";
import { register as registerGetServerInfo } from "./get-server-info.js";
import { register as registerGetServiceSummary } from "./get-service-summary.js";
import { register as registerGetSqlAnalysis } from "./get-sql-analysis.js";
import { register as registerGetSystemOverview } from "./get-system-overview.js";
import { register as registerGetThreadDump } from "./get-thread-dump.js";
import { register as registerGetTransactionDetail } from "./get-transaction-detail.js";
import { register as registerGetUserAgentSummary } from "./get-user-agent-summary.js";
import { register as registerGetVisitorStats } from "./get-visitor-stats.js";
import { register as registerListActiveServices } from "./list-active-services.js";
import { register as registerLookupText } from "./lookup-text.js";
import { register as registerManageKvStore } from "./manage-kv-store.js";
import { register as registerManageShortener } from "./manage-shortener.js";
import { register as registerRemoveInactiveObjects } from "./remove-inactive-objects.js";
import { register as registerSearchTransactions } from "./search-transactions.js";
import { register as registerSetAlertScripting } from "./set-alert-scripting.js";
import { register as registerSetConfigure } from "./set-configure.js";

export function isWriteEnabled(): boolean {
  return process.env.SCOUTER_ENABLE_WRITE === "true";
}

export function registerAllTools(server: McpServer): void {
  registerGetSystemOverview(server);
  registerDiagnosePerformance(server);
  registerGetCounterTrend(server);
  registerGetRealtimeXlogs(server);
  registerSearchTransactions(server);
  registerGetTransactionDetail(server);
  registerListActiveServices(server);
  registerGetDistributedTrace(server);
  registerGetServiceSummary(server);
  registerGetSqlAnalysis(server);
  registerGetErrorSummary(server);
  registerGetInteractionCounters(server);
  registerGetVisitorStats(server);
  registerGetIpSummary(server);
  registerGetUserAgentSummary(server);
  registerGetAlertSummary(server);
  registerGetAlertScripting(server);
  registerGetConfigure(server);
  registerGetServerInfo(server);
  registerGetHostInfo(server);
  registerGetAgentInfo(server);
  registerGetThreadDump(server);
  registerGetRawProfile(server);
  registerGetRawXlog(server);
  registerLookupText(server);

  if (isWriteEnabled()) {
    registerSetConfigure(server);
    registerSetAlertScripting(server);
    registerManageKvStore(server);
    registerManageShortener(server);
    registerControlThread(server);
    registerRemoveInactiveObjects(server);
  }
}
