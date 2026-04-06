import { ScouterTcpConnection } from "../protocol/tcp-connection.js";
import { RequestCmd, StepEnum } from "../protocol/constants.js";
import { DataInputX } from "../protocol/data-input.js";
import type { Pack, MapPack, XLogPack, AlertPack, ObjectPack } from "../protocol/packs.js";
import type { SValue } from "../protocol/values.js";
import { UnsupportedOperationError, type ScouterClient, type ScouterObject } from "./interface.js";

function unsupported(method: string): never {
  throw new UnsupportedOperationError(method);
}

function intToIp(value: number): string {
  const unsigned = value >>> 0;
  return `${(unsigned >>> 24) & 0xFF}.${(unsigned >>> 16) & 0xFF}.${(unsigned >>> 8) & 0xFF}.${unsigned & 0xFF}`;
}

export class TcpClient implements ScouterClient {
  private conn: ScouterTcpConnection;
  private textCache = new Map<string, Map<number, string>>();

  constructor(host: string, port: number, userId: string, password: string) {
    this.conn = new ScouterTcpConnection(host, port, userId, password);
  }

  private async req(cmd: string, params?: Record<string, SValue>): Promise<Pack[]> {
    return this.conn.request(cmd, params);
  }

  private mapPackData(packs: Pack[]): Record<string, SValue>[] {
    return packs.filter((p): p is MapPack => p.type === "map").map(p => p.data);
  }

  private unpackParallelArrays(packs: Pack[]): Record<string, SValue>[] {
    const mapData = this.mapPackData(packs);
    if (mapData.length === 0) return [];
    const results: Record<string, SValue>[] = [];
    for (const data of mapData) {
      const arrayKeys = Object.keys(data).filter(k => Array.isArray(data[k]));
      if (arrayKeys.length === 0) {
        results.push(data);
        continue;
      }
      const rowCount = (data[arrayKeys[0]] as SValue[]).length;
      for (let i = 0; i < rowCount; i++) {
        const row: Record<string, SValue> = {};
        for (const key of Object.keys(data)) {
          const val = data[key];
          row[key] = Array.isArray(val) ? val[i] : val;
        }
        for (const key of Object.keys(row)) {
          const v = row[key];
          if (Buffer.isBuffer(v) && v.length === 4) {
            row[key] = `${v[0]}.${v[1]}.${v[2]}.${v[3]}`;
          }
        }
        results.push(row);
      }
    }
    return results;
  }

  async getObjects(): Promise<ScouterObject[]> {
    const packs = await this.req(RequestCmd.OBJECT_LIST_REAL_TIME);
    return packs.filter((p): p is ObjectPack => p.type === "object").map(o => ({
      objType: o.objType,
      objFamily: o.objType,
      objHash: o.objHash,
      objName: o.objName,
      address: o.address,
      alive: o.alive,
    }));
  }

  async getRealtimeCounters(counters: string, objType: string) {
    const counterList = counters.replace(/%25/g, "%").split(",");
    const results: unknown[] = [];
    for (const counter of counterList) {
      const packs = await this.req(RequestCmd.COUNTER_REAL_TIME_ALL, { counter, objType });
      for (const pack of this.mapPackData(packs)) {
        const objHashes = pack["objHash"] as number[] | undefined;
        const values = pack["value"] as SValue[] | undefined;
        if (objHashes && values) {
          for (let i = 0; i < objHashes.length; i++) {
            results.push({ objHash: objHashes[i], name: counter, value: values[i] });
          }
        }
      }
    }
    return results;
  }

  async getCounterHistory(counter: string, objType: string, startMillis: number, endMillis: number) {
    const objects = await this.getObjects();
    const objHashes = objects.filter(o => o.alive && o.objType === objType).map(o => o.objHash);
    if (objHashes.length === 0) return [];
    const packs = await this.req(RequestCmd.COUNTER_PAST_TIME_GROUP, {
      counter, stime: startMillis, etime: endMillis, objHash: objHashes,
    });
    return this.mapPackData(packs).map(d => ({
      objHash: d["objHash"],
      objName: objects.find(o => o.objHash === d["objHash"])?.objName,
      valueList: this.zipTimeValue(d["time"] as number[], d["value"] as number[]),
    }));
  }

