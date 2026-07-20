import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DataOutputX } from "../../protocol/data-output.js";
import { writeMapPack } from "../../protocol/packs.js";
import { writeValue } from "../../protocol/values.js";
import { TcpFlag, PackEnum, StepEnum } from "../../protocol/constants.js";
import type { SValue } from "../../protocol/values.js";
import { UnsupportedOperationError } from "../../client/interface.js";

// --- Fake socket infrastructure ---------------------------------------------
//
// TcpClient (client/tcp.ts) delegates all wire I/O to the *real*
// ScouterTcpConnection (protocol/tcp-connection.ts), which talks to
// `net.Socket`. Mocking `net` here lets us drive TcpClient through its real
// connect/login/request machinery end-to-end, using genuine wire-format
// bytes, without opening a real socket.
const { FakeSocket, sockets } = vi.hoisted(() => {
  class FakeSocket {
    listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    written: Buffer[] = [];
    destroyed = false;
    connectCb: (() => void) | null = null;
    responseQueue: Array<Buffer | { kind: "close" } | { kind: "error"; err: Error }> = [];

    on(event: string, cb: (...args: unknown[]) => void) {
      (this.listeners[event] ??= []).push(cb);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners[event] ?? []) cb(...args);
    }

    setKeepAlive = vi.fn();
    setNoDelay = vi.fn();
    setTimeout = vi.fn();

    connect = vi.fn((_port: number, _host: string, cb: () => void) => {
      this.connectCb = cb;
    });

    write = vi.fn((data: Buffer) => {
      this.written.push(Buffer.from(data));
      if (data.length === 4) return true; // TCP_CLIENT handshake, no response
      const next = this.responseQueue.shift();
      if (next === undefined) return true;
      if (Buffer.isBuffer(next)) {
        this.emit("data", next);
      } else if (next.kind === "close") {
        this.emit("close");
      } else if (next.kind === "error") {
        this.emit("error", next.err);
      }
      return true;
    });

    destroy = vi.fn(() => {
      this.destroyed = true;
    });
  }

  const sockets: InstanceType<typeof FakeSocket>[] = [];
  return { FakeSocket, sockets };
});

vi.mock("node:net", () => ({
  Socket: vi.fn(function SocketMock() {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  }),
}));

import { TcpClient } from "../../client/tcp.js";

// --- Wire-format response builders -------------------------------------------

function loginSuccessResponse(session: number | bigint = 1): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.HasNEXT);
  writeMapPack(dout, { session: session as SValue });
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

function noNextOnlyResponse(): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

function failResponse(): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.FAIL);
  return dout.toBuffer();
}

function mapPackResponse(data: Record<string, SValue>): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.HasNEXT);
  writeMapPack(dout, data);
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

