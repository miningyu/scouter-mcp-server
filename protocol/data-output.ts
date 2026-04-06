const INT3_MIN = -8388608;
const INT3_MAX = 8388607;
const LONG5_MIN = -549755813888n;
const LONG5_MAX = 549755813887n;

export class DataOutputX {
  private chunks: Buffer[] = [];

  writeByte(v: number): void {
    const buf = Buffer.alloc(1);
    buf.writeInt8(v);
    this.chunks.push(buf);
  }

  writeBoolean(v: boolean): void {
    this.writeByte(v ? 1 : 0);
  }

  writeShort(v: number): void {
    const buf = Buffer.alloc(2);
    buf.writeInt16BE(v);
    this.chunks.push(buf);
  }

  writeInt(v: number): void {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(v);
    this.chunks.push(buf);
  }

  writeInt3(v: number): void {
    const buf = Buffer.alloc(3);
    buf[0] = (v >>> 16) & 0xff;
    buf[1] = (v >>> 8) & 0xff;
    buf[2] = v & 0xff;
    this.chunks.push(buf);
  }

  writeFloat(v: number): void {
    const buf = Buffer.alloc(4);
    buf.writeFloatBE(v);
    this.chunks.push(buf);
  }

  writeDouble(v: number): void {
    const buf = Buffer.alloc(8);
    buf.writeDoubleBE(v);
    this.chunks.push(buf);
  }

  writeLong(v: bigint | number): void {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(v));
    this.chunks.push(buf);
  }

  writeLong5(v: bigint): void {
    const buf = Buffer.alloc(5);
    buf[0] = Number((v >> 32n) & 0xffn);
    buf[1] = Number((v >> 24n) & 0xffn);
    buf[2] = Number((v >> 16n) & 0xffn);
    buf[3] = Number((v >> 8n) & 0xffn);
    buf[4] = Number(v & 0xffn);
    this.chunks.push(buf);
  }

  writeDecimal(v: number | bigint): void {
    const bv = BigInt(v);
    if (bv === 0n) {
      this.writeByte(0);
    } else if (bv >= -128n && bv <= 127n) {
      this.writeByte(1);
      this.writeByte(Number(bv));
    } else if (bv >= -32768n && bv <= 32767n) {
      this.writeByte(2);
      this.writeShort(Number(bv));
    } else if (bv >= BigInt(INT3_MIN) && bv <= BigInt(INT3_MAX)) {
      this.writeByte(3);
      this.writeInt3(Number(bv));
    } else if (bv >= -2147483648n && bv <= 2147483647n) {
      this.writeByte(4);
      this.writeInt(Number(bv));
    } else if (bv >= LONG5_MIN && bv <= LONG5_MAX) {
      this.writeByte(5);
      this.writeLong5(bv);
    } else {
      this.writeByte(8);
      this.writeLong(bv);
    }
  }

  writeBlob(value: Buffer | null): void {
    if (!value || value.length === 0) {
      this.writeByte(0);
      return;
    }
    const len = value.length;
    if (len <= 253) {
      this.writeByte(len);
    } else if (len <= 65535) {
      this.writeByte(255);
      this.writeShort(len);
    } else {
      this.writeByte(254);
      this.writeInt(len);
    }
    this.chunks.push(value);
  }

  writeText(s: string | null): void {
    if (s === null || s === undefined) {
      this.writeByte(0);
    } else {
      this.writeBlob(Buffer.from(s, "utf8"));
    }
  }

  writeRaw(buf: Buffer): void {
    this.chunks.push(buf);
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
