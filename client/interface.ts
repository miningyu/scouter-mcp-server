export interface ScouterObject {
  objType: string;
  objFamily: string;
  objHash: number;
  objName: string;
  address: string;
  alive: boolean;
}

export class UnsupportedOperationError extends Error {
  constructor(method: string) {
    super(`${method} is not supported via TCP; use HTTP mode`);
    this.name = "UnsupportedOperationError";
  }
}

export interface ScouterClient {
  // --- Object ---
  getObjects(): Promise<ScouterObject[]>;

  // --- Counter (realtime) ---
  getRealtimeCounters(counters: string, objType: string): Promise<unknown>;
  getRealtimeCountersByObjHashes(counters: string, objHashes: string): Promise<unknown>;
  getLatestCounter(counter: string, objType: string, latestSec: number): Promise<unknown>;
  getLatestCounterByObjHashes(counter: string, objHashes: string, latestSec: number): Promise<unknown>;

  // --- Counter (history) ---
  getCounterHistory(counter: string, objType: string, startMillis: number, endMillis: number): Promise<unknown>;
  getCounterHistoryByObjHashes(counter: string, objHashes: string, startMillis: number, endMillis: number): Promise<unknown>;
  getCounterStat(counter: string, objType: string, startYmd: string, endYmd: string): Promise<unknown>;
  getCounterStatByObjHashes(counter: string, objHashes: string, startYmd: string, endYmd: string): Promise<unknown>;

  // --- Active service ---
  getActiveServiceStepCount(objType: string): Promise<unknown>;
  getActiveServices(objType: string): Promise<unknown>;
  getActiveServicesByObj(objHash: number): Promise<unknown>;
  getActiveThreadDetail(objHash: number, threadId: number): Promise<unknown>;

  // --- Alert ---
  getRealtimeAlerts(offset1?: number, offset2?: number): Promise<unknown>;
  getAlertScripting(counterName: string): Promise<unknown>;
  readAlertScriptingLog(loop: number, index: number): Promise<unknown>;

  // --- XLog / Transaction ---
  getXLogData(date: string, startMillis: number, endMillis: number, objHashes: string): Promise<unknown[]>;
  searchXLogData(date: string, params: Record<string, string>): Promise<unknown>;
  getXLogDetail(date: string, txid: string): Promise<unknown>;
  getXLogsByGxid(date: string, gxid: string): Promise<unknown>;
  getMultiXLogs(date: string, txidList: string): Promise<unknown>;
  getProfileData(date: string, txid: string): Promise<unknown>;
  getRealtimeXLogData(offset1: number, offset2: number, objHashes: string): Promise<unknown>;

  // --- Summary ---
  getSummary(category: string, objType: string, startMillis: number, endMillis: number): Promise<unknown[]>;
  getSummaryByObjHash(category: string, objHash: number, startMillis: number, endMillis: number): Promise<unknown>;

  // --- Visitor ---
  getVisitorRealtimeByObjType(objType: string): Promise<number>;
  getVisitorRealtimeByObjHash(objHash: number): Promise<number>;
  getVisitorRealtimeByObjHashes(objHashes: string): Promise<number>;
  getVisitorDailyByObjType(objType: string, yyyymmdd: string): Promise<number>;
  getVisitorDailyByObjHash(objHash: number, yyyymmdd: string): Promise<number>;
  getVisitorGroup(objHashes: string, startYmdH: number, endYmdH: number): Promise<unknown>;
  getVisitorHourly(objHashes: string, startYmdH: number, endYmdH: number): Promise<unknown[]>;

  // --- Interaction ---
  getInteractionCounters(objType: string): Promise<unknown[]>;
  getInteractionCountersByObjHashes(objHashes: string): Promise<unknown[]>;

  // --- Host / Agent ---
  getHostTop(objHash: number): Promise<unknown[]>;
  getHostDisk(objHash: number): Promise<unknown[]>;
  getThreadList(objHash: number): Promise<unknown[]>;
  getThreadDump(objHash: number): Promise<unknown>;
  getHeapHistogram(objHash: number): Promise<unknown>;
  getAgentEnv(objHash: number): Promise<unknown[]>;
  getAgentSocket(objHash: number): Promise<unknown[]>;

  // --- Configuration / Info ---
  getServerConfig(): Promise<unknown>;
  getObjectConfig(objHash: number): Promise<unknown>;
  getServerInfo(): Promise<unknown[]>;
  getCounterModel(): Promise<unknown>;

  // --- Text lookup ---
  lookupTexts(date: string, type: string, hashes: number[]): Promise<Record<string, string>>;

  // --- Write operations ---
  controlThread(objHash: number, threadId: number, action: string): Promise<unknown>;
  setServerConfig(values: string): Promise<unknown>;
  setObjectConfig(objHash: number, values: string): Promise<unknown>;
  setServerConfigKv(key: string, value: string): Promise<unknown>;
  setTypeConfigKv(objType: string, key: string, value: string): Promise<unknown>;
  setAlertConfigScripting(counterName: string, values: string): Promise<unknown>;
  setAlertRuleScripting(counterName: string, values: string): Promise<unknown>;
  removeInactiveAll(): Promise<unknown>;
  removeInactiveServer(): Promise<unknown>;

  // --- KV Store (global) ---
  kvGet(key: string): Promise<string>;
  kvSet(key: string, value: string, ttl?: number): Promise<boolean>;
  kvSetTtl(key: string, ttl: number): Promise<boolean>;
  kvGetBulk(keys: string): Promise<unknown[]>;
  kvSetBulk(kvs: Record<string, string>, ttl?: number): Promise<unknown[]>;

  // --- KV Store (namespaced) ---
  kvSpaceGet(keySpace: string, key: string): Promise<string>;
  kvSpaceSet(keySpace: string, key: string, value: string, ttl?: number): Promise<boolean>;
  kvSpaceSetTtl(keySpace: string, key: string, ttl: number): Promise<boolean>;
  kvSpaceGetBulk(keySpace: string, keys: string): Promise<unknown[]>;
  kvSpaceSetBulk(keySpace: string, kvs: Record<string, string>, ttl?: number): Promise<unknown[]>;

  // --- KV Store (private) ---
  kvPrivateGet(key: string): Promise<string>;
  kvPrivateSet(key: string, value: string, ttl?: number): Promise<boolean>;
  kvPrivateSetTtl(key: string, ttl: number): Promise<boolean>;
  kvPrivateGetBulk(keys: string): Promise<unknown[]>;
  kvPrivateSetBulk(kvs: Record<string, string>, ttl?: number): Promise<unknown[]>;

  // --- Raw profile / XLog ---
  getRawProfile(date: string, txid: string): Promise<unknown>;
  getRawXLog(date: string, txid: string): Promise<unknown>;
  getRawXLogByGxid(date: string, gxid: string): Promise<unknown>;
  searchRawXLog(date: string, params: Record<string, string>): Promise<unknown>;
  getPageableRawXLog(date: string, params: Record<string, string>): Promise<unknown>;
  getRealtimeRawXLog(xlogLoop: number, xlogIndex: number, objHashes: string): Promise<unknown>;

  // --- URL Shortener ---
  getShortener(key: string): Promise<string>;
  createShortener(url: string): Promise<string>;
}