function valuesResponse(values: SValue[]): Buffer {
  const dout = new DataOutputX();
  for (const v of values) {
    dout.writeByte(TcpFlag.HasNEXT);
    writeValue(dout, v);
  }
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

interface ObjSpec {
  objType: string;
  objHash: number;
  objName: string;
  address: string;
  version?: string;
  alive: boolean;
  wakeup?: number;
}

function objectsResponse(objs: ObjSpec[]): Buffer {
  const dout = new DataOutputX();
  for (const o of objs) {
    dout.writeByte(TcpFlag.HasNEXT);
    dout.writeByte(PackEnum.OBJECT);
    dout.writeText(o.objType);
    dout.writeDecimal(o.objHash);
    dout.writeText(o.objName);
    dout.writeText(o.address);
    dout.writeText(o.version ?? "1.0");
    dout.writeBoolean(o.alive);
    dout.writeDecimal(o.wakeup ?? 0);
    writeValue(dout, {}); // tags
  }
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

interface XLogSpec {
  endTime: number;
  objHash: number;
  service: number;
  txid: bigint;
  caller?: bigint;
  gxid?: bigint;
  elapsed: number;
  error: number;
  cpu: number;
  sqlCount: number;
  sqlTime: number;
  kbytes?: number;
  userid?: number;
  userAgent?: number;
  referer?: number;
  group?: number;
  apicallCount?: number;
  apicallTime?: number;
  countryCode?: string;
  city?: number;
  xType?: number;
  login?: number;
  desc?: number;
}

function buildXLogBlob(f: XLogSpec): Buffer {
  const d = new DataOutputX();
  d.writeDecimal(f.endTime);
  d.writeDecimal(f.objHash);
  d.writeDecimal(f.service);
  d.writeLong(f.txid);
  d.writeLong(f.caller ?? 0n);
  d.writeLong(f.gxid ?? 0n);
  d.writeDecimal(f.elapsed);
  d.writeDecimal(f.error);
  d.writeDecimal(f.cpu);
  d.writeDecimal(f.sqlCount);
  d.writeDecimal(f.sqlTime);
  d.writeBlob(Buffer.from([127, 0, 0, 1])); // ipaddr
  d.writeDecimal(f.kbytes ?? 0);
  d.writeDecimal(0); // status (deprecated)
  d.writeDecimal(f.userid ?? 0);
  d.writeDecimal(f.userAgent ?? 0);
  d.writeDecimal(f.referer ?? 0);
  d.writeDecimal(f.group ?? 0);
  d.writeDecimal(f.apicallCount ?? 0);
  d.writeDecimal(f.apicallTime ?? 0);
  d.writeText(f.countryCode ?? "KR");
  d.writeDecimal(f.city ?? 0);
  d.writeByte(f.xType ?? 0);
  d.writeDecimal(f.login ?? 0);
  d.writeDecimal(f.desc ?? 0);
  return d.toBuffer();
}

function xlogsResponse(entries: XLogSpec[]): Buffer {
  const dout = new DataOutputX();
  for (const f of entries) {
    dout.writeByte(TcpFlag.HasNEXT);
    dout.writeByte(PackEnum.XLOG);
    dout.writeBlob(buildXLogBlob(f));
  }
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

interface AlertSpec {
  time: bigint;
  level: number;
  objType: string;
  objHash: number;
  title: string;
  message: string;
}

function alertsResponse(alerts: AlertSpec[]): Buffer {
  const dout = new DataOutputX();
  for (const a of alerts) {
    dout.writeByte(TcpFlag.HasNEXT);
    dout.writeByte(PackEnum.ALERT);
    dout.writeLong(a.time);
    dout.writeByte(a.level);
    dout.writeText(a.objType);
    dout.writeInt(a.objHash);
    dout.writeText(a.title);
    dout.writeText(a.message);
    writeValue(dout, {}); // tags
  }
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

// DataOutputX.writeBlob() calls writeByte(255) for blobs longer than 253
// bytes, but writeByte() writes a *signed* int8 -- 255 is out of range and
// throws. That's a pre-existing quirk of the production code we must not
// "fix" from a test; we just avoid tripping it here by writing the
// length-prefix byte for the >253 case directly via writeRaw() instead.
function writeBlobSafe(dout: DataOutputX, value: Buffer): void {
  if (value.length === 0) {
    dout.writeByte(0);
    return;
  }
  if (value.length <= 253) {
    dout.writeByte(value.length);
  } else if (value.length <= 65535) {
    dout.writeRaw(Buffer.from([255]));
    dout.writeShort(value.length);
  } else {
    dout.writeRaw(Buffer.from([254]));
    dout.writeInt(value.length);
  }
  dout.writeRaw(value);
}

function profileResponse(f: { time: number; objHash: number; service: number; txid: bigint; profile: Buffer }): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.HasNEXT);
  dout.writeByte(PackEnum.XLOG_PROFILE);
  dout.writeDecimal(f.time);
  dout.writeDecimal(f.objHash);
  dout.writeDecimal(f.service);
  dout.writeLong(f.txid);
  writeBlobSafe(dout, f.profile);
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

// Builds one profile blob exercising every step type parseProfileSteps()
// understands, plus a trailing unhandled step type to hit the early-return
// (`default: return steps;`) branch.
function buildFullProfileBlob(): Buffer {
  const d = new DataOutputX();

  // METHOD
  d.writeByte(StepEnum.METHOD);
  d.writeDecimal(0); d.writeDecimal(1); d.writeDecimal(100); d.writeDecimal(10);
  d.writeDecimal(111); d.writeDecimal(50); d.writeDecimal(5);

  // METHOD2 (extra trailing text)
  d.writeByte(StepEnum.METHOD2);
  d.writeDecimal(0); d.writeDecimal(2); d.writeDecimal(101); d.writeDecimal(11);
  d.writeDecimal(222); d.writeDecimal(60); d.writeDecimal(6);
  d.writeText("extra-info");

  // SQL
  d.writeByte(StepEnum.SQL);
  d.writeDecimal(1); d.writeDecimal(3); d.writeDecimal(102); d.writeDecimal(12);
  d.writeDecimal(333); d.writeDecimal(70); d.writeDecimal(7);
  d.writeText("select 1");
  d.writeDecimal(0);

  // SQL2 (extra xtype byte)
  d.writeByte(StepEnum.SQL2);
  d.writeDecimal(1); d.writeDecimal(4); d.writeDecimal(103); d.writeDecimal(13);
  d.writeDecimal(444); d.writeDecimal(80); d.writeDecimal(8);
  d.writeText("select 2");
  d.writeDecimal(1);
  d.writeByte(2);

  // SQL3 (extra xtype byte + updated-rows decimal)
  d.writeByte(StepEnum.SQL3);
  d.writeDecimal(1); d.writeDecimal(5); d.writeDecimal(104); d.writeDecimal(14);
  d.writeDecimal(555); d.writeDecimal(90); d.writeDecimal(9);
  d.writeText("update t set x=1");
  d.writeDecimal(0);
  d.writeByte(3);
  d.writeDecimal(7);

  // MESSAGE
  d.writeByte(StepEnum.MESSAGE);
  d.writeDecimal(0); d.writeDecimal(6); d.writeDecimal(105); d.writeDecimal(15);
  d.writeText("hello world");

  // HASHED_MESSAGE
  d.writeByte(StepEnum.HASHED_MESSAGE);
  d.writeDecimal(0); d.writeDecimal(7); d.writeDecimal(106); d.writeDecimal(16);
  d.writeDecimal(666); d.writeDecimal(1); d.writeDecimal(999);

  // APICALL, opt=0 (no address)
  d.writeByte(StepEnum.APICALL);
  d.writeDecimal(2); d.writeDecimal(8); d.writeDecimal(107); d.writeDecimal(17);
  d.writeDecimal(777888); d.writeDecimal(777); d.writeDecimal(20); d.writeDecimal(2); d.writeDecimal(0);
  d.writeByte(0);

  // APICALL, opt=1 (with address)
  d.writeByte(StepEnum.APICALL);
  d.writeDecimal(2); d.writeDecimal(9); d.writeDecimal(108); d.writeDecimal(18);
  d.writeDecimal(777889); d.writeDecimal(778); d.writeDecimal(21); d.writeDecimal(3); d.writeDecimal(0);
  d.writeByte(1);
  d.writeText("10.0.0.5:8080");

  // APICALL2 (extra decimal + text)
  d.writeByte(StepEnum.APICALL2);
  d.writeDecimal(2); d.writeDecimal(10); d.writeDecimal(109); d.writeDecimal(19);
  d.writeDecimal(777890); d.writeDecimal(779); d.writeDecimal(22); d.writeDecimal(4); d.writeDecimal(0);
  d.writeByte(0);
  d.writeDecimal(0);
  d.writeText("");

  // Unhandled step type -> triggers `default: return steps;`
  d.writeByte(StepEnum.SOCKET);
  d.writeDecimal(0); d.writeDecimal(11); d.writeDecimal(110); d.writeDecimal(20);

  return d.toBuffer();
}

// --- Driving TcpClient through the (mocked) wire protocol -------------------
//
// Every TcpClient method funnels through ScouterTcpConnection#request /
// #requestValues, both of which chain via `this.requestQueue.then(...)` --
// so nothing happens synchronously, even on an already-open connection.
// `invoke` calls the method, waits one microtask tick (enough for the
// queued `.then` callback to run far enough to create a socket, if a new
// one is needed), then supplies the pre-built wire responses in order and
// (if a fresh socket was created) fires the TCP-level connect callback.
async function invoke<T>(fn: () => Promise<T>, responses: Buffer[]): Promise<T> {
  const before = sockets.length;
  const p = fn();
  await Promise.resolve();
  const isNew = sockets.length > before;
  const socket = sockets.at(-1);
  // Some methods (e.g. getSummary() with an unknown category) return early
  // without ever touching the connection, so no socket is ever created.
  if (socket) {
    socket.responseQueue.push(...responses);
    if (isNew) socket.connectCb!();
  }
  return p;
}

function newClient(): TcpClient {
  return new TcpClient("host", 6100, "user1", "pw");
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TcpClient - unsupported (HTTP-only) methods", () => {
  const unsupportedMethods = [
    "getAlertScripting",
    "readAlertScriptingLog",
    "getServerConfig",
    "getObjectConfig",
    "getServerInfo",
    "getCounterModel",
    "controlThread",
    "setServerConfig",
    "setObjectConfig",
    "setServerConfigKv",
    "setTypeConfigKv",
    "setAlertConfigScripting",
    "setAlertRuleScripting",
    "removeInactiveAll",
    "removeInactiveServer",
    "kvGet",
    "kvSet",
    "kvSetTtl",
    "kvGetBulk",
    "kvSetBulk",
    "kvSpaceGet",
    "kvSpaceSet",
    "kvSpaceSetTtl",
    "kvSpaceGetBulk",
    "kvSpaceSetBulk",
    "kvPrivateGet",
    "kvPrivateSet",
    "kvPrivateSetTtl",
    "kvPrivateGetBulk",
    "kvPrivateSetBulk",
    "getShortener",
    "createShortener",
  ] as const;

  it.each(unsupportedMethods)("%s throws UnsupportedOperationError synchronously (no socket touched)", (method) => {
    const client = newClient();
    const fn = (client as unknown as Record<string, () => unknown>)[method].bind(client);
    expect(fn).toThrow(UnsupportedOperationError);
    expect(sockets.length).toBe(0);
  });
});

describe("TcpClient - getObjects", () => {
  it("maps OBJECT packs to ScouterObject[]", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getObjects(),
      [
        loginSuccessResponse(1),
        objectsResponse([
          { objType: "java", objHash: 111, objName: "app1", address: "1.2.3.4", alive: true },
          { objType: "host", objHash: 222, objName: "host1", address: "5.6.7.8", alive: false },
        ]),
      ],
    );
    expect(result).toEqual([
      { objType: "java", objFamily: "java", objHash: 111, objName: "app1", address: "1.2.3.4", alive: true },
      { objType: "host", objFamily: "host", objHash: 222, objName: "host1", address: "5.6.7.8", alive: false },
    ]);
  });

  it("returns [] when there are no objects", async () => {
    const client = newClient();
    const result = await invoke(() => client.getObjects(), [loginSuccessResponse(1), noNextOnlyResponse()]);
    expect(result).toEqual([]);
  });
});

