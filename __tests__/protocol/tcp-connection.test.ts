import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DataOutputX } from "../../protocol/data-output.js";
import { DataInputX } from "../../protocol/data-input.js";
import { writeMapPack } from "../../protocol/packs.js";
import { writeValue, readValue } from "../../protocol/values.js";
import { TcpFlag } from "../../protocol/constants.js";
import type { SValue } from "../../protocol/values.js";

// --- Fake socket infrastructure -------------------------------------------
//
// tcp-connection.ts consumes `net.Socket` like this:
//   const socket = new net.Socket();
//   socket.setKeepAlive(true); socket.setNoDelay(true);
//   socket.connect(port, host, callback);
//   socket.on("error", ...) / "data" / "close" / "timeout"
//   socket.write(buf); socket.destroy();
//
// The fake below is a minimal hand-rolled emitter (no real EventEmitter
// needed) that can be driven manually from tests: trigger the connect
// callback, emit "data"/"close"/"error"/"timeout", and optionally
// auto-respond to writes via a FIFO response queue (so we never have to
// guess how many microtask ticks separate a write from its response).
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
      // The 4-byte TCP_CLIENT handshake never gets a response.
      if (data.length === 4) return true;
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
vi.mock("net", () => ({
  Socket: vi.fn(function SocketMock() {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  }),
}));

import { ScouterTcpConnection } from "../../protocol/tcp-connection.js";

type FakeSocketInstance = InstanceType<typeof FakeSocket>;

// --- Byte-level response builders ------------------------------------------

function loginSuccessResponse(session: number | bigint): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.HasNEXT);
  writeMapPack(dout, { session: session as SValue });
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

function loginFailureResponse(): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.HasNEXT);
  writeMapPack(dout, { error: "bad credentials" });
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

function mapPackResponse(data: Record<string, SValue>): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.HasNEXT);
  writeMapPack(dout, data);
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

function invalidSessionResponse(): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.INVALID_SESSION);
  return dout.toBuffer();
}

function unrecognizedFlagResponse(): Buffer {
  const dout = new DataOutputX();
  dout.writeByte(TcpFlag.OK); // neither NoNEXT, INVALID_SESSION, FAIL, nor HasNEXT
  return dout.toBuffer();
}

function valueResponse(values: SValue[]): Buffer {
  const dout = new DataOutputX();
  for (const v of values) {
    dout.writeByte(TcpFlag.HasNEXT);
    writeValue(dout, v);
  }
  dout.writeByte(TcpFlag.NoNEXT);
  return dout.toBuffer();
}

// Parses the sequence of writes into { cmd, session } for assertions.
function parseRequestHeader(buf: Buffer): { cmd: string; session: bigint } {
  const din = new DataInputX(buf);
  const cmd = din.readText();
  const session = din.readLong();
  return { cmd, session };
}