  async getCounterStat(counter: string, objType: string, startYmd: string, endYmd: string) {
    const objects = await this.getObjects();
    const objHashes = objects.filter(o => o.objType === objType).map(o => o.objHash);
    if (objHashes.length === 0) return [];
    const packs = await this.req(RequestCmd.COUNTER_PAST_DATE_GROUP, {
      counter, date: startYmd, objHash: objHashes,
    });
    return this.mapPackData(packs).map(d => ({
      objHash: d["objHash"],
      objName: objects.find(o => o.objHash === d["objHash"])?.objName,
      valueList: this.zipTimeValue(d["time"] as number[], d["value"] as number[]),
    }));
  }

  async getActiveServiceStepCount(objType: string) {
    const packs = await this.req(RequestCmd.ACTIVESPEED_REAL_TIME_GROUP, { objType });
    const data = this.mapPackData(packs);
    return data[0] ?? { act1: 0, act2: 0, act3: 0, tps: 0 };
  }

  async getActiveServices(objType: string) {
    const packs = await this.req(RequestCmd.OBJECT_ACTIVE_SERVICE_LIST, { objType });
    return this.mapPackData(packs);
  }

  async getActiveServicesByObj(objHash: number) {
    const packs = await this.req(RequestCmd.OBJECT_ACTIVE_SERVICE_LIST, { objHash });
    return this.mapPackData(packs);
  }

  async getRealtimeAlerts(offset1 = 0, offset2 = 0) {
    const packs = await this.req(RequestCmd.ALERT_REAL_TIME, {
      index: offset1, loop: offset2, first: true,
    });
    const alerts = packs.filter((p): p is AlertPack => p.type === "alert").map(a => ({
      time: Number(a.time),
      level: a.level,
      objType: a.objType,
      objHash: a.objHash,
      title: a.title,
      message: a.message,
    }));
    return { alerts };
  }

  async getXLogData(date: string, startMillis: number, endMillis: number, objHashes: string) {
    const hashList = objHashes.split(",").map(Number);
    const packs = await this.req(RequestCmd.TRANX_LOAD_TIME_GROUP, {
      date, stime: startMillis, etime: endMillis, objHash: hashList, max: 500,
    });
    return this.xlogPacksToObjects(packs);
  }

  async searchXLogData(date: string, params: Record<string, string>) {
    const tcpParams: Record<string, SValue> = {
      stime: Number(params.startTimeMillis || 0),
      etime: Number(params.endTimeMillis || Date.now()),
    };
    if (params.service) tcpParams["service"] = params.service;
    if (params.ip) tcpParams["ip"] = params.ip;
    if (params.login) tcpParams["login"] = params.login;
    if (params.objHash) tcpParams["objHash"] = Number(params.objHash);
    const packs = await this.req(RequestCmd.SEARCH_XLOG_LIST, tcpParams);
    return this.xlogPacksToObjects(packs);
  }

  async getXLogDetail(date: string, txid: string) {
    const packs = await this.req(RequestCmd.XLOG_READ_BY_TXID, {
      date, txid: BigInt(txid),
    });
    const xlogs = this.xlogPacksToObjects(packs);
    return xlogs[0] ?? null;
  }

  async getXLogsByGxid(date: string, gxid: string) {
    const packs = await this.req(RequestCmd.XLOG_READ_BY_GXID, {
      date, gxid: BigInt(gxid),
    });
    return this.xlogPacksToObjects(packs);
  }

  async getMultiXLogs(date: string, txidList: string) {
    const txids = txidList.split(",").map(s => s.trim()).filter(Boolean);
    const results = await Promise.all(
      txids.map(txid => this.getXLogDetail(date, txid).catch(() => null))
    );
    return results.filter((x): x is NonNullable<typeof x> => x !== null);
  }

  async getProfileData(date: string, txid: string) {
    const packs = await this.req(RequestCmd.TRANX_PROFILE, {
      date, txid: BigInt(txid), max: 10000,
    });
    const profilePack = packs.find(p => p.type === "profile");
    if (!profilePack || profilePack.type !== "profile") return [];
    return this.parseProfileSteps(profilePack.profile);
  }