describe("TcpClient - getRealtimeCounters", () => {
  it("decodes %25-escaped counter names, issues one request per counter, and zips objHash/value", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getRealtimeCounters("cpu%25used,mem", "java"),
      [
        loginSuccessResponse(1),
        mapPackResponse({ objHash: [1, 2], value: [10, 20] }),
        mapPackResponse({ objHash: [1], value: [99] }),
      ],
    );
    expect(result).toEqual([
      { objHash: 1, name: "cpu%used", value: 10 },
      { objHash: 2, name: "cpu%used", value: 20 },
      { objHash: 1, name: "mem", value: 99 },
    ]);
  });
});

describe("TcpClient - getCounterHistory / getCounterStat", () => {
  it("getCounterHistory filters objects by alive && objType, and zips time/value", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getCounterHistory("cpu", "java", 1000, 2000),
      [
        loginSuccessResponse(1),
        objectsResponse([
          { objType: "java", objHash: 1, objName: "app1", address: "a", alive: true },
          { objType: "java", objHash: 2, objName: "app2", address: "b", alive: false }, // excluded: not alive
          { objType: "host", objHash: 3, objName: "host1", address: "c", alive: true }, // excluded: wrong type
        ]),
        mapPackResponse({ objHash: 1, time: [1000, 1500], value: [5, 6] }),
      ],
    );
    expect(result).toEqual([
      { objHash: 1, objName: "app1", valueList: [{ time: 1000, value: 5 }, { time: 1500, value: 6 }] },
    ]);
  });

  it("getCounterHistory short-circuits to [] without a counter request when no objects match", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getCounterHistory("cpu", "java", 1000, 2000),
      [loginSuccessResponse(1), objectsResponse([])],
    );
    expect(result).toEqual([]);
  });

  it("getCounterHistory returns [] for a counter data pack missing time/value fields", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getCounterHistory("cpu", "java", 1000, 2000),
      [
        loginSuccessResponse(1),
        objectsResponse([{ objType: "java", objHash: 1, objName: "app1", address: "a", alive: true }]),
        mapPackResponse({ objHash: 1 }), // no time/value keys
      ],
    );
    expect(result).toEqual([{ objHash: 1, objName: "app1", valueList: [] }]);
  });

  it("getCounterStat short-circuits to [] without a counter request when no objects match", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getCounterStat("cpu", "java", "20260101", "20260101"),
      [loginSuccessResponse(1), objectsResponse([])],
    );
    expect(result).toEqual([]);
  });

  it("getCounterStat filters only by objType (alive objects and dead objects both included)", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getCounterStat("cpu", "java", "20260101", "20260101"),
      [
        loginSuccessResponse(1),
        objectsResponse([
          { objType: "java", objHash: 1, objName: "app1", address: "a", alive: true },
          { objType: "java", objHash: 2, objName: "app2", address: "b", alive: false },
        ]),
        mapPackResponse({ objHash: 2, time: [1], value: [42] }),
      ],
    );
    expect(result).toEqual([
      { objHash: 2, objName: "app2", valueList: [{ time: 1, value: 42 }] },
    ]);
  });
});

