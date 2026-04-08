import type { ScouterClient, ScouterObject } from "./interface.js";

const TIMEOUT_MS = 10_000;

export class HttpClient implements ScouterClient {
  private bearerToken: string;
  private loginInProgress: Promise<string> | null = null;

  constructor(
    private readonly apiPrefix: string,
    private readonly apiId: string,
    private readonly apiPassword: string,
    initialToken: string,
    private readonly serverId: number = 0,
  ) {
    this.bearerToken = initialToken;
  }

  private async login(): Promise<string> {
    const url = `${this.apiPrefix}/user/loginGetToken`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ user: { id: this.apiId, password: this.apiPassword } }),
      });
      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new Error(`Scouter login failed: ${res.status} ${res.statusText}${errorBody ? ` - ${errorBody}` : ""}`);
      }
      const body = await res.json() as Record<string, unknown>;
      const result = body.result as { bearerToken?: string } | undefined;
      if (!result?.bearerToken) throw new Error("Scouter login failed: no bearer token");
      return result.bearerToken;
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureAuth(): Promise<void> {
    if (this.bearerToken || !this.apiId) return;
    if (!this.loginInProgress) {
      this.loginInProgress = this.login().then(token => {
        this.bearerToken = token;
        this.loginInProgress = null;
        return token;
      }).catch(e => { this.loginInProgress = null; throw e; });
    }
    await this.loginInProgress;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (this.bearerToken) headers["Authorization"] = `Bearer ${this.bearerToken}`;
    return headers;
  }

  private stripPrefix(url: string): string {
    return url.startsWith(this.apiPrefix) ? url.slice(this.apiPrefix.length) : url;
  }

  async fetchJson<T>(path: string): Promise<T> {
    await this.ensureAuth();
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.apiPrefix}${path}${sep}serverId=${this.serverId}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let res = await fetch(url, { signal: controller.signal, headers: this.buildHeaders() });
      if (res.status === 401 && this.apiId) {
        this.bearerToken = "";
        await this.ensureAuth();
        res = await fetch(url, { signal: controller.signal, headers: this.buildHeaders() });
      }
      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new Error(`Scouter API error: ${res.status} ${res.statusText} - ${this.stripPrefix(url)}${errorBody ? ` - ${errorBody}` : ""}`);
      }
      const body = await res.json() as Record<string, unknown>;
      return (body.result ?? body) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    await this.ensureAuth();
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.apiPrefix}${path}${sep}serverId=${this.serverId}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let res = await fetch(url, {
        method: "POST", signal: controller.signal,
        headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401 && this.apiId) {
        this.bearerToken = "";
        await this.ensureAuth();
        res = await fetch(url, {
          method: "POST", signal: controller.signal,
          headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new Error(`Scouter API error: ${res.status} ${res.statusText} - ${this.stripPrefix(url)}${errorBody ? ` - ${errorBody}` : ""}`);
      }
      const json = await res.json() as Record<string, unknown>;
      return (json.result ?? json) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async putJson<T>(path: string, body: unknown): Promise<T> {
    await this.ensureAuth();
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.apiPrefix}${path}${sep}serverId=${this.serverId}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let res = await fetch(url, {
        method: "PUT", signal: controller.signal,
        headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401 && this.apiId) {
        this.bearerToken = "";
        await this.ensureAuth();
        res = await fetch(url, {
          method: "PUT", signal: controller.signal,
          headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new Error(`Scouter API error: ${res.status} ${res.statusText} - ${this.stripPrefix(url)}${errorBody ? ` - ${errorBody}` : ""}`);
      }
      const json = await res.json() as Record<string, unknown>;
      return (json.result ?? json) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async getObjects(): Promise<ScouterObject[]> {
    return this.fetchJson<ScouterObject[]>("/object");
  }
  async getRealtimeCounters(counters: string, objType: string) {
    return this.fetchJson(`/counter/realTime/${encodeURIComponent(counters)}/ofType/${objType}`);
  }
  async getCounterHistory(counter: string, objType: string, startMillis: number, endMillis: number) {
    return this.fetchJson(`/counter/${encodeURIComponent(counter)}/ofType/${objType}?startTimeMillis=${startMillis}&endTimeMillis=${endMillis}`);
  }
  async getCounterStat(counter: string, objType: string, startYmd: string, endYmd: string) {
    return this.fetchJson(`/counter/stat/${encodeURIComponent(counter)}/ofType/${objType}?startYmd=${startYmd}&endYmd=${endYmd}`);
  }
  async getActiveServiceStepCount(objType: string) {
    return this.fetchJson(`/activeService/stepCount/ofType/${objType}`);
  }
  async getActiveServices(objType: string) {
    return this.fetchJson(`/activeService/ofType/${objType}`);
  }
  async getActiveServicesByObj(objHash: number) {
    return this.fetchJson(`/activeService/ofObject/${objHash}`);
  }
  async getRealtimeAlerts(offset1 = 0, offset2 = 0) {
    return this.fetchJson(`/alert/realTime/${offset1}/${offset2}`);
  }
  async getXLogData(date: string, startMillis: number, endMillis: number, objHashes: string) {
    const path = `/xlog-data/${date}?startTimeMillis=${startMillis}&endTimeMillis=${endMillis}&objHashes=${objHashes}`;
    const result = await this.fetchJson<Record<string, unknown>>(path);
    return (result?.xlogs ?? result) as unknown[];
  }
  async searchXLogData(date: string, params: Record<string, string>) {
    const qs = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return this.fetchJson(`/xlog-data/search/${date}?${qs}`);
  }
  async getXLogDetail(date: string, txid: string) {
    return this.fetchJson(`/xlog-data/${date}/${txid}`);
  }
  async getXLogsByGxid(date: string, gxid: string) {
    return this.fetchJson(`/xlog-data/${date}/gxid/${gxid}`);
  }
  async getMultiXLogs(date: string, txidList: string) {
    return this.fetchJson(`/xlog-data/${date}/multi/${txidList}`);
  }
  async getProfileData(date: string, txid: string) {
    return this.fetchJson(`/profile-data/${date}/${txid}`);
  }
  async getSummary(category: string, objType: string, startMillis: number, endMillis: number) {
    const result = await this.fetchJson<Record<string, unknown>>(
      `/summary/${category}/ofType/${objType}?startTimeMillis=${startMillis}&endTimeMillis=${endMillis}`,
    );
    const itemMap = result?.itemMap as Record<string, unknown> | undefined;
    return itemMap ? Object.values(itemMap) : [];
  }
  async getThreadDump(objHash: number) {
    return this.fetchJson(`/object/threadDump/${objHash}`);
  }
  async getHeapHistogram(objHash: number) {
    return this.fetchJson(`/object/heapHistogram/${objHash}`);
  }
  async getVisitorRealtimeByObjType(objType: string): Promise<number> {
    return this.fetchJson<number>(`/visitor/realTime/ofType/${objType}`);
  }
  async getVisitorDailyByObjType(objType: string, yyyymmdd: string): Promise<number> {
    return this.fetchJson<number>(`/visitor/${yyyymmdd}/ofType/${objType}`);
  }
  async getVisitorGroup(objHashes: string, startYmdH: number, endYmdH: number): Promise<unknown> {
    return this.fetchJson(
      `/visitor/ofObject/${objHashes}?startYmdH=${startYmdH}&endYmdH=${endYmdH}`,
    );
  }
  async getVisitorHourly(objHashes: string, startYmdH: number, endYmdH: number): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(
      `/visitor/hourly/ofObject/${objHashes}?startYmdH=${startYmdH}&endYmdH=${endYmdH}`,
    );
  }
  async getInteractionCounters(objType: string): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/interactionCounter/realTime/ofType/${objType}`);
  }
  async getHostTop(objHash: number): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/object/host/realTime/top/ofObject/${objHash}`);
  }
  async getHostDisk(objHash: number): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/object/host/realTime/disk/ofObject/${objHash}`);
  }
  async getThreadList(objHash: number): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/object/threadList/${objHash}`);
  }
  async getAgentEnv(objHash: number): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/object/env/${objHash}`);
  }
  async getAgentSocket(objHash: number): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/object/socket/${objHash}`);
  }
  async getServerConfig(): Promise<unknown> {
    return this.fetchJson("/configure/server");
  }
  async getObjectConfig(objHash: number): Promise<unknown> {
    return this.fetchJson(`/configure/object/${objHash}`);
  }
  async getServerInfo(): Promise<unknown[]> {
    return this.fetchJson<unknown[]>("/info/server");
  }
  async getCounterModel(): Promise<unknown> {
    return this.fetchJson("/info/counter-model");
  }
  async getAlertScripting(counterName: string): Promise<unknown> {
    return this.fetchJson(`/alert/scripting/${encodeURIComponent(counterName)}`);
  }
  async readAlertScriptingLog(loop: number, index: number): Promise<unknown> {
    return this.fetchJson(`/alert/read/scripting/${loop}/${index}`);
  }
  async getLatestCounter(counter: string, objType: string, latestSec: number) {
    return this.fetchJson(
      `/counter/${encodeURIComponent(counter)}/latest/${latestSec}/ofType/${objType}`,
    );
  }
  async getRealtimeCountersByObjHashes(counters: string, objHashes: string) {
    return this.fetchJson(
      `/counter/realTime/${encodeURIComponent(counters)}?objHashes=${encodeURIComponent(objHashes)}`,
    );
  }
  async getCounterHistoryByObjHashes(counter: string, objHashes: string, startMillis: number, endMillis: number) {
    return this.fetchJson(
      `/counter/${encodeURIComponent(counter)}?objHashes=${encodeURIComponent(objHashes)}&startTimeMillis=${startMillis}&endTimeMillis=${endMillis}`,
    );
  }
  async getCounterStatByObjHashes(counter: string, objHashes: string, startYmd: string, endYmd: string) {
    return this.fetchJson(
      `/counter/stat/${encodeURIComponent(counter)}?objHashes=${encodeURIComponent(objHashes)}&startYmd=${startYmd}&endYmd=${endYmd}`,
    );
  }
  async getLatestCounterByObjHashes(counter: string, objHashes: string, latestSec: number) {
    return this.fetchJson(
      `/counter/${encodeURIComponent(counter)}/latest/${latestSec}?objHashes=${encodeURIComponent(objHashes)}`,
    );
  }
  async getSummaryByObjHash(category: string, objHash: number, startMillis: number, endMillis: number) {
    const result = await this.fetchJson<Record<string, unknown>>(
      `/summary/${category}/ofObject/${objHash}?startTimeMillis=${startMillis}&endTimeMillis=${endMillis}`,
    );
    const itemMap = result?.itemMap as Record<string, unknown> | undefined;
    return itemMap ? Object.values(itemMap) : [];
  }
  async getRealtimeXLogData(offset1: number, offset2: number, objHashes: string) {
    return this.fetchJson(
      `/xlog-data/realTime/${offset1}/${offset2}?objHashes=${encodeURIComponent(objHashes)}`,
    );
  }
  async getActiveThreadDetail(objHash: number, threadId: number) {
    return this.fetchJson(`/activeService/thread/${threadId}/ofObject/${objHash}`);
  }
  async getInteractionCountersByObjHashes(objHashes: string): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(
      `/interactionCounter/realTime?objHashes=${encodeURIComponent(objHashes)}`,
    );
  }
  async getVisitorRealtimeByObjHash(objHash: number): Promise<number> {
    return this.fetchJson<number>(`/visitor/realTime/ofObject/${objHash}`);
  }
  async getVisitorRealtimeByObjHashes(objHashes: string): Promise<number> {
    return this.fetchJson<number>(`/visitor/realTime?objHashes=${encodeURIComponent(objHashes)}`);
  }
  async getVisitorDailyByObjHash(objHash: number, yyyymmdd: string): Promise<number> {
    return this.fetchJson<number>(`/visitor/${yyyymmdd}/ofObject/${objHash}`);
  }
  async lookupTexts(date: string, type: string, hashes: number[]): Promise<Record<string, string>> {
    const dictKeys = hashes.map(h => `${type}:${h}`).join(",");
    const items = await this.fetchJson<Array<{ textType: string; dictKey: number; text: string }>>(
      `/dictionary/${date}?dictKeys=${encodeURIComponent(dictKeys)}`,
    );
    const result: Record<string, string> = {};
    for (const item of items) {
      result[String(item.dictKey)] = item.text;
    }
    return result;
  }

  // --- Write operations ---

  async controlThread(objHash: number, threadId: number, action: string): Promise<unknown> {
    return this.fetchJson(`/activeService/control/thread/${threadId}/ofObject/${objHash}?action=${encodeURIComponent(action)}`);
  }
  async setServerConfig(values: string): Promise<unknown> {
    return this.postJson("/configure/set/server", { values });
  }
  async setObjectConfig(objHash: number, values: string): Promise<unknown> {
    return this.postJson(`/configure/set/object/${objHash}`, { values });
  }
  async setServerConfigKv(key: string, value: string): Promise<unknown> {
    return this.putJson("/configure/set/kv/server", { key, value });
  }
  async setTypeConfigKv(objType: string, key: string, value: string): Promise<unknown> {
    return this.putJson(`/configure/set/kv/ofType/${encodeURIComponent(objType)}`, { key, value });
  }
  async setAlertConfigScripting(counterName: string, values: string): Promise<unknown> {
    return this.postJson(`/alert/set/config/scripting/${encodeURIComponent(counterName)}`, { values });
  }
  async setAlertRuleScripting(counterName: string, values: string): Promise<unknown> {
    return this.postJson(`/alert/set/rule/scripting/${encodeURIComponent(counterName)}`, { values });
  }
  async removeInactiveAll(): Promise<unknown> {
    return this.fetchJson("/object/remove/inactive");
  }
  async removeInactiveServer(): Promise<unknown> {
    return this.fetchJson("/object/remove/inactive/server");
  }

  // --- KV Store (Global) ---

  async kvGet(key: string): Promise<string> {
    return this.fetchJson<string>(`/kv/${encodeURIComponent(key)}`);
  }
  async kvSet(key: string, value: string, ttl = 0): Promise<boolean> {
    return this.putJson<boolean>("/kv", { key, value, ttl });
  }
  async kvSetTtl(key: string, ttl: number): Promise<boolean> {
    return this.putJson<boolean>(`/kv/${encodeURIComponent(key)}/:ttl`, { ttl });
  }
  async kvGetBulk(keys: string): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/kv/${encodeURIComponent(keys)}/:bulk`);
  }
  async kvSetBulk(kvs: Record<string, string>, ttl = 0): Promise<unknown[]> {
    return this.putJson<unknown[]>("/kv/:bulk", { ...kvs, ttl });
  }

  // --- KV Store (Custom/Namespaced) ---

  async kvSpaceGet(keySpace: string, key: string): Promise<string> {
    return this.fetchJson<string>(`/kv/space/${encodeURIComponent(keySpace)}/${encodeURIComponent(key)}`);
  }
  async kvSpaceSet(keySpace: string, key: string, value: string, ttl = 0): Promise<boolean> {
    return this.putJson<boolean>(`/kv/space/${encodeURIComponent(keySpace)}`, { key, value, ttl });
  }
  async kvSpaceSetTtl(keySpace: string, key: string, ttl: number): Promise<boolean> {
    return this.putJson<boolean>(`/kv/space/${encodeURIComponent(keySpace)}/${encodeURIComponent(key)}/:ttl`, { ttl });
  }
  async kvSpaceGetBulk(keySpace: string, keys: string): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/kv/space/${encodeURIComponent(keySpace)}/${encodeURIComponent(keys)}/:bulk`);
  }
  async kvSpaceSetBulk(keySpace: string, kvs: Record<string, string>, ttl = 0): Promise<unknown[]> {
    return this.putJson<unknown[]>(`/kv/space/${encodeURIComponent(keySpace)}/:bulk`, { ...kvs, ttl });
  }

  // --- KV Store (Private) ---

  async kvPrivateGet(key: string): Promise<string> {
    return this.fetchJson<string>(`/kv-private/${encodeURIComponent(key)}`);
  }
  async kvPrivateSet(key: string, value: string, ttl = 0): Promise<boolean> {
    return this.putJson<boolean>("/kv-private", { key, value, ttl });
  }
  async kvPrivateSetTtl(key: string, ttl: number): Promise<boolean> {
    return this.putJson<boolean>(`/kv-private/${encodeURIComponent(key)}/:ttl`, { ttl });
  }
  async kvPrivateGetBulk(keys: string): Promise<unknown[]> {
    return this.fetchJson<unknown[]>(`/kv-private/${encodeURIComponent(keys)}/:bulk`);
  }
  async kvPrivateSetBulk(kvs: Record<string, string>, ttl = 0): Promise<unknown[]> {
    return this.putJson<unknown[]>("/kv-private/:bulk", { ...kvs, ttl });
  }

  // --- Raw Profile ---

  async getRawProfile(date: string, txid: string): Promise<unknown> {
    return this.fetchJson(`/profile/${date}/${txid}`);
  }

  // --- Raw XLog ---

  async getRawXLog(date: string, txid: string): Promise<unknown> {
    return this.fetchJson(`/xlog/${date}/${txid}`);
  }
  async getRawXLogByGxid(date: string, gxid: string): Promise<unknown> {
    return this.fetchJson(`/xlog/${date}/gxid/${gxid}`);
  }
  async searchRawXLog(date: string, params: Record<string, string>): Promise<unknown> {
    const qs = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return this.fetchJson(`/xlog/search/${date}?${qs}`);
  }
  async getPageableRawXLog(date: string, params: Record<string, string>): Promise<unknown> {
    const qs = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return this.fetchJson(`/xlog/${date}?${qs}`);
  }
  async getRealtimeRawXLog(xlogLoop: number, xlogIndex: number, objHashes: string): Promise<unknown> {
    return this.fetchJson(`/xlog/realTime/${xlogLoop}/${xlogIndex}?objHashes=${encodeURIComponent(objHashes)}`);
  }

  // --- URL Shortener ---

  async getShortener(key: string): Promise<string> {
    return this.fetchJson<string>(`/shortener/${encodeURIComponent(key)}`);
  }
  async createShortener(url: string): Promise<string> {
    return this.postJson<string>(`/shortener?url=${encodeURIComponent(url)}`, {});
  }
}