  async getSummary(category: string, objType: string, startMillis: number, endMillis: number) {
    const cmdMap: Record<string, string> = {
      service: RequestCmd.LOAD_SERVICE_SUMMARY,
      sql: RequestCmd.LOAD_SQL_SUMMARY,
      error: RequestCmd.LOAD_SERVICE_ERROR_SUMMARY,
      apiCall: RequestCmd.LOAD_APICALL_SUMMARY,
      ip: RequestCmd.LOAD_IP_SUMMARY,
      userAgent: RequestCmd.LOAD_UA_SUMMARY,
      alert: RequestCmd.LOAD_ALERT_SUMMARY,
    };
    const cmd = cmdMap[category];
    if (!cmd) return [];

    const date = new Date(startMillis);
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;

    const packs = await this.req(cmd, {
      date: dateStr, stime: startMillis, etime: endMillis, objType,
    });
    const data = this.mapPackData(packs);
    if (data.length === 0) return [];

    const summaryData = data[0];
    const ids = summaryData["id"] as number[] ?? [];
    const counts = summaryData["count"] as number[] ?? [];
    const errors = summaryData["error"] as number[] ?? [];
    const elapsed = summaryData["elapsed"] as number[] ?? [];

    let textMap: Map<number, string>;
    if (category === "ip") {
      textMap = new Map(ids.map(id => [id, intToIp(id)]));
    } else {
      const textType = category === "sql" ? "sql" : category === "error" ? "service" : category === "userAgent" ? "ua" : category === "apiCall" ? "apicall" : "service";
      textMap = await this.resolveTexts(dateStr, textType, ids);
    }

    const cpu = summaryData["cpu"] as number[] ?? [];
    const mem = summaryData["mem"] as number[] ?? [];

    return ids.map((id, i) => {
      const name = textMap.get(id) ?? `hash:${id}`;
      const base: Record<string, unknown> = {
        summaryKeyName: name,
        count: counts[i] ?? 0,
        elapsedSum: elapsed[i] ?? 0,
        cpuSum: cpu[i] ?? 0,
        memorySum: mem[i] ?? 0,
      };
      if (category === "error") {
        base.errorHash = errors[i] ?? 0;
        base.errorCount = 0;
      } else {
        base.errorCount = errors[i] ?? 0;
      }
      return base;
    });
  }

  async getThreadDump(objHash: number) {
    // TRIGGER_THREAD_DUMP returns only dump filename, not stack traces.
    // Use OBJECT_THREAD_LIST for live thread data (stack traces require HTTP mode).
    const packs = await this.req(RequestCmd.OBJECT_THREAD_LIST, { objHash });
    return this.unpackParallelArrays(packs);
  }

  async getHeapHistogram(objHash: number) {
    const packs = await this.req(RequestCmd.OBJECT_HEAPHISTO, { objHash });
    const data = this.unpackParallelArrays(packs);
    if (data.length === 0) return [];
    return data
      .filter(row => typeof row["name"] === "string")
      .sort((a, b) => (Number(b["bytes"]) || 0) - (Number(a["bytes"]) || 0))
      .slice(0, 30)
      .map(row => ({
        name: row["name"],
        count: row["count"],
        bytes: row["bytes"],
      }));
  }

  private xlogPacksToObjects(packs: Pack[]): Record<string, unknown>[] {
    return packs.filter((p): p is XLogPack => p.type === "xlog").map(x => ({
      endTime: x.endTime,
      objHash: x.objHash,
      service: x.service,
      txid: x.txid.toString(),
      caller: x.caller.toString(),
      gxid: x.gxid.toString(),
      elapsed: x.elapsed,
      error: x.error,
      cpu: x.cpu,
      sqlCount: x.sqlCount,
      sqlTime: x.sqlTime,
      apicallCount: x.apicallCount,
      apicallTime: x.apicallTime,
      userid: x.userid,
      login: x.login,
      desc: x.desc,
    }));
  }