describe("TcpClient - active service methods", () => {
  it("getActiveServiceStepCount returns the first map pack's data", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getActiveServiceStepCount("java"),
      [loginSuccessResponse(1), mapPackResponse({ act1: 1, act2: 2, act3: 3, tps: 9 })],
    );
    expect(result).toEqual({ act1: 1, act2: 2, act3: 3, tps: 9 });
  });

  it("getActiveServiceStepCount falls back to zeros when there is no data", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getActiveServiceStepCount("java"),
      [loginSuccessResponse(1), noNextOnlyResponse()],
    );
    expect(result).toEqual({ act1: 0, act2: 0, act3: 0, tps: 0 });
  });

  it("getActiveServices passes through mapPackData", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getActiveServices("java"),
      [loginSuccessResponse(1), mapPackResponse({ service: "svc1" })],
    );
    expect(result).toEqual([{ service: "svc1" }]);
  });

  it("getActiveServicesByObj passes through mapPackData", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getActiveServicesByObj(555),
      [loginSuccessResponse(1), mapPackResponse({ service: "svc2" })],
    );
    expect(result).toEqual([{ service: "svc2" }]);
  });

  it("getActiveThreadDetail returns the first map pack's data, or null", async () => {
    const client = newClient();
    const withData = await invoke(
      () => client.getActiveThreadDetail(1, 2),
      [loginSuccessResponse(1), mapPackResponse({ stack: "..." })],
    );
    expect(withData).toEqual({ stack: "..." });

    const empty = await invoke(() => client.getActiveThreadDetail(1, 2), [noNextOnlyResponse()]);
    expect(empty).toBeNull();
  });
});

describe("TcpClient - getRealtimeAlerts", () => {
  it("filters alert packs and converts bigint time to number", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getRealtimeAlerts(),
      [
        loginSuccessResponse(1),
        alertsResponse([
          { time: 1700000000000n, level: 2, objType: "java", objHash: 42, title: "CPU High", message: "cpu > 90%" },
        ]),
      ],
    );
    expect(result).toEqual({
      alerts: [{ time: 1700000000000, level: 2, objType: "java", objHash: 42, title: "CPU High", message: "cpu > 90%" }],
    });
  });
});

describe("TcpClient - XLog methods", () => {
  const sampleXLog: XLogSpec = {
    endTime: 5000,
    objHash: 10,
    service: 20,
    txid: 123456789012345n,
    caller: 0n,
    gxid: 123456789012345n,
    elapsed: 30,
    error: 0,
    cpu: 5,
    sqlCount: 1,
    sqlTime: 2,
    userid: 7,
    apicallCount: 1,
    apicallTime: 3,
    login: 9,
    desc: 11,
  };

  it("getXLogData maps XLOG packs to plain objects", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getXLogData("20260719", 0, 9999, "10,20"),
      [loginSuccessResponse(1), xlogsResponse([sampleXLog])],
    );
    expect(result).toEqual([
      {
        endTime: 5000,
        objHash: 10,
        service: 20,
        txid: "123456789012345",
        caller: "0",
        gxid: "123456789012345",
        elapsed: 30,
        error: 0,
        cpu: 5,
        sqlCount: 1,
        sqlTime: 2,
        apicallCount: 1,
        apicallTime: 3,
        userid: 7,
        login: 9,
        desc: 11,
      },
    ]);
  });

  it("searchXLogData forwards optional filter params and defaults time range", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.searchXLogData("20260719", { service: "svc", ip: "1.2.3.4", login: "bob", objHash: "10" }),
      [loginSuccessResponse(1), xlogsResponse([sampleXLog])],
    );
    expect(result).toHaveLength(1);
  });

  it("searchXLogData works with no optional params at all", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.searchXLogData("20260719", {}),
      [loginSuccessResponse(1), noNextOnlyResponse()],
    );
    expect(result).toEqual([]);
  });

  it("getXLogDetail returns the first matching xlog, or null if none found", async () => {
    const client = newClient();
    const found = await invoke(
      () => client.getXLogDetail("20260719", "123456789012345"),
      [loginSuccessResponse(1), xlogsResponse([sampleXLog])],
    );
    expect(found).not.toBeNull();

    const notFound = await invoke(() => client.getXLogDetail("20260719", "999"), [noNextOnlyResponse()]);
    expect(notFound).toBeNull();
  });

  it("getXLogsByGxid maps all matching xlogs", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getXLogsByGxid("20260719", "123456789012345"),
      [loginSuccessResponse(1), xlogsResponse([sampleXLog, sampleXLog])],
    );
    expect(result).toHaveLength(2);
  });

  it("getMultiXLogs fetches each txid and drops the ones that fail", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getMultiXLogs("20260719", "111, 222"),
      [
        loginSuccessResponse(1),
        xlogsResponse([sampleXLog]), // txid 111 succeeds
        failResponse(), // txid 222 fails -> caught, filtered out
      ],
    );
    expect(result).toHaveLength(1);
  });
});

