import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpClient } from "../../client/http.js";

const API_PREFIX = "http://localhost:6180/scouter/v1";

function urlFor(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${API_PREFIX}${path}${sep}serverId=0`;
}

function mockResponse(status: number, body: unknown, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

type FetchCall = [string, RequestInit];

function calls(mock: ReturnType<typeof vi.fn>): FetchCall[] {
  return mock.mock.calls as unknown as FetchCall[];
}

function bodyOf(init: RequestInit): unknown {
  return JSON.parse(init.body as string);
}

describe("HttpClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: HttpClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new HttpClient(API_PREFIX, "", "", 0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------
  // GET (fetchJson) pass-through methods: request shape + result unwrap
  // ---------------------------------------------------------------------
  interface GetCase {
    name: string;
    call: (c: HttpClient) => Promise<unknown>;
    path: string;
  }

  const getCases: GetCase[] = [
    { name: "getObjects", call: c => c.getObjects(), path: "/object" },
    { name: "getRealtimeCounters", call: c => c.getRealtimeCounters("cpu,mem", "java"), path: "/counter/realTime/cpu%2Cmem/ofType/java" },
    { name: "getCounterHistory", call: c => c.getCounterHistory("cpu", "java", 1000, 2000), path: "/counter/cpu/ofType/java?startTimeMillis=1000&endTimeMillis=2000" },
    { name: "getCounterStat", call: c => c.getCounterStat("cpu", "java", "20240101", "20240102"), path: "/counter/stat/cpu/ofType/java?startYmd=20240101&endYmd=20240102" },
    { name: "getActiveServiceStepCount", call: c => c.getActiveServiceStepCount("java"), path: "/activeService/stepCount/ofType/java" },
    { name: "getActiveServices", call: c => c.getActiveServices("java"), path: "/activeService/ofType/java" },
    { name: "getActiveServicesByObj", call: c => c.getActiveServicesByObj(1001), path: "/activeService/ofObject/1001" },
    { name: "getRealtimeAlerts (custom offsets)", call: c => c.getRealtimeAlerts(3, 4), path: "/alert/realTime/3/4" },
    { name: "getXLogDetail", call: c => c.getXLogDetail("20240115", "txid-1"), path: "/xlog-data/20240115/txid-1" },
    { name: "getXLogsByGxid", call: c => c.getXLogsByGxid("20240115", "gxid-1"), path: "/xlog-data/20240115/gxid/gxid-1" },
    { name: "getMultiXLogs", call: c => c.getMultiXLogs("20240115", "t1,t2"), path: "/xlog-data/20240115/multi/t1,t2" },
    { name: "getProfileData", call: c => c.getProfileData("20240115", "txid-1"), path: "/profile-data/20240115/txid-1" },
    { name: "getThreadDump", call: c => c.getThreadDump(1001), path: "/object/threadDump/1001" },
    { name: "getHeapHistogram", call: c => c.getHeapHistogram(1001), path: "/object/heapHistogram/1001" },
    { name: "getVisitorRealtimeByObjType", call: c => c.getVisitorRealtimeByObjType("java"), path: "/visitor/realTime/ofType/java" },
    { name: "getVisitorDailyByObjType", call: c => c.getVisitorDailyByObjType("java", "20240115"), path: "/visitor/20240115/ofType/java" },
    { name: "getVisitorGroup", call: c => c.getVisitorGroup("10,20", 2024010100, 2024010200), path: "/visitor/ofObject/10,20?startYmdH=2024010100&endYmdH=2024010200" },
    { name: "getVisitorHourly", call: c => c.getVisitorHourly("10,20", 2024010100, 2024010200), path: "/visitor/hourly/ofObject/10,20?startYmdH=2024010100&endYmdH=2024010200" },
    { name: "getInteractionCounters", call: c => c.getInteractionCounters("java"), path: "/interactionCounter/realTime/ofType/java" },
    { name: "getHostTop", call: c => c.getHostTop(1001), path: "/object/host/realTime/top/ofObject/1001" },
    { name: "getHostDisk", call: c => c.getHostDisk(1001), path: "/object/host/realTime/disk/ofObject/1001" },
    { name: "getThreadList", call: c => c.getThreadList(1001), path: "/object/threadList/1001" },
    { name: "getAgentEnv", call: c => c.getAgentEnv(1001), path: "/object/env/1001" },
    { name: "getAgentSocket", call: c => c.getAgentSocket(1001), path: "/object/socket/1001" },
    { name: "getServerConfig", call: c => c.getServerConfig(), path: "/configure/server" },
    { name: "getObjectConfig", call: c => c.getObjectConfig(1001), path: "/configure/object/1001" },
    { name: "getServerInfo", call: c => c.getServerInfo(), path: "/info/server" },
    { name: "getCounterModel", call: c => c.getCounterModel(), path: "/info/counter-model" },
    { name: "getAlertScripting", call: c => c.getAlertScripting("cpu alert"), path: "/alert/scripting/cpu%20alert" },
    { name: "readAlertScriptingLog", call: c => c.readAlertScriptingLog(7, 8), path: "/alert/read/scripting/7/8" },
    { name: "getLatestCounter", call: c => c.getLatestCounter("cpu", "java", 60), path: "/counter/cpu/latest/60/ofType/java" },
    { name: "getRealtimeCountersByObjHashes", call: c => c.getRealtimeCountersByObjHashes("cpu,mem", "10,20"), path: "/counter/realTime/cpu%2Cmem?objHashes=10%2C20" },
    { name: "getCounterHistoryByObjHashes", call: c => c.getCounterHistoryByObjHashes("cpu", "10,20", 1000, 2000), path: "/counter/cpu?objHashes=10%2C20&startTimeMillis=1000&endTimeMillis=2000" },
    { name: "getCounterStatByObjHashes", call: c => c.getCounterStatByObjHashes("cpu", "10,20", "20240101", "20240102"), path: "/counter/stat/cpu?objHashes=10%2C20&startYmd=20240101&endYmd=20240102" },
    { name: "getLatestCounterByObjHashes", call: c => c.getLatestCounterByObjHashes("cpu", "10,20", 60), path: "/counter/cpu/latest/60?objHashes=10%2C20" },
    { name: "getRealtimeXLogData", call: c => c.getRealtimeXLogData(3, 4, "10,20"), path: "/xlog-data/realTime/3/4?objHashes=10%2C20" },
    { name: "getActiveThreadDetail", call: c => c.getActiveThreadDetail(1001, 55), path: "/activeService/thread/55/ofObject/1001" },
    { name: "getInteractionCountersByObjHashes", call: c => c.getInteractionCountersByObjHashes("10,20"), path: "/interactionCounter/realTime?objHashes=10%2C20" },
    { name: "getVisitorRealtimeByObjHash", call: c => c.getVisitorRealtimeByObjHash(1001), path: "/visitor/realTime/ofObject/1001" },
    { name: "getVisitorRealtimeByObjHashes", call: c => c.getVisitorRealtimeByObjHashes("10,20"), path: "/visitor/realTime?objHashes=10%2C20" },
    { name: "getVisitorDailyByObjHash", call: c => c.getVisitorDailyByObjHash(1001, "20240115"), path: "/visitor/20240115/ofObject/1001" },
    { name: "controlThread", call: c => c.controlThread(1001, 55, "kill"), path: "/activeService/control/thread/55/ofObject/1001?action=kill" },
    { name: "removeInactiveAll", call: c => c.removeInactiveAll(), path: "/object/remove/inactive" },
    { name: "removeInactiveServer", call: c => c.removeInactiveServer(), path: "/object/remove/inactive/server" },
    { name: "kvGet", call: c => c.kvGet("mykey"), path: "/kv/mykey" },
    { name: "kvGetBulk", call: c => c.kvGetBulk("k1,k2"), path: "/kv/k1%2Ck2/:bulk" },
    { name: "kvSpaceGet", call: c => c.kvSpaceGet("ns1", "mykey"), path: "/kv/space/ns1/mykey" },
    { name: "kvSpaceGetBulk", call: c => c.kvSpaceGetBulk("ns1", "k1,k2"), path: "/kv/space/ns1/k1%2Ck2/:bulk" },
    { name: "kvPrivateGet", call: c => c.kvPrivateGet("mykey"), path: "/kv-private/mykey" },
    { name: "kvPrivateGetBulk", call: c => c.kvPrivateGetBulk("k1,k2"), path: "/kv-private/k1%2Ck2/:bulk" },
    { name: "getRawProfile", call: c => c.getRawProfile("20240115", "txid-1"), path: "/profile/20240115/txid-1" },
    { name: "getRawXLog", call: c => c.getRawXLog("20240115", "txid-1"), path: "/xlog/20240115/txid-1" },
    { name: "getRawXLogByGxid", call: c => c.getRawXLogByGxid("20240115", "gxid-1"), path: "/xlog/20240115/gxid/gxid-1" },
    { name: "getRealtimeRawXLog", call: c => c.getRealtimeRawXLog(3, 4, "10,20"), path: "/xlog/realTime/3/4?objHashes=10%2C20" },
    { name: "getShortener", call: c => c.getShortener("abc"), path: "/shortener/abc" },
  ];

  for (const gc of getCases) {
    it(`${gc.name} builds the expected GET request and unwraps the result`, async () => {
      const body = { sample: "value", n: 1 };
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: body }));
      const result = await gc.call(client);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = calls(fetchMock)[0];
      expect(url).toBe(urlFor(gc.path));
      expect(init.headers).toEqual({ Accept: "application/json" });
      expect(init.method).toBeUndefined();
      expect(result).toEqual(body);
    });
  }

  it("getRealtimeAlerts defaults both offsets to 0", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { result: [] }));
    await client.getRealtimeAlerts();
    expect(calls(fetchMock)[0][0]).toBe(urlFor("/alert/realTime/0/0"));
  });

  it("uses a custom serverId when provided to the constructor", async () => {
    const custom = new HttpClient(API_PREFIX, "", "", 42);
    fetchMock.mockResolvedValueOnce(mockResponse(200, { result: [] }));
    await custom.getObjects();
    expect(calls(fetchMock)[0][0]).toBe(`${API_PREFIX}/object?serverId=42`);
  });

  // ---------------------------------------------------------------------
  // POST / PUT (postJson / putJson) builder methods
  // ---------------------------------------------------------------------
  interface BodyCase {
    name: string;
    call: (c: HttpClient) => Promise<unknown>;
    path: string;
    method: "POST" | "PUT";
    body: unknown;
  }

  const bodyCases: BodyCase[] = [
    { name: "setServerConfig", call: c => c.setServerConfig("a=b"), path: "/configure/set/server", method: "POST", body: { values: "a=b" } },
    { name: "setObjectConfig", call: c => c.setObjectConfig(1001, "a=b"), path: "/configure/set/object/1001", method: "POST", body: { values: "a=b" } },
    { name: "setServerConfigKv", call: c => c.setServerConfigKv("key1", "val1"), path: "/configure/set/kv/server", method: "PUT", body: { key: "key1", value: "val1" } },
    { name: "setTypeConfigKv", call: c => c.setTypeConfigKv("java", "key1", "val1"), path: "/configure/set/kv/ofType/java", method: "PUT", body: { key: "key1", value: "val1" } },
    { name: "setAlertConfigScripting", call: c => c.setAlertConfigScripting("cpu alert", "script-a"), path: "/alert/set/config/scripting/cpu%20alert", method: "POST", body: { values: "script-a" } },
    { name: "setAlertRuleScripting", call: c => c.setAlertRuleScripting("cpu alert", "script-b"), path: "/alert/set/rule/scripting/cpu%20alert", method: "POST", body: { values: "script-b" } },
    { name: "kvSet (default ttl)", call: c => c.kvSet("mykey", "myvalue"), path: "/kv", method: "PUT", body: { key: "mykey", value: "myvalue", ttl: 0 } },
    { name: "kvSetTtl", call: c => c.kvSetTtl("mykey", 120), path: "/kv/mykey/:ttl", method: "PUT", body: { ttl: 120 } },
    { name: "kvSetBulk (default ttl)", call: c => c.kvSetBulk({ a: "1", b: "2" }), path: "/kv/:bulk", method: "PUT", body: { a: "1", b: "2", ttl: 0 } },
    { name: "kvSpaceSet", call: c => c.kvSpaceSet("ns1", "mykey", "myvalue"), path: "/kv/space/ns1", method: "PUT", body: { key: "mykey", value: "myvalue", ttl: 0 } },
    { name: "kvSpaceSetTtl", call: c => c.kvSpaceSetTtl("ns1", "mykey", 120), path: "/kv/space/ns1/mykey/:ttl", method: "PUT", body: { ttl: 120 } },
    { name: "kvSpaceSetBulk", call: c => c.kvSpaceSetBulk("ns1", { a: "1" }), path: "/kv/space/ns1/:bulk", method: "PUT", body: { a: "1", ttl: 0 } },
    { name: "kvPrivateSet", call: c => c.kvPrivateSet("mykey", "myvalue"), path: "/kv-private", method: "PUT", body: { key: "mykey", value: "myvalue", ttl: 0 } },
    { name: "kvPrivateSetTtl", call: c => c.kvPrivateSetTtl("mykey", 120), path: "/kv-private/mykey/:ttl", method: "PUT", body: { ttl: 120 } },
    { name: "kvPrivateSetBulk", call: c => c.kvPrivateSetBulk({ a: "1" }), path: "/kv-private/:bulk", method: "PUT", body: { a: "1", ttl: 0 } },
    { name: "createShortener", call: c => c.createShortener("http://example.com/x"), path: "/shortener?url=http%3A%2F%2Fexample.com%2Fx", method: "POST", body: {} },
  ];

  for (const bc of bodyCases) {
    it(`${bc.name} builds the expected ${bc.method} request and unwraps the result`, async () => {
      const responseBody = { ok: true };
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: responseBody }));
      const result = await bc.call(client);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = calls(fetchMock)[0];
      expect(url).toBe(urlFor(bc.path));
      expect(init.method).toBe(bc.method);
      expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
      expect(bodyOf(init)).toEqual(bc.body);
      expect(result).toEqual(responseBody);
    });
  }

  // ---------------------------------------------------------------------
  // Methods with bespoke response parsing
  // ---------------------------------------------------------------------
  describe("bespoke response parsing", () => {
    it("getXLogData unwraps the xlogs array from the result", async () => {
      const xlogs = [{ txid: "a" }, { txid: "b" }];
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: { xlogs, total: 2 } }));
      const result = await client.getXLogData("20240115", 1000, 2000, "10,20");
      expect(calls(fetchMock)[0][0]).toBe(urlFor("/xlog-data/20240115?startTimeMillis=1000&endTimeMillis=2000&objHashes=10,20"));
      expect(result).toEqual(xlogs);
    });

    it("getXLogData falls back to the raw result when xlogs is absent", async () => {
      const raw = [{ foo: "bar" }];
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: raw }));
      const result = await client.getXLogData("20240115", 1000, 2000, "10,20");
      expect(result).toEqual(raw);
    });

    it("getSummary flattens itemMap values into an array", async () => {
      const itemMap = { obj1: { count: 1 }, obj2: { count: 2 } };
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: { itemMap } }));
      const result = await client.getSummary("cpu", "java", 1000, 2000);
      expect(calls(fetchMock)[0][0]).toBe(urlFor("/summary/cpu/ofType/java?startTimeMillis=1000&endTimeMillis=2000"));
      expect(result).toEqual(Object.values(itemMap));
    });

    it("getSummary returns an empty array when itemMap is missing", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: {} }));
      const result = await client.getSummary("cpu", "java", 1000, 2000);
      expect(result).toEqual([]);
    });

    it("getSummaryByObjHash flattens itemMap values into an array", async () => {
      const itemMap = { obj1: { count: 3 } };
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: { itemMap } }));
      const result = await client.getSummaryByObjHash("cpu", 1001, 1000, 2000);
      expect(calls(fetchMock)[0][0]).toBe(urlFor("/summary/cpu/ofObject/1001?startTimeMillis=1000&endTimeMillis=2000"));
      expect(result).toEqual(Object.values(itemMap));
    });

    it("getSummaryByObjHash returns an empty array when itemMap is missing", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: {} }));
      const result = await client.getSummaryByObjHash("cpu", 1001, 1000, 2000);
      expect(result).toEqual([]);
    });

    it("lookupTexts builds dictKeys from hashes and maps text by dictKey", async () => {
      const items = [
        { textType: "sql", dictKey: 111, text: "SELECT 1" },
        { textType: "sql", dictKey: 222, text: "SELECT 2" },
      ];
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: items }));
      const result = await client.lookupTexts("20240115", "sql", [111, 222]);
      expect(calls(fetchMock)[0][0]).toBe(urlFor("/dictionary/20240115?dictKeys=sql%3A111%2Csql%3A222"));
      expect(result).toEqual({ "111": "SELECT 1", "222": "SELECT 2" });
    });

    it("lookupTexts returns an empty object for an empty result set", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: [] }));
      const result = await client.lookupTexts("20240115", "sql", []);
      expect(result).toEqual({});
    });

    it("searchXLogData filters out falsy params and builds the query string", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: [] }));
      await client.searchXLogData("20240115", { service: "login", ip: "", elapsed: "100" });
      expect(calls(fetchMock)[0][0]).toBe(urlFor("/xlog-data/search/20240115?service=login&elapsed=100"));
    });

    it("searchRawXLog filters out falsy params and builds the query string", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: [] }));
      await client.searchRawXLog("20240115", { service: "login", ip: "", elapsed: "100" });
      expect(calls(fetchMock)[0][0]).toBe(urlFor("/xlog/search/20240115?service=login&elapsed=100"));
    });

    it("getPageableRawXLog filters out falsy params and builds the query string", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: [] }));
      await client.getPageableRawXLog("20240115", { page: "1", filter: "" });
      expect(calls(fetchMock)[0][0]).toBe(urlFor("/xlog/20240115?page=1"));
    });
  });

  // ---------------------------------------------------------------------
  // Authentication flow (login / bearer token)
  // ---------------------------------------------------------------------
  describe("authentication flow", () => {
    it("does not attempt login when apiId is empty", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: [] }));
      await client.getObjects();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("logs in and attaches the bearer token to subsequent requests", async () => {
      const authClient = new HttpClient(API_PREFIX, "user1", "pass1", 0);
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { result: { bearerToken: "tok-123" } }))
        .mockResolvedValueOnce(mockResponse(200, { result: [] }));

      await authClient.getObjects();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [loginUrl, loginInit] = calls(fetchMock)[0];
      expect(loginUrl).toBe(`${API_PREFIX}/user/loginGetToken`);
      expect(loginInit.method).toBe("POST");
      expect(loginInit.headers).toEqual({ "Content-Type": "application/json", "Accept": "application/json" });
      expect(bodyOf(loginInit)).toEqual({ user: { id: "user1", password: "pass1" } });

      const [, reqInit] = calls(fetchMock)[1];
      expect(reqInit.headers).toEqual({ Accept: "application/json", Authorization: "Bearer tok-123" });
    });

    it("throws a descriptive error when login responds with a non-2xx status", async () => {
      const authClient = new HttpClient(API_PREFIX, "user1", "pass1", 0);
      fetchMock.mockResolvedValueOnce(mockResponse(401, { message: "bad creds" }, "Unauthorized"));
      await expect(authClient.getObjects()).rejects.toThrow("Scouter login failed: 401 Unauthorized");
    });

    it("throws when login succeeds but no bearer token is returned", async () => {
      const authClient = new HttpClient(API_PREFIX, "user1", "pass1", 0);
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: {} }));
      await expect(authClient.getObjects()).rejects.toThrow("Scouter login failed: no bearer token");
    });

    it("dedupes concurrent login attempts behind a single in-flight promise", async () => {
      const authClient = new HttpClient(API_PREFIX, "user1", "pass1", 0);
      fetchMock.mockImplementation(async (url: unknown) => {
        if (String(url).includes("/user/loginGetToken")) {
          return mockResponse(200, { result: { bearerToken: "shared-tok" } });
        }
        return mockResponse(200, { result: [] });
      });

      await Promise.all([authClient.getObjects(), authClient.getServerConfig()]);

      const loginCalls = calls(fetchMock).filter(([url]) => url.includes("loginGetToken"));
      expect(loginCalls).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  // ---------------------------------------------------------------------
  // 401 handling: refresh token and retry exactly once
  // ---------------------------------------------------------------------
  describe("401 retry behavior", () => {
    it("fetchJson clears the token, re-authenticates, and retries once on 401", async () => {
      const authClient = new HttpClient(API_PREFIX, "user1", "pass1", 0);
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { result: { bearerToken: "tok-1" } })) // initial login
        .mockResolvedValueOnce(mockResponse(401, {}, "Unauthorized")) // expired token
        .mockResolvedValueOnce(mockResponse(200, { result: { bearerToken: "tok-2" } })) // re-login
        .mockResolvedValueOnce(mockResponse(200, { result: [{ objHash: 1 }] })); // retried request

      const result = await authClient.getObjects();

      expect(fetchMock).toHaveBeenCalledTimes(4);
      const [, lastInit] = calls(fetchMock)[3];
      expect((lastInit.headers as Record<string, string>).Authorization).toBe("Bearer tok-2");
      expect(result).toEqual([{ objHash: 1 }]);
    });

    it("postJson clears the token, re-authenticates, and retries once on 401", async () => {
      const authClient = new HttpClient(API_PREFIX, "user1", "pass1", 0);
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { result: { bearerToken: "tok-1" } }))
        .mockResolvedValueOnce(mockResponse(401, {}, "Unauthorized"))
        .mockResolvedValueOnce(mockResponse(200, { result: { bearerToken: "tok-2" } }))
        .mockResolvedValueOnce(mockResponse(200, { result: "ok" }));

      const result = await authClient.setServerConfig("a=b");

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(result).toBe("ok");
    });

    it("putJson clears the token, re-authenticates, and retries once on 401", async () => {
      const authClient = new HttpClient(API_PREFIX, "user1", "pass1", 0);
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { result: { bearerToken: "tok-1" } }))
        .mockResolvedValueOnce(mockResponse(401, {}, "Unauthorized"))
        .mockResolvedValueOnce(mockResponse(200, { result: { bearerToken: "tok-2" } }))
        .mockResolvedValueOnce(mockResponse(200, { result: true }));

      const result = await authClient.kvSet("mykey", "myvalue");

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(result).toBe(true);
    });

    it("does not retry on 401 when apiId is empty, and surfaces the API error instead", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(401, "boom body", "Unauthorized"));
      await expect(client.getObjects()).rejects.toThrow("Scouter API error: 401 Unauthorized - /object?serverId=0 - boom body");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  // Error paths: non-2xx, malformed JSON, network rejection, empty results
  // ---------------------------------------------------------------------
  describe("error handling", () => {
    it("throws a formatted error for non-2xx responses including body text (fetchJson)", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(500, "boom detail", "Internal Server Error"));
      await expect(client.getServerConfig()).rejects.toThrow(
        "Scouter API error: 500 Internal Server Error - /configure/server?serverId=0 - boom detail",
      );
    });

    it("throws a formatted error for non-2xx responses (postJson)", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(500, { error: "boom" }, "Internal Server Error"));
      await expect(client.setServerConfig("x=1")).rejects.toThrow(
        "Scouter API error: 500 Internal Server Error - /configure/set/server?serverId=0",
      );
    });

    it("throws a formatted error for non-2xx responses (putJson)", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(500, { error: "boom" }, "Internal Server Error"));
      await expect(client.kvSet("k", "v")).rejects.toThrow(
        "Scouter API error: 500 Internal Server Error - /kv?serverId=0",
      );
    });

    it("omits the body suffix when reading the error body itself fails (fetchJson)", async () => {
      const res = {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
        text: async () => { throw new Error("stream closed"); },
      } as unknown as Response;
      fetchMock.mockResolvedValueOnce(res);
      await expect(client.getServerConfig()).rejects.toThrow(
        "Scouter API error: 503 Service Unavailable - /configure/server?serverId=0",
      );
    });

    it("omits the body suffix when reading the error body itself fails (postJson)", async () => {
      const res = {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
        text: async () => { throw new Error("stream closed"); },
      } as unknown as Response;
      fetchMock.mockResolvedValueOnce(res);
      await expect(client.setServerConfig("a=b")).rejects.toThrow(
        "Scouter API error: 503 Service Unavailable - /configure/set/server?serverId=0",
      );
    });

    it("omits the body suffix when reading the error body itself fails (putJson)", async () => {
      const res = {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
        text: async () => { throw new Error("stream closed"); },
      } as unknown as Response;
      fetchMock.mockResolvedValueOnce(res);
      await expect(client.kvSet("k", "v")).rejects.toThrow(
        "Scouter API error: 503 Service Unavailable - /kv?serverId=0",
      );
    });

    it("omits the body suffix when the login error body itself fails to read", async () => {
      const authClient = new HttpClient(API_PREFIX, "user1", "pass1", 0);
      const res = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({}),
        text: async () => { throw new Error("stream closed"); },
      } as unknown as Response;
      fetchMock.mockResolvedValueOnce(res);
      await expect(authClient.getObjects()).rejects.toThrow(
        "Scouter login failed: 500 Internal Server Error",
      );
    });

    it("propagates network rejections untouched", async () => {
      fetchMock.mockRejectedValueOnce(new Error("network down"));
      await expect(client.getObjects()).rejects.toThrow("network down");
    });

    it("propagates malformed JSON parsing errors", async () => {
      const res = {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
        text: async () => "<html>error</html>",
      } as unknown as Response;
      fetchMock.mockResolvedValueOnce(res);
      await expect(client.getObjects()).rejects.toThrow("Unexpected token");
    });

    it("returns an empty array for empty result sets", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { result: [] }));
      const result = await client.getObjects();
      expect(result).toEqual([]);
    });

    it("falls back to the raw body when the result field is absent", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { objType: "java" }));
      const result = await client.getServerConfig();
      expect(result).toEqual({ objType: "java" });
    });
  });
});