  private parseProfileSteps(profileBlob: Buffer): Record<string, unknown>[] {
    if (!profileBlob || profileBlob.length === 0) return [];
    const din = new DataInputX(profileBlob);
    const steps: Record<string, unknown>[] = [];
    while (din.available() > 0) {
      const stepType = din.readUnsignedByte();
      const base = {
        parent: din.readDecimal(), index: din.readDecimal(),
        start_time: din.readDecimal(), start_cpu: din.readDecimal(),
      };
      switch (stepType) {
        case StepEnum.METHOD:
        case StepEnum.METHOD2:
          steps.push({ ...base, stepType: "METHOD", hash: din.readDecimal(), elapsed: din.readDecimal(), cputime: din.readDecimal() });
          if (stepType === StepEnum.METHOD2) din.readText(); // additional
          break;
        case StepEnum.SQL:
        case StepEnum.SQL2:
        case StepEnum.SQL3:
          steps.push({ ...base, stepType: "SQL", hash: din.readDecimal(), elapsed: din.readDecimal(), cputime: din.readDecimal(), param: din.readText(), error: din.readDecimal() });
          if (stepType === StepEnum.SQL2 || stepType === StepEnum.SQL3) { din.readByte(); /* xtype */ }
          if (stepType === StepEnum.SQL3) { din.readDecimal(); /* updated rows */ }
          break;
        case StepEnum.MESSAGE:
          steps.push({ ...base, stepType: "MESSAGE", mainValue: din.readText() });
          break;
        case StepEnum.HASHED_MESSAGE:
          steps.push({ ...base, stepType: "HASHED_MESSAGE", hash: din.readDecimal(), elapsed: din.readDecimal(), value: din.readDecimal() });
          break;
        case StepEnum.APICALL:
        case StepEnum.APICALL2: {
          const txid = din.readDecimal();
          const hash = din.readDecimal();
          const elapsed = din.readDecimal();
          const cputime = din.readDecimal();
          const error = din.readDecimal();
          const opt = din.readUnsignedByte();
          let address = "";
          if (opt === 1) address = din.readText();
          steps.push({ ...base, stepType: "APICALL", txid, hash, elapsed, cputime, error, address });
          if (stepType === StepEnum.APICALL2) { din.readDecimal(); din.readText(); }
          break;
        }
        default:
          return steps;
      }
    }
    return steps;
  }

  async lookupTexts(date: string, type: string, hashes: number[]): Promise<Record<string, string>> {
    const map = await this.resolveTexts(date, type, hashes);
    const result: Record<string, string> = {};
    for (const hash of hashes) {
      const text = map.get(hash);
      if (text) result[String(hash)] = text;
    }
    return result;
  }

  private async resolveTexts(date: string, type: string, hashes: number[]): Promise<Map<number, string>> {
    const cacheKey = `${date}:${type}`;
    let cache = this.textCache.get(cacheKey);
    if (!cache) {
      cache = new Map();
      this.textCache.set(cacheKey, cache);
    }
    const missing = hashes.filter(h => !cache!.has(h));
    if (missing.length > 0) {
      for (let i = 0; i < missing.length; i += 100) {
        const batch = missing.slice(i, i + 100);
        const packs = await this.req(RequestCmd.GET_TEXT_100, {
          date, type, hash: batch,
        });
        for (const pack of this.mapPackData(packs)) {
          for (const [key, val] of Object.entries(pack)) {
            if (typeof val === "string") {
              const hashVal = fromHexa32(key);
              cache!.set(hashVal, val);
            }
          }
        }
      }
    }
    return cache;
  }

  private zipTimeValue(times?: number[], values?: number[]): Array<{ time: number; value: number }> {
    if (!times || !values) return [];
    return times.map((t, i) => ({ time: t, value: values[i] ?? 0 }));
  }

  // --- Counter (by objHashes) ---