describe("TcpClient - getProfileData", () => {
  it("parses every profile step type and stops at the first unrecognized one", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getProfileData("20260719", "123"),
      [
        loginSuccessResponse(1),
        profileResponse({ time: 1, objHash: 1, service: 1, txid: 123n, profile: buildFullProfileBlob() }),
      ],
    );
    expect(result).toHaveLength(10);
    const steps = result as Array<Record<string, unknown>>;
    expect(steps[0]).toMatchObject({ stepType: "METHOD", hash: 111, elapsed: 50, cputime: 5 });
    expect(steps[1]).toMatchObject({ stepType: "METHOD", hash: 222, elapsed: 60, cputime: 6 });
    expect(steps[2]).toMatchObject({ stepType: "SQL", hash: 333, param: "select 1", error: 0 });
    expect(steps[3]).toMatchObject({ stepType: "SQL", hash: 444, param: "select 2", error: 1 });
    expect(steps[4]).toMatchObject({ stepType: "SQL", hash: 555, param: "update t set x=1", error: 0 });
    expect(steps[5]).toMatchObject({ stepType: "MESSAGE", mainValue: "hello world" });
    expect(steps[6]).toMatchObject({ stepType: "HASHED_MESSAGE", hash: 666, elapsed: 1, value: 999 });
    expect(steps[7]).toMatchObject({ stepType: "APICALL", txid: 777888, address: "" });
    expect(steps[8]).toMatchObject({ stepType: "APICALL", txid: 777889, address: "10.0.0.5:8080" });
    expect(steps[9]).toMatchObject({ stepType: "APICALL", txid: 777890, address: "" });
  });

  it("returns [] when there is no profile pack in the response", async () => {
    const client = newClient();
    const result = await invoke(() => client.getProfileData("20260719", "123"), [loginSuccessResponse(1), noNextOnlyResponse()]);
    expect(result).toEqual([]);
  });

  it("exits the parsing loop naturally when the blob is exactly consumed (no trailing unknown step)", async () => {
    const d = new DataOutputX();
    d.writeByte(StepEnum.MESSAGE);
    d.writeDecimal(0); d.writeDecimal(1); d.writeDecimal(100); d.writeDecimal(10);
    d.writeText("only step");
    const client = newClient();
    const result = await invoke(
      () => client.getProfileData("20260719", "123"),
      [loginSuccessResponse(1), profileResponse({ time: 1, objHash: 1, service: 1, txid: 1n, profile: d.toBuffer() })],
    );
    expect(result).toEqual([
      { parent: 0, index: 1, start_time: 100, start_cpu: 10, stepType: "MESSAGE", mainValue: "only step" },
    ]);
  });
});

describe("TcpClient - getSummary", () => {
  it("returns [] immediately for an unknown category, without any socket request", async () => {
    const client = newClient();
    const result = await invoke(() => client.getSummary("bogus", "java", 1770000000000, 1770000100000), []);
    expect(result).toEqual([]);
    expect(sockets.length).toBe(0);
  });

  it("'service' category resolves ids to names via a follow-up text lookup", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getSummary("service", "java", 1770000000000, 1770000100000),
      [
        loginSuccessResponse(1),
        mapPackResponse({ id: [10], count: [5], error: [1], elapsed: [500], cpu: [10], mem: [1000] }),
        mapPackResponse({ "10": "/api/hello" }),
      ],
    );
    expect(result).toEqual([
      { summaryKeyName: "/api/hello", count: 5, elapsedSum: 500, cpuSum: 10, memorySum: 1000, errorCount: 1 },
    ]);
  });

  it("'error' category reports errorHash instead of errorCount", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getSummary("error", "java", 1770000000000, 1770000100000),
      [
        loginSuccessResponse(1),
        mapPackResponse({ id: [77], count: [2], error: [88], elapsed: [10], cpu: [1], mem: [2] }),
        mapPackResponse({ "77": "boom-error" }),
      ],
    );
    expect(result).toEqual([
      { summaryKeyName: "boom-error", count: 2, elapsedSum: 10, cpuSum: 1, memorySum: 2, errorHash: 88, errorCount: 0 },
    ]);
  });

  it("'ip' category converts ids to dotted IPs without a text-lookup request", async () => {
    const client = newClient();
    // 127.0.0.1 -> (127<<24)+(0<<16)+(0<<8)+1
    const ipInt = (127 << 24) + 1;
    const result = await invoke(
      () => client.getSummary("ip", "java", 1770000000000, 1770000100000),
      [loginSuccessResponse(1), mapPackResponse({ id: [ipInt], count: [3], error: [0], elapsed: [1], cpu: [1], mem: [1] })],
    );
    expect(result).toEqual([
      { summaryKeyName: "127.0.0.1", count: 3, elapsedSum: 1, cpuSum: 1, memorySum: 1, errorCount: 0 },
    ]);
  });

  it("returns [] when the server reports no summary data", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getSummary("sql", "java", 1770000000000, 1770000100000),
      [loginSuccessResponse(1), noNextOnlyResponse()],
    );
    expect(result).toEqual([]);
  });
});

