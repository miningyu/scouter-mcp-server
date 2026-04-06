export class DataInputX {
  private buf: Buffer;
  private pos: number;

  constructor(buf: Buffer, offset = 0) {
    this.buf = buf;
    this.pos = offset;
  }

  available(): number {
    return this.buf.length - this.pos;
  }

  readByte(): number {
    const v = this.buf.readInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUnsignedByte(): number {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readBoolean(): boolean {
    return this.readByte() !== 0;
  }

  readShort(): number {
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  readUnsignedShort(): number {
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt(): number {
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  readInt3(): number {
    const b0 = this.buf[this.pos];
    const b1 = this.buf[this.pos + 1];
    const b2 = this.buf[this.pos + 2];
    this.pos += 3;
    return ((b0 << 24) + (b1 << 16) + (b2 << 8)) >> 8;
  }

  readFloat(): number {
    const v = this.buf.readFloatBE(this.pos);
    this.pos += 4;
    return v;
  }

  readDouble(): number {
    const v = this.buf.readDoubleBE(this.pos);
    this.pos += 8;
    return v;
  }

  readLong(): bigint {
    const v = this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return v;
  }

  readLong5(): bigint {
    const b = this.buf;
    const p = this.pos;
    this.pos += 5;
    const hi = b[p];
    const lo = ((b[p + 1] & 0xff) << 24) | ((b[p + 2] & 0xff) << 16) | ((b[p + 3] & 0xff) << 8) | (b[p + 4] & 0xff);
    return (BigInt(hi) << 32n) + BigInt(lo >>> 0);
  }

  readDecimal(): number {
    const len = this.readByte();
    switch (len) {
      case 0: return 0;
      case 1: return this.readByte();
      case 2: return this.readShort();
      case 3: return this.readInt3();
      case 4: return this.readInt();
      case 5: return Number(this.readLong5());
      default: return Number(this.readLong());
    }
  }

  readDecimalLong(): bigint {
    const len = this.readByte();
    switch (len) {
      case 0: return 0n;
      case 1: return BigInt(this.readByte());
      case 2: return BigInt(this.readShort());
      case 3: return BigInt(this.readInt3());
      case 4: return BigInt(this.readInt());
      case 5: return this.readLong5();
      default: return this.readLong();
    }
  }

  readBlob(): Buffer {
    const baselen = this.readUnsignedByte();
    switch (baselen) {
      case 0:
        return Buffer.alloc(0);
      case 255: {
        const len = this.readUnsignedShort();
        return this.readBytes(len);
      }
      case 254: {
        const len = this.readInt();
        return this.readBytes(len);
      }
      default:
        return this.readBytes(baselen);
    }
  }

  readText(): string {
    const blob = this.readBlob();
    return blob.toString("utf8");
  }

  readBytes(len: number): Buffer {
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }
}