  async getRealtimeCountersByObjHashes(counters: string, objHashes: string): Promise<unknown> {
    const counterList = counters.replace(/%25/g, "%").split(",");
    const results: unknown[] = [];
    for (const hash of objHashes.split(",").map(Number)) {
      const packs = await this.req(RequestCmd.COUNTER_REAL_TIME_MULTI, {
        objHash: hash, counter: counterList,
      });
      for (const pack of this.mapPackData(packs)) {
        const counterNames = pack["counter"] as string[] | undefined;
        const values = pack["value"] as unknown[] | undefined;
        if (counterNames && values) {
          for (let i = 0; i < counterNames.length; i++) {
            results.push({ objHash: hash, name: counterNames[i], value: values[i] });
          }
        }
      }
    }
    return results;
  }

  async getLatestCounter(counter: string, objType: string, latestSec: number): Promise<unknown> {
    const now = Date.now();
    return this.getCounterHistory(counter, objType, now - latestSec * 1000, now);
  }

  async getLatestCounterByObjHashes(counter: string, objHashes: string, latestSec: number): Promise<unknown> {
    const now = Date.now();
    return this.getCounterHistoryByObjHashes(counter, objHashes, now - latestSec * 1000, now);
  }

  async getCounterHistoryByObjHashes(counter: string, objHashes: string, startMillis: number, endMillis: number): Promise<unknown> {
    const hashList = objHashes.split(",").map(Number);
    const objects = await this.getObjects();
    const packs = await this.req(RequestCmd.COUNTER_PAST_TIME_GROUP, {
      counter, stime: startMillis, etime: endMillis, objHash: hashList,
    });
    return this.mapPackData(packs).map(d => ({
      objHash: d["objHash"],
      objName: objects.find(o => o.objHash === d["objHash"])?.objName,
      valueList: this.zipTimeValue(d["time"] as number[], d["value"] as number[]),
    }));
  }

  async getCounterStatByObjHashes(counter: string, objHashes: string, startYmd: string, _endYmd: string): Promise<unknown> {
    const hashList = objHashes.split(",").map(Number);
    const objects = await this.getObjects();
    const packs = await this.req(RequestCmd.COUNTER_PAST_DATE_GROUP, {
      counter, date: startYmd, objHash: hashList,
    });
    return this.mapPackData(packs).map(d => ({
      objHash: d["objHash"],
      objName: objects.find(o => o.objHash === d["objHash"])?.objName,
      valueList: this.zipTimeValue(d["time"] as number[], d["value"] as number[]),
    }));
  }

  // --- Active thread detail ---

  async getActiveThreadDetail(objHash: number, _threadId: number): Promise<unknown> {
    const packs = await this.req(RequestCmd.OBJECT_THREAD_LIST, { objHash });
    const data = this.mapPackData(packs);
    return data[0] ?? null;
  }

  // --- XLog (realtime decoded) ---

  async getRealtimeXLogData(offset1: number, offset2: number, objHashes: string): Promise<unknown> {
    const now = Date.now();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const sinceTime = offset2 > 0 ? offset2 : now - 10000;
    const xlogs = await this.getXLogData(date, sinceTime, now, objHashes) as Array<Record<string, unknown>>;
    let maxEndTime = sinceTime;
    for (const x of xlogs) {
      const endTime = Number(x.endTime) || 0;
      if (endTime > maxEndTime) maxEndTime = endTime;
    }
    return { xlogs, xlogLoop: 0, xlogIndex: maxEndTime > sinceTime ? maxEndTime + 1 : sinceTime };
  }

  // --- Summary (by objHash) ---

  async getSummaryByObjHash(category: string, objHash: number, startMillis: number, endMillis: number): Promise<unknown> {
    const objects = await this.getObjects();
    const obj = objects.find(o => o.objHash === objHash);
    if (!obj) return [];
    return this.getSummary(category, obj.objType, startMillis, endMillis);
  }

  // --- Visitor ---

  async getVisitorRealtimeByObjType(objType: string): Promise<number> {
    const values = await this.conn.requestValues(RequestCmd.VISITOR_REALTIME_TOTAL, { objType });
    return Number(values[0] ?? 0);
  }

  async getVisitorRealtimeByObjHash(objHash: number): Promise<number> {
    const values = await this.conn.requestValues(RequestCmd.VISITOR_REALTIME, { objHash });
    return Number(values[0] ?? 0);
  }