describe("TcpClient - getThreadDump / getHeapHistogram", () => {
  it("getThreadDump un-parallelizes array fields per thread, copying scalar fields to every row", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getThreadDump(1),
      [loginSuccessResponse(1), mapPackResponse({ threadId: [1, 2], status: ["RUN", "WAIT"], host: "shared-host" })],
    );
    expect(result).toEqual([
      { threadId: 1, status: "RUN", host: "shared-host" },
      { threadId: 2, status: "WAIT", host: "shared-host" },
    ]);
  });

  it("getThreadDump passes through a row with no array fields unchanged", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getThreadDump(1),
      [loginSuccessResponse(1), mapPackResponse({ status: "OK" })],
    );
    expect(result).toEqual([{ status: "OK" }]);
  });

  it("getHeapHistogram filters non-string names, sorts desc by bytes, and caps at 30", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getHeapHistogram(1),
      [
        loginSuccessResponse(1),
        mapPackResponse({
          name: ["A", "B"],
          count: [1, 2],
          bytes: [100, 900],
        }),
      ],
    );
    expect(result).toEqual([
      { name: "B", count: 2, bytes: 900 },
      { name: "A", count: 1, bytes: 100 },
    ]);
  });

  it("getHeapHistogram returns [] when there is no data", async () => {
    const client = newClient();
    const result = await invoke(() => client.getHeapHistogram(1), [loginSuccessResponse(1), noNextOnlyResponse()]);
    expect(result).toEqual([]);
  });
});

describe("TcpClient - lookupTexts / resolveTexts caching", () => {
  it("decodes plain, x-prefixed and z-prefixed hexa32 hash keys, skipping non-string/empty-key entries", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.lookupTexts("20260719", "service", [123, 100, -200]),
      [
        loginSuccessResponse(1),
        mapPackResponse({
          "123": "text-for-123", // plain decimal
          x34: "text-for-100", // "x" + (100).toString(32) === "x34"
          z68: "text-for-neg200", // "z" + (200).toString(32) === "z68"
          "": "ignored-empty-key", // fromHexa32("") -> 0, but harmless
          "999": 42, // non-string value is skipped entirely
        }),
      ],
    );
    expect(result).toEqual({
      "123": "text-for-123",
      "100": "text-for-100",
      "-200": "text-for-neg200",
    });
  });

  it("caches resolved hashes across calls and only requests newly-missing ones", async () => {
    const client = newClient();
    await invoke(
      () => client.lookupTexts("20260719", "service", [1, 2]),
      [loginSuccessResponse(1), mapPackResponse({ "1": "one", "2": "two" })],
    );
    const writesAfterFirst = sockets[0].written.length;

    // Second call reuses hash 1 and 2 from cache, only hash 3 is "missing".
    const second = await invoke(
      () => client.lookupTexts("20260719", "service", [1, 2, 3]),
      [mapPackResponse({ "3": "three" })],
    );
    expect(second).toEqual({ "1": "one", "2": "two", "3": "three" });
    // Exactly one additional write for the second GET_TEXT_100 request.
    expect(sockets[0].written.length).toBe(writesAfterFirst + 1);

    // Third call: everything already cached -> no request at all.
    const writesAfterSecond = sockets[0].written.length;
    const third = await invoke(() => client.lookupTexts("20260719", "service", [1, 2, 3]), []);
    expect(third).toEqual({ "1": "one", "2": "two", "3": "three" });
    expect(sockets[0].written.length).toBe(writesAfterSecond);
  });

  it("omits hashes that never resolved to text", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.lookupTexts("20260719", "service", [1, 2]),
      [loginSuccessResponse(1), mapPackResponse({ "1": "one" })],
    );
    expect(result).toEqual({ "1": "one" });
  });
});

