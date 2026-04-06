import * as net from "node:net";
import * as crypto from "node:crypto";
import { DataOutputX } from "./data-output.js";
import { NetCafe, TcpFlag, RequestCmd } from "./constants.js";
import { writeMapPack, type Pack } from "./packs.js";
import type { SValue } from "./values.js";
import { AsyncDataInput } from "./async-data-input.js";
import { readPackAsync, readValueAsync } from "./pack-reader.js";

const CONNECT_TIMEOUT = 5000;
const SO_TIMEOUT = 30000;

export class ScouterTcpConnection {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private waitResolve: ((buf: Buffer) => void) | null = null;
  private waitBytes = 0;
  private session = 0n;
  private connected = false;
  private requestQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly userId: string,
    private readonly password: string,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    const socket = new net.Socket();
    socket.setKeepAlive(true);
    socket.setNoDelay(true);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${this.host}:${this.port}`));
      }, CONNECT_TIMEOUT);

      socket.connect(this.port, this.host, () => {
        clearTimeout(timer);
        resolve();
      });

      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    socket.setTimeout(SO_TIMEOUT);
    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("close", () => this.onClose());
    socket.on("error", () => this.onClose());
    socket.on("timeout", () => this.onClose());

    this.socket = socket;
    this.connected = true;
    this.buffer = Buffer.alloc(0);

    const handshake = Buffer.alloc(4);
    handshake.writeUInt32BE(NetCafe.TCP_CLIENT);
    this.socketWrite(handshake);

    await this.login();
  }

  private async login(): Promise<void> {
    const SALT = "qwertyuiop!@#$%^&*()zxcvbnm,.";
    const hashedPass = this.password
      ? crypto.createHash("sha256").update(SALT).update(this.password).digest("hex")
      : "";

    const params: Record<string, SValue> = {
      id: this.userId || "admin",
      pass: hashedPass,
      ip: "127.0.0.1",
      hostname: "mcp-server",
      version: "2.21.3",
      internal: "false",
    };

    const packs = await this.requestRaw(RequestCmd.LOGIN, 0n, params);
    const result = packs[0];
    if (result?.type === "map") {
      const sessionVal = result.data["session"];
      if (typeof sessionVal === "bigint") {
        this.session = sessionVal;
      } else if (typeof sessionVal === "number" && sessionVal !== 0) {
        this.session = BigInt(sessionVal);
      }
      if (this.session === 0n) {
        const errorMsg = result.data["error"];
        throw new Error(`Scouter login failed: ${errorMsg ?? "unknown error"}`);
      }
    }
  }

  async request(cmd: string, params?: Record<string, SValue>): Promise<Pack[]> {
    const result = this.requestQueue.then(async () => {
      await this.ensureConnected();
      try {
        return await this.requestRaw(cmd, this.session, params);
      } catch (e) {
        if (String(e).includes("INVALID_SESSION")) {
          this.session = 0n;
          await this.login();
          return this.requestRaw(cmd, this.session, params);
        }
        throw e;
      }
    });
    this.requestQueue = result.catch(() => {});
    return result;
  }

  async requestValues(cmd: string, params?: Record<string, SValue>): Promise<SValue[]> {
    const result = this.requestQueue.then(async () => {
      await this.ensureConnected();
      try {
        return await this.requestValuesRaw(cmd, this.session, params);
      } catch (e) {
        if (String(e).includes("INVALID_SESSION")) {
          this.session = 0n;
          await this.login();
          return this.requestValuesRaw(cmd, this.session, params);
        }
        throw e;
      }
    });
    this.requestQueue = result.catch(() => {});
    return result;
  }

  private async requestRaw(cmd: string, session: bigint, params?: Record<string, SValue>): Promise<Pack[]> {
    const dout = new DataOutputX();
    dout.writeText(cmd);
    dout.writeLong(session);
    if (params) {
      writeMapPack(dout, params);
    }

    this.socketWrite(dout.toBuffer());

    const packs: Pack[] = [];
    const stream = new AsyncDataInput(this);

    while (true) {
      const flag = await stream.readByte();
      if (flag === TcpFlag.NoNEXT) break;
      if (flag === TcpFlag.INVALID_SESSION) throw new Error("INVALID_SESSION");
      if (flag === TcpFlag.FAIL) throw new Error("Scouter server returned FAIL");
      if (flag === TcpFlag.HasNEXT) {
        const pack = await readPackAsync(stream);
        packs.push(pack);
      } else {
        break;
      }
    }
    return packs;
  }

  private async requestValuesRaw(cmd: string, session: bigint, params?: Record<string, SValue>): Promise<SValue[]> {
    const dout = new DataOutputX();
    dout.writeText(cmd);
    dout.writeLong(session);
    if (params) {
      writeMapPack(dout, params);
    }

    this.socketWrite(dout.toBuffer());

    const values: SValue[] = [];
    const stream = new AsyncDataInput(this);

    while (true) {
      const flag = await stream.readByte();
      if (flag === TcpFlag.NoNEXT) break;
      if (flag === TcpFlag.INVALID_SESSION) throw new Error("INVALID_SESSION");
      if (flag === TcpFlag.FAIL) throw new Error("Scouter server returned FAIL");
      if (flag === TcpFlag.HasNEXT) {
        const value = await readValueAsync(stream);
        values.push(value);
      } else {
        break;
      }
    }
    return values;
  }

  async readExact(n: number): Promise<Buffer> {
    if (!this.connected) throw new Error("Not connected");

    if (this.buffer.length >= n) {
      const result = this.buffer.subarray(0, n);
      this.buffer = this.buffer.subarray(n);
      return result;
    }

    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.waitResolve = null;
        reject(new Error("Read timeout"));
      }, SO_TIMEOUT);

      this.waitBytes = n;
      this.waitResolve = (buf) => {
        clearTimeout(timeout);
        resolve(buf);
      };
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    if (this.waitResolve && this.buffer.length >= this.waitBytes) {
      const result = this.buffer.subarray(0, this.waitBytes);
      this.buffer = this.buffer.subarray(this.waitBytes);
      const resolve = this.waitResolve;
      this.waitResolve = null;
      this.waitBytes = 0;
      resolve(result);
    }
  }

  private onClose(): void {
    this.connected = false;
    this.socket = null;
    if (this.waitResolve) {
      this.waitResolve = null;
    }
  }

  private socketWrite(data: Buffer): void {
    if (!this.socket || !this.connected) throw new Error("Not connected");
    this.socket.write(data);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect();
  }

  async close(): Promise<void> {
    if (!this.connected || !this.socket) return;
    try {
      const dout = new DataOutputX();
      dout.writeText(RequestCmd.CLOSE);
      this.socketWrite(dout.toBuffer());
    } catch {
      // ignore
    }
    this.socket.destroy();
    this.connected = false;
    this.socket = null;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