  async getVisitorRealtimeByObjHashes(objHashes: string): Promise<number> {
    const hashes = objHashes.split(",").map(Number);
    let total = 0;
    for (const h of hashes) {
      const values = await this.conn.requestValues(RequestCmd.VISITOR_REALTIME, { objHash: h });
      total += Number(values[0] ?? 0);
    }
    return total;
  }

  async getVisitorDailyByObjType(objType: string, yyyymmdd: string): Promise<number> {
    const values = await this.conn.requestValues(RequestCmd.VISITOR_LOADDATE_TOTAL, { objType, date: yyyymmdd });
    return Number(values[0] ?? 0);
  }

  async getVisitorDailyByObjHash(objHash: number, yyyymmdd: string): Promise<number> {
    const values = await this.conn.requestValues(RequestCmd.VISITOR_LOADDATE, { objHash, date: yyyymmdd });
    return Number(values[0] ?? 0);
  }

  async getVisitorHourly(objHashes: string, startYmdH: number, endYmdH: number): Promise<unknown[]> {
    const hashList = objHashes.split(",").map(Number);
    const packs = await this.req(RequestCmd.VISITOR_LOADHOUR_GROUP, {
      objHash: hashList, stime: startYmdH, etime: endYmdH,
    });
    return this.mapPackData(packs).map(d => ({
      time: d["time"],
      value: d["value"],
    }));
  }

  async getVisitorGroup(objHashes: string, startYmdH: number, endYmdH: number): Promise<unknown> {
    const hourly = await this.getVisitorHourly(objHashes, startYmdH, endYmdH);
    const values = hourly.flatMap(h => {
      const v = (h as Record<string, unknown>).value;
      return Array.isArray(v) ? v : [v];
    });
    const total = values.reduce((sum: number, v: unknown) => sum + Number(v ?? 0), 0);
    return { time: "total", value: total };
  }

  // --- Interaction counters ---

  async getInteractionCounters(objType: string): Promise<unknown[]> {
    try {
      const packs = await this.req(RequestCmd.INTR_COUNTER_REAL_TIME_BY_OBJ, { objType });
      return this.mapPackData(packs);
    } catch {
      return [];
    }
  }

  async getInteractionCountersByObjHashes(objHashes: string): Promise<unknown[]> {
    try {
      const hashList = objHashes.split(",").map(Number);
      const packs = await this.req(RequestCmd.INTR_COUNTER_REAL_TIME_BY_OBJ, { objHash: hashList });
      return this.mapPackData(packs);
    } catch {
      return [];
    }
  }

  // --- Host / Agent info ---

  async getHostTop(objHash: number): Promise<unknown[]> {
    const packs = await this.req(RequestCmd.HOST_TOP, { objHash });
    return this.mapPackData(packs);
  }

  async getHostDisk(objHash: number): Promise<unknown[]> {
    const packs = await this.req(RequestCmd.HOST_DISK_USAGE, { objHash });
    return this.mapPackData(packs);
  }

  async getThreadList(objHash: number): Promise<unknown[]> {
    const packs = await this.req(RequestCmd.OBJECT_THREAD_LIST, { objHash });
    return this.unpackParallelArrays(packs);
  }

  async getAgentEnv(objHash: number): Promise<unknown[]> {
    const packs = await this.req(RequestCmd.OBJECT_ENV, { objHash });
    return this.mapPackData(packs);
  }

  async getAgentSocket(objHash: number): Promise<unknown[]> {
    const packs = await this.req(RequestCmd.OBJECT_SOCKET, { objHash });
    return this.unpackParallelArrays(packs);
  }

  // --- Raw profile / XLog ---

  async getRawProfile(date: string, txid: string): Promise<unknown> {
    return this.getProfileData(date, txid);
  }

  async getRawXLog(date: string, txid: string): Promise<unknown> {
    return this.getXLogDetail(date, txid);
  }

  async getRawXLogByGxid(date: string, gxid: string): Promise<unknown> {
    return this.getXLogsByGxid(date, gxid);
  }

  async searchRawXLog(date: string, params: Record<string, string>): Promise<unknown> {
    return this.searchXLogData(date, params);
  }