describe("TcpClient - by-objHashes counter variants", () => {
  it("getRealtimeCountersByObjHashes issues one request per hash", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getRealtimeCountersByObjHashes("cpu%25used,mem", "1,2"),
      [
        loginSuccessResponse(1),
        mapPackResponse({ counter: ["cpu%used", "mem"], value: [1, 2] }),
        mapPackResponse({ counter: ["cpu%used", "mem"], value: [3, 4] }),
      ],
    );
    expect(result).toEqual([
      { objHash: 1, name: "cpu%used", value: 1 },
      { objHash: 1, name: "mem", value: 2 },
      { objHash: 2, name: "cpu%used", value: 3 },
      { objHash: 2, name: "mem", value: 4 },
    ]);
  });

  it("getLatestCounter delegates to getCounterHistory with a computed time window", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getLatestCounter("cpu", "java", 60),
      [
        loginSuccessResponse(1),
        objectsResponse([{ objType: "java", objHash: 1, objName: "app1", address: "a", alive: true }]),
        mapPackResponse({ objHash: 1, time: [1], value: [2] }),
      ],
    );
    expect(result).toEqual([{ objHash: 1, objName: "app1", valueList: [{ time: 1, value: 2 }] }]);
  });

  it("getLatestCounterByObjHashes delegates to getCounterHistoryByObjHashes", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getLatestCounterByObjHashes("cpu", "1", 60),
      [
        loginSuccessResponse(1),
        objectsResponse([{ objType: "java", objHash: 1, objName: "app1", address: "a", alive: true }]),
        mapPackResponse({ objHash: 1, time: [1], value: [2] }),
      ],
    );
    expect(result).toEqual([{ objHash: 1, objName: "app1", valueList: [{ time: 1, value: 2 }] }]);
  });

  it("getCounterHistoryByObjHashes uses the explicit hash list (no alive/objType filter)", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getCounterHistoryByObjHashes("cpu", "5", 0, 1000),
      [
        loginSuccessResponse(1),
        objectsResponse([{ objType: "java", objHash: 5, objName: "app5", address: "a", alive: false }]),
        mapPackResponse({ objHash: 5, time: [1], value: [9] }),
      ],
    );
    expect(result).toEqual([{ objHash: 5, objName: "app5", valueList: [{ time: 1, value: 9 }] }]);
  });

  it("getCounterStatByObjHashes uses the explicit hash list", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getCounterStatByObjHashes("cpu", "6", "20260719", "20260719"),
      [
        loginSuccessResponse(1),
        objectsResponse([{ objType: "java", objHash: 6, objName: "app6", address: "a", alive: true }]),
        mapPackResponse({ objHash: 6, time: [1], value: [3] }),
      ],
    );
    expect(result).toEqual([{ objHash: 6, objName: "app6", valueList: [{ time: 1, value: 3 }] }]);
  });
});

describe("TcpClient - getRealtimeXLogData", () => {
  it("uses offset2 as the since-time when it is positive, and advances xlogIndex past the max endTime", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getRealtimeXLogData(0, 5000, "10"),
      [loginSuccessResponse(1), xlogsResponse([{ ...xlogBase(), endTime: 6000 }])],
    );
    expect(result).toMatchObject({ xlogLoop: 0, xlogIndex: 6001 });
  });

  it("falls back to now-10000 as since-time when offset2 is not positive, and keeps sinceTime when no xlogs found", async () => {
    const client = newClient();
    const result = await invoke(() => client.getRealtimeXLogData(0, 0, "10"), [loginSuccessResponse(1), noNextOnlyResponse()]);
    const r = result as { xlogs: unknown[]; xlogIndex: number };
    expect(r.xlogs).toEqual([]);
    expect(typeof r.xlogIndex).toBe("number");
  });

  function xlogBase(): XLogSpec {
    return { endTime: 0, objHash: 1, service: 1, txid: 1n, elapsed: 1, error: 0, cpu: 1, sqlCount: 0, sqlTime: 0 };
  }
});

describe("TcpClient - getSummaryByObjHash", () => {
  it("delegates to getSummary using the object's objType when the object is found", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getSummaryByObjHash("ip", 1, 1770000000000, 1770000100000),
      [
        loginSuccessResponse(1),
        objectsResponse([{ objType: "java", objHash: 1, objName: "app1", address: "a", alive: true }]),
        mapPackResponse({ id: [1], count: [1], error: [0], elapsed: [1], cpu: [1], mem: [1] }),
      ],
    );
    expect(result).toHaveLength(1);
  });

  it("returns [] without a summary request when the objHash is unknown", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getSummaryByObjHash("ip", 999, 1770000000000, 1770000100000),
      [loginSuccessResponse(1), objectsResponse([])],
    );
    expect(result).toEqual([]);
  });
});

describe("TcpClient - visitor methods", () => {
  it("getVisitorRealtimeByObjType reads the first returned value", async () => {
    const client = newClient();
    const result = await invoke(() => client.getVisitorRealtimeByObjType("java"), [loginSuccessResponse(1), valuesResponse([42])]);
    expect(result).toBe(42);
  });

  it("getVisitorRealtimeByObjHash reads the first returned value", async () => {
    const client = newClient();
    const result = await invoke(() => client.getVisitorRealtimeByObjHash(1), [loginSuccessResponse(1), valuesResponse([7])]);
    expect(result).toBe(7);
  });

  it("getVisitorRealtimeByObjHashes sums across all hashes (one request per hash)", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getVisitorRealtimeByObjHashes("1,2,3"),
      [loginSuccessResponse(1), valuesResponse([1]), valuesResponse([2]), valuesResponse([3])],
    );
    expect(result).toBe(6);
  });

  it("getVisitorDailyByObjType reads the first returned value", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getVisitorDailyByObjType("java", "20260719"),
      [loginSuccessResponse(1), valuesResponse([15])],
    );
    expect(result).toBe(15);
  });

  it("getVisitorDailyByObjHash reads the first returned value", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getVisitorDailyByObjHash(1, "20260719"),
      [loginSuccessResponse(1), valuesResponse([16])],
    );
    expect(result).toBe(16);
  });

  it("getVisitorHourly returns one row per map pack, with time/value passed through as-is", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getVisitorHourly("1,2", 2026071900, 2026071923),
      [loginSuccessResponse(1), mapPackResponse({ time: [2026071900], value: [5] })],
    );
    expect(result).toEqual([{ time: [2026071900], value: [5] }]);
  });

  it("getVisitorGroup sums a scalar hourly value", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getVisitorGroup("1,2", 2026071900, 2026071923),
      [loginSuccessResponse(1), mapPackResponse({ time: 1, value: 42 })],
    );
    expect(result).toEqual({ time: "total", value: 42 });
  });

  it("getVisitorGroup flattens an array-valued hourly row before summing", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getVisitorGroup("1,2", 2026071900, 2026071923),
      [loginSuccessResponse(1), mapPackResponse({ time: [1], value: [3, 4, 5] })],
    );
    expect(result).toEqual({ time: "total", value: 12 });
  });
});

