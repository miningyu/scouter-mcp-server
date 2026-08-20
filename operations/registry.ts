import type { AnyOperation } from "./definition.js";
import { isWriteEnabled } from "./execute.js";

import { operation as getSystemOverview } from "./get-system-overview.js";
import { operation as diagnosePerformance } from "./diagnose-performance.js";
import { operation as getCounterTrend } from "./get-counter-trend.js";
import { operation as getRealtimeXlogs } from "./get-realtime-xlogs.js";
import { operation as searchTransactions } from "./search-transactions.js";
import { operation as getTransactionDetail } from "./get-transaction-detail.js";
import { operation as listActiveServices } from "./list-active-services.js";
import { operation as getDistributedTrace } from "./get-distributed-trace.js";
import { operation as getServiceSummary } from "./get-service-summary.js";
import { operation as getSqlAnalysis } from "./get-sql-analysis.js";
import { operation as getErrorSummary } from "./get-error-summary.js";
import { operation as getInteractionCounters } from "./get-interaction-counters.js";
import { operation as getVisitorStats } from "./get-visitor-stats.js";
import { operation as getIpSummary } from "./get-ip-summary.js";
import { operation as getUserAgentSummary } from "./get-user-agent-summary.js";
import { operation as getAlertSummary } from "./get-alert-summary.js";
import { operation as getAlertScripting } from "./get-alert-scripting.js";
import { operation as getConfigure } from "./get-configure.js";
import { operation as getServerInfo } from "./get-server-info.js";
import { operation as getHostInfo } from "./get-host-info.js";
import { operation as getAgentInfo } from "./get-agent-info.js";
import { operation as getThreadDump } from "./get-thread-dump.js";
import { operation as getRawProfile } from "./get-raw-profile.js";
import { operation as getRawXlog } from "./get-raw-xlog.js";
import { operation as lookupText } from "./lookup-text.js";
import { operation as setConfigure } from "./set-configure.js";
import { operation as setAlertScripting } from "./set-alert-scripting.js";
import { operation as manageKvStore } from "./manage-kv-store.js";
import { operation as manageShortener } from "./manage-shortener.js";
import { operation as controlThread } from "./control-thread.js";
import { operation as removeInactiveObjects } from "./remove-inactive-objects.js";

/**
 * The single source of truth for every Scouter operation. MCP tool registration and
 * the CLI both read this list — neither keeps its own copy.
 *
 * Order matches the historical MCP tool registration order: 25 read-only operations
 * first, then the 6 write operations.
 */
export const operations: AnyOperation[] = [
  getSystemOverview,
  diagnosePerformance,
  getCounterTrend,
  getRealtimeXlogs,
  searchTransactions,
  getTransactionDetail,
  listActiveServices,
  getDistributedTrace,
  getServiceSummary,
  getSqlAnalysis,
  getErrorSummary,
  getInteractionCounters,
  getVisitorStats,
  getIpSummary,
  getUserAgentSummary,
  getAlertSummary,
  getAlertScripting,
  getConfigure,
  getServerInfo,
  getHostInfo,
  getAgentInfo,
  getThreadDump,
  getRawProfile,
  getRawXlog,
  lookupText,
  setConfigure,
  setAlertScripting,
  manageKvStore,
  manageShortener,
  controlThread,
  removeInactiveObjects,
];

const byName = new Map(operations.map(op => [op.name, op]));

export function getOperation(name: string): AnyOperation | undefined {
  return byName.get(name);
}

/** Operations the current environment is allowed to execute. */
export function listAvailableOperations(writeEnabled = isWriteEnabled()): AnyOperation[] {
  return writeEnabled ? operations : operations.filter(op => op.annotations.readOnlyHint);
}