  async getPageableRawXLog(date: string, params: Record<string, string>): Promise<unknown> {
    const startMillis = Number(params.startTimeMillis || 0);
    const endMillis = Number(params.endTimeMillis || Date.now());
    const objHashes = params.objHashes || "";
    return this.getXLogData(date, startMillis, endMillis, objHashes);
  }

  async getRealtimeRawXLog(xlogLoop: number, xlogIndex: number, objHashes: string): Promise<unknown> {
    const now = Date.now();
    const sinceMs = xlogIndex > 0 ? Math.max(xlogIndex, now - 60000) : now - 30000;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return this.getXLogData(date, sinceMs, now, objHashes);
  }

  // --- Unsupported methods (HTTP-only, no TCP commands exist) ---

  getAlertScripting(): Promise<unknown> { return unsupported("getAlertScripting"); }
  readAlertScriptingLog(): Promise<unknown> { return unsupported("readAlertScriptingLog"); }
  getServerConfig(): Promise<unknown> { return unsupported("getServerConfig"); }
  getObjectConfig(): Promise<unknown> { return unsupported("getObjectConfig"); }
  getServerInfo(): Promise<unknown[]> { return unsupported("getServerInfo"); }
  getCounterModel(): Promise<unknown> { return unsupported("getCounterModel"); }
  controlThread(): Promise<unknown> { return unsupported("controlThread"); }
  setServerConfig(): Promise<unknown> { return unsupported("setServerConfig"); }
  setObjectConfig(): Promise<unknown> { return unsupported("setObjectConfig"); }
  setServerConfigKv(): Promise<unknown> { return unsupported("setServerConfigKv"); }
  setTypeConfigKv(): Promise<unknown> { return unsupported("setTypeConfigKv"); }
  setAlertConfigScripting(): Promise<unknown> { return unsupported("setAlertConfigScripting"); }
  setAlertRuleScripting(): Promise<unknown> { return unsupported("setAlertRuleScripting"); }
  removeInactiveAll(): Promise<unknown> { return unsupported("removeInactiveAll"); }
  removeInactiveServer(): Promise<unknown> { return unsupported("removeInactiveServer"); }
  kvGet(): Promise<string> { return unsupported("kvGet"); }
  kvSet(): Promise<boolean> { return unsupported("kvSet"); }
  kvSetTtl(): Promise<boolean> { return unsupported("kvSetTtl"); }
  kvGetBulk(): Promise<unknown[]> { return unsupported("kvGetBulk"); }
  kvSetBulk(): Promise<unknown[]> { return unsupported("kvSetBulk"); }
  kvSpaceGet(): Promise<string> { return unsupported("kvSpaceGet"); }
  kvSpaceSet(): Promise<boolean> { return unsupported("kvSpaceSet"); }
  kvSpaceSetTtl(): Promise<boolean> { return unsupported("kvSpaceSetTtl"); }
  kvSpaceGetBulk(): Promise<unknown[]> { return unsupported("kvSpaceGetBulk"); }
  kvSpaceSetBulk(): Promise<unknown[]> { return unsupported("kvSpaceSetBulk"); }
  kvPrivateGet(): Promise<string> { return unsupported("kvPrivateGet"); }
  kvPrivateSet(): Promise<boolean> { return unsupported("kvPrivateSet"); }
  kvPrivateSetTtl(): Promise<boolean> { return unsupported("kvPrivateSetTtl"); }
  kvPrivateGetBulk(): Promise<unknown[]> { return unsupported("kvPrivateGetBulk"); }
  kvPrivateSetBulk(): Promise<unknown[]> { return unsupported("kvPrivateSetBulk"); }
  getShortener(): Promise<string> { return unsupported("getShortener"); }
  createShortener(): Promise<string> { return unsupported("createShortener"); }
}

function fromHexa32(s: string): number {
  if (s.length === 0) return 0;
  const first = s.charAt(0);
  if (first === "z") return -parseInt(s.substring(1), 32) | 0;
  if (first === "x") return parseInt(s.substring(1), 32) | 0;
  return parseInt(s, 10) | 0;
}