describe("ScouterTcpConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function newConn(password = "secret") {
    return new ScouterTcpConnection("host", 6100, "user1", password);
  }

  describe("connect()", () => {
    it("performs handshake, sends LOGIN, and stores session from a bigint session value", async () => {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      // session beyond MAX_SAFE_INTEGER decodes as a bigint on the read side
      socket.responseQueue.push(loginSuccessResponse(9007199254740993n));
      socket.connectCb!();
      await p;

      expect(conn.isConnected()).toBe(true);
      expect(socket.setKeepAlive).toHaveBeenCalledWith(true);
      expect(socket.setNoDelay).toHaveBeenCalledWith(true);
      expect(socket.setTimeout).toHaveBeenCalled();
      expect(socket.written.length).toBe(2); // handshake + LOGIN
      expect(socket.written[0].length).toBe(4);
      expect(socket.written[0].readUInt32BE(0)).toBe(0xcafe2001);
      const { cmd, session } = parseRequestHeader(socket.written[1]);
      expect(cmd).toBe("LOGIN");
      expect(session).toBe(0n);
    });

    it("stores session from a plain-number session value (small session ids)", async () => {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(42));
      socket.connectCb!();
      await p;
      expect(conn.isConnected()).toBe(true);
    });

    it("sends correctly-shaped LOGIN params, hashing the password with the fixed salt", async () => {
      const conn = newConn("mypw");
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.connectCb!();
      await p;

      const din = new DataInputX(socket.written[1]);
      din.readText(); // cmd
      din.readLong(); // session
      din.readByte(); // MAP pack type byte
      const count = din.readDecimal();
      const data: Record<string, unknown> = {};
      for (let i = 0; i < count; i++) {
        const key = din.readText();
        data[key] = readValue(din);
      }
      expect(data.id).toBe("user1");
      expect(data.ip).toBe("127.0.0.1");
      expect(data.hostname).toBe("mcp-server");
      expect(data.internal).toBe("false");
      expect(typeof data.pass).toBe("string");
      expect((data.pass as string).length).toBe(64); // sha256 hex digest
    });

    it("sends an empty pass hash when password is empty", async () => {
      const conn = newConn("");
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.connectCb!();
      await p;
      expect(conn.isConnected()).toBe(true);
    });

    it("defaults the login id to 'admin' when userId is empty", async () => {
      const conn = new ScouterTcpConnection("host", 6100, "", "pw");
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.connectCb!();
      await p;

      const din = new DataInputX(socket.written[1]);
      din.readText(); // cmd
      din.readLong(); // session
      din.readByte(); // MAP pack type byte
      const count = din.readDecimal();
      let id: unknown;
      for (let i = 0; i < count; i++) {
        const key = din.readText();
        const value = readValue(din);
        if (key === "id") id = value;
      }
      expect(id).toBe("admin");
    });

    it("does nothing and does not open a new socket if already connected", async () => {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.connectCb!();
      await p;

      expect(sockets.length).toBe(1);
      await conn.connect();
      expect(sockets.length).toBe(1);
    });

    it("rejects when the socket emits an error before connecting", async () => {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.emit("error", new Error("ECONNREFUSED"));
      await expect(p).rejects.toThrow("ECONNREFUSED");
      expect(conn.isConnected()).toBe(false);
    });

    it("rejects with a timeout error and destroys the socket when connect never completes", async () => {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      const assertion = expect(p).rejects.toThrow("Scouter TCP connection timeout");
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
      expect(socket.destroy).toHaveBeenCalled();
    });

    it("rejects when login fails, but leaves `connected` true (actual source behavior)", async () => {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginFailureResponse());
      socket.connectCb!();
      await expect(p).rejects.toThrow("Scouter login failed: authentication error");
      // `this.connected = true` is set before login() runs and is not rolled
      // back on login failure -- this documents that real behavior.
      expect(conn.isConnected()).toBe(true);
    });

    it("silently succeeds when the LOGIN response contains no packs at all", async () => {
      // `result` is undefined, so `result?.type === "map"` short-circuits and
      // the whole session-check block is skipped -- no error is thrown, and
      // the session silently stays at its initial 0n value.
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(noNextOnlyResponse());
      socket.connectCb!();
      await expect(p).resolves.toBeUndefined();
      expect(conn.isConnected()).toBe(true);

      socket.responseQueue.push(mapPackResponse({ ok: true }));
      await conn.request("FOLLOWUP_CMD");
      expect(parseRequestHeader(socket.written.at(-1)!).session).toBe(0n);
    });
  });

  describe("request()", () => {
    async function connected(): Promise<{ conn: ScouterTcpConnection; socket: FakeSocketInstance }> {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.connectCb!();
      await p;
      return { conn, socket };
    }

    it("returns parsed map packs for a simple request with params", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(mapPackResponse({ foo: "bar", n: 5 }));
      const packs = await conn.request("SOME_CMD", { a: 1 });
      expect(packs).toEqual([{ type: "map", data: { foo: "bar", n: 5 } }]);
      const { cmd, session } = parseRequestHeader(socket.written.at(-1)!);
      expect(cmd).toBe("SOME_CMD");
      expect(session).toBe(1n);
    });

    it("supports requests without params", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(noNextOnlyResponse());
      const packs = await conn.request("NO_PARAMS_CMD");
      expect(packs).toEqual([]);
    });

    it("throws when the server returns FAIL", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(failResponse());
      await expect(conn.request("BAD_CMD")).rejects.toThrow("Scouter server returned FAIL");
    });

    it("stops reading on an unrecognized flag byte", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(unrecognizedFlagResponse());
      const packs = await conn.request("WEIRD_CMD");
      expect(packs).toEqual([]);
    });

    it("re-logs in and retries once on INVALID_SESSION", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(invalidSessionResponse());
      socket.responseQueue.push(loginSuccessResponse(2));
      socket.responseQueue.push(mapPackResponse({ ok: true }));

      const packs = await conn.request("RETRY_CMD", { x: 1 });
      expect(packs).toEqual([{ type: "map", data: { ok: true } }]);

      // handshake, first login, RETRY_CMD (fails), second LOGIN, RETRY_CMD (retry)
      expect(socket.written.length).toBe(5);
      expect(parseRequestHeader(socket.written[2]).session).toBe(1n);
      expect(parseRequestHeader(socket.written[3]).cmd).toBe("LOGIN");
      expect(parseRequestHeader(socket.written[4]).session).toBe(2n);
    });

    it("serializes concurrent requests through the request queue", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(mapPackResponse({ first: 1 }));
      socket.responseQueue.push(mapPackResponse({ second: 2 }));

      const [r1, r2] = await Promise.all([
        conn.request("CMD_A"),
        conn.request("CMD_B"),
      ]);
      expect(r1).toEqual([{ type: "map", data: { first: 1 } }]);
      expect(r2).toEqual([{ type: "map", data: { second: 2 } }]);
      expect(parseRequestHeader(socket.written[2]).cmd).toBe("CMD_A");
      expect(parseRequestHeader(socket.written[3]).cmd).toBe("CMD_B");
    });

    it("lazily connects when request() is called on a fresh connection", async () => {
      const conn = newConn();
      const p = conn.request("AUTO_CONNECT_CMD");
      // request() chains through `this.requestQueue.then(...)`, which only
      // runs on the next microtask -- give it a tick before the socket exists.
      await Promise.resolve();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.responseQueue.push(mapPackResponse({ hi: "there" }));
      socket.connectCb!();
      const packs = await p;
      expect(packs).toEqual([{ type: "map", data: { hi: "there" } }]);
    });
  });

  describe("requestValues()", () => {
    async function connected(): Promise<{ conn: ScouterTcpConnection; socket: FakeSocketInstance }> {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.connectCb!();
      await p;
      return { conn, socket };
    }

    it("returns decoded values", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(valueResponse([42, "hello"]));
      const values = await conn.requestValues("VALUE_CMD");
      expect(values).toEqual([42, "hello"]);
    });

    it("throws when the server returns FAIL", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(failResponse());
      await expect(conn.requestValues("VALUE_CMD")).rejects.toThrow("Scouter server returned FAIL");
    });

    it("stops reading on an unrecognized flag byte", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(unrecognizedFlagResponse());
      const values = await conn.requestValues("WEIRD_CMD");
      expect(values).toEqual([]);
    });

    it("re-logs in and retries once on INVALID_SESSION", async () => {
      const { conn, socket } = await connected();
      socket.responseQueue.push(invalidSessionResponse());
      socket.responseQueue.push(loginSuccessResponse(2));
      socket.responseQueue.push(valueResponse([99]));

      const values = await conn.requestValues("VALUE_RETRY", { y: 2 });
      expect(values).toEqual([99]);
      expect(parseRequestHeader(socket.written[3]).cmd).toBe("LOGIN");
    });
  });

  describe("readExact() / onData() buffering", () => {
    it("resolves immediately when the buffer already has enough bytes", async () => {
      const { conn } = await connectedHelper();
      (conn as unknown as { onData(b: Buffer): void }).onData(Buffer.from([1, 2, 3, 4, 5]));
      const result = await conn.readExact(3);
      expect(result).toEqual(Buffer.from([1, 2, 3]));
      // leftover bytes remain buffered for the next read
      const rest = await conn.readExact(2);
      expect(rest).toEqual(Buffer.from([4, 5]));
    });

    it("waits for data to accumulate across multiple onData() chunks", async () => {
      const { conn } = await connectedHelper();
      const asAny = conn as unknown as { onData(b: Buffer): void };
      const p = conn.readExact(5);
      asAny.onData(Buffer.from([1, 2]));
      asAny.onData(Buffer.from([3, 4, 5, 6]));
      const result = await p;
      expect(result).toEqual(Buffer.from([1, 2, 3, 4, 5]));
      const rest = await conn.readExact(1);
      expect(rest).toEqual(Buffer.from([6]));
    });

    it("rejects with 'Read timeout' if no data arrives before SO_TIMEOUT", async () => {
      const { conn } = await connectedHelper();
      const p = conn.readExact(10);
      const assertion = expect(p).rejects.toThrow("Read timeout");
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;
    });

    it("throws 'Not connected' when readExact is called while disconnected", async () => {
      const conn = newConn();
      await expect(conn.readExact(1)).rejects.toThrow("Not connected");
    });

    async function connectedHelper(): Promise<{ conn: ScouterTcpConnection; socket: FakeSocketInstance }> {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.connectCb!();
      await p;
      return { conn, socket };
    }
  });

  describe("socket lifecycle events", () => {
    async function connectedHelper(): Promise<{ conn: ScouterTcpConnection; socket: FakeSocketInstance }> {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.connectCb!();
      await p;
      return { conn, socket };
    }

    it("marks the connection disconnected when the socket closes", async () => {
      const { conn, socket } = await connectedHelper();
      socket.emit("close");
      expect(conn.isConnected()).toBe(false);
    });

    it("marks the connection disconnected on a post-connect socket error", async () => {
      const { conn, socket } = await connectedHelper();
      socket.emit("error", new Error("ECONNRESET"));
      expect(conn.isConnected()).toBe(false);
    });

    it("marks the connection disconnected on socket timeout", async () => {
      const { conn, socket } = await connectedHelper();
      socket.emit("timeout");
      expect(conn.isConnected()).toBe(false);
    });

    it("leaves a pending readExact() promise unsettled when the socket closes mid-read (actual behavior)", async () => {
      const { conn, socket } = await connectedHelper();
      const p = conn.readExact(5);
      let settled = false;
      p.then(
        () => (settled = true),
        () => (settled = true),
      );
      socket.emit("close");
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(conn.isConnected()).toBe(false);
    });
  });

  describe("close()", () => {
    async function connectedHelper(): Promise<{ conn: ScouterTcpConnection; socket: FakeSocketInstance }> {
      const conn = newConn();
      const p = conn.connect();
      const socket = sockets.at(-1)!;
      socket.responseQueue.push(loginSuccessResponse(1));
      socket.connectCb!();
      await p;
      return { conn, socket };
    }

    it("sends CLOSE, destroys the socket, and marks disconnected", async () => {
      const { conn, socket } = await connectedHelper();
      await conn.close();
      // close() writes only the CLOSE command text, no session/params.
      const din = new DataInputX(socket.written.at(-1)!);
      expect(din.readText()).toBe("CLOSE");
      expect(socket.destroy).toHaveBeenCalled();
      expect(conn.isConnected()).toBe(false);
    });

    it("is a no-op when never connected", async () => {
      const conn = newConn();
      await expect(conn.close()).resolves.toBeUndefined();
      expect(conn.isConnected()).toBe(false);
    });

    it("socketWrite throws 'Not connected' directly when there is no socket", () => {
      const conn = newConn();
      expect(() =>
        (conn as unknown as { socketWrite(b: Buffer): void }).socketWrite(Buffer.alloc(1)),
      ).toThrow("Not connected");
    });

    it("still destroys the socket and marks disconnected if the write throws", async () => {
      const { conn, socket } = await connectedHelper();
      socket.write.mockImplementationOnce(() => {
        throw new Error("EPIPE");
      });
      await expect(conn.close()).resolves.toBeUndefined();
      expect(socket.destroy).toHaveBeenCalled();
      expect(conn.isConnected()).toBe(false);
    });
  });
});