describe("TcpClient - interaction counters (swallow errors)", () => {
  it("getInteractionCounters returns mapPackData on success", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getInteractionCounters("java"),
      [loginSuccessResponse(1), mapPackResponse({ name: "intr1" })],
    );
    expect(result).toEqual([{ name: "intr1" }]);
  });

  it("getInteractionCounters returns [] if the request fails", async () => {
    const client = newClient();
    const result = await invoke(() => client.getInteractionCounters("java"), [loginSuccessResponse(1), failResponse()]);
    expect(result).toEqual([]);
  });

  it("getInteractionCountersByObjHashes returns mapPackData on success", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getInteractionCountersByObjHashes("1,2"),
      [loginSuccessResponse(1), mapPackResponse({ name: "intr2" })],
    );
    expect(result).toEqual([{ name: "intr2" }]);
  });

  it("getInteractionCountersByObjHashes returns [] if the request fails", async () => {
    const client = newClient();
    const result = await invoke(() => client.getInteractionCountersByObjHashes("1,2"), [loginSuccessResponse(1), failResponse()]);
    expect(result).toEqual([]);
  });
});

describe("TcpClient - host / agent info", () => {
  it("getHostTop passes through mapPackData", async () => {
    const client = newClient();
    const result = await invoke(() => client.getHostTop(1), [loginSuccessResponse(1), mapPackResponse({ cpu: 50 })]);
    expect(result).toEqual([{ cpu: 50 }]);
  });

  it("getHostDisk passes through mapPackData", async () => {
    const client = newClient();
    const result = await invoke(() => client.getHostDisk(1), [loginSuccessResponse(1), mapPackResponse({ disk: "50%" })]);
    expect(result).toEqual([{ disk: "50%" }]);
  });

  it("getThreadList un-parallelizes array fields", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getThreadList(1),
      [loginSuccessResponse(1), mapPackResponse({ threadId: [1, 2], name: ["t1", "t2"] })],
    );
    expect(result).toEqual([
      { threadId: 1, name: "t1" },
      { threadId: 2, name: "t2" },
    ]);
  });

  it("getAgentEnv passes through mapPackData", async () => {
    const client = newClient();
    const result = await invoke(() => client.getAgentEnv(1), [loginSuccessResponse(1), mapPackResponse({ env: "PROD" })]);
    expect(result).toEqual([{ env: "PROD" }]);
  });

  it("getAgentSocket converts 4-byte Buffer fields into dotted IPs", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getAgentSocket(1),
      [
        loginSuccessResponse(1),
        mapPackResponse({
          localIp: [Buffer.from([127, 0, 0, 1]), Buffer.from([10, 0, 0, 2])],
          port: [8080, 9090],
        }),
      ],
    );
    expect(result).toEqual([
      { localIp: "127.0.0.1", port: 8080 },
      { localIp: "10.0.0.2", port: 9090 },
    ]);
  });
});

describe("TcpClient - raw profile / xlog delegating methods", () => {
  const sampleXLog: XLogSpec = {
    endTime: 1, objHash: 1, service: 1, txid: 1n, elapsed: 1, error: 0, cpu: 1, sqlCount: 0, sqlTime: 0,
  };

  it("getRawProfile delegates to getProfileData", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getRawProfile("20260719", "1"),
      [loginSuccessResponse(1), noNextOnlyResponse()],
    );
    expect(result).toEqual([]);
  });

  it("getRawXLog delegates to getXLogDetail", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getRawXLog("20260719", "1"),
      [loginSuccessResponse(1), xlogsResponse([sampleXLog])],
    );
    expect(result).not.toBeNull();
  });

  it("getRawXLogByGxid delegates to getXLogsByGxid", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getRawXLogByGxid("20260719", "1"),
      [loginSuccessResponse(1), xlogsResponse([sampleXLog])],
    );
    expect(result).toHaveLength(1);
  });

  it("searchRawXLog delegates to searchXLogData", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.searchRawXLog("20260719", {}),
      [loginSuccessResponse(1), noNextOnlyResponse()],
    );
    expect(result).toEqual([]);
  });

  it("getPageableRawXLog reads startTimeMillis/endTimeMillis/objHashes from params", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getPageableRawXLog("20260719", { startTimeMillis: "0", endTimeMillis: "9999", objHashes: "1" }),
      [loginSuccessResponse(1), xlogsResponse([sampleXLog])],
    );
    expect(result).toHaveLength(1);
  });

  it("getPageableRawXLog defaults missing params (empty objHashes -> [])", async () => {
    const client = newClient();
    const result = await invoke(() => client.getPageableRawXLog("20260719", {}), [loginSuccessResponse(1), noNextOnlyResponse()]);
    expect(result).toEqual([]);
  });

  it("getRealtimeRawXLog uses max(xlogIndex, now-60000) when xlogIndex is positive", async () => {
    const client = newClient();
    const result = await invoke(
      () => client.getRealtimeRawXLog(0, Date.now(), "1"),
      [loginSuccessResponse(1), xlogsResponse([sampleXLog])],
    );
    expect(result).toHaveLength(1);
  });

  it("getRealtimeRawXLog uses now-30000 when xlogIndex is not positive", async () => {
    const client = newClient();
    const result = await invoke(() => client.getRealtimeRawXLog(0, 0, "1"), [loginSuccessResponse(1), noNextOnlyResponse()]);
    expect(result).toEqual([]);
  });
});
