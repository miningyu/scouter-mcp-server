export interface ByteReader {
  readExact(n: number): Promise<Buffer>;
}

export class AsyncDataInput {
  constructor(private reader: ByteReader) {}

  async readByte(): Promise<number> {
    const buf = await this.reader.readExact(1);
    return buf.readInt8(0);
  }

  async readUnsignedByte(): Promise<number> {
    const buf = await this.reader.readExact(1);
    return buf.readUInt8(0);
  }

  async readBoolean(): Promise<boolean> {
    return (await this.readByte()) !== 0;
  }

  async readShort(): Promise<number> {
    const buf = await this.reader.readExact(2);
    return buf.readInt16BE(0);
  }

  async readUnsignedShort(): Promise<number> {
    const buf = await this.reader.readExact(2);
    return buf.readUInt16BE(0);
  }

  async readInt(): Promise<number> {
    const buf = await this.reader.readExact(4);
    return buf.readInt32BE(0);
  }

  async readInt3(): Promise<number> {
    const buf = await this.reader.readExact(3);
    return ((buf[0] << 24) + (buf[1] << 16) + (buf[2] << 8)) >> 8;
  }

  async readLong(): Promise<bigint> {
    const buf = await this.reader.readExact(8);
    return buf.readBigInt64BE(0);
  }

  async readLong5(): Promise<bigint> {
    const buf = await this.reader.readExact(5);
    const hi = buf[0];
    const lo = ((buf[1] & 0xff) << 24) | ((buf[2] & 0xff) << 16) | ((buf[3] & 0xff) << 8) | (buf[4] & 0xff);
    return (BigInt(hi) << 32n) + BigInt(lo >>> 0);
  }

  async readFloat(): Promise<number> {
    const buf = await this.reader.readExact(4);
    return buf.readFloatBE(0);
  }

  async readDouble(): Promise<number> {
    const buf = await this.reader.readExact(8);
    return buf.readDoubleBE(0);
  }

  async readDecimal(): Promise<number> {
    const len = await this.readByte();
    switch (len) {
      case 0: return 0;
      case 1: return this.readByte();
      case 2: return this.readShort();
      case 3: return this.readInt3();
      case 4: return this.readInt();
      case 5: return Number(await this.readLong5());
      default: return Number(await this.readLong());
    }
  }

  async readBlob(): Promise<Buffer> {
    const baselen = await this.readUnsignedByte();
    if (baselen === 0) return Buffer.alloc(0);
    if (baselen === 255) {
      const len = await this.readUnsignedShort();
      return this.reader.readExact(len);
    }
    if (baselen === 254) {
      const len = await this.readInt();
      return this.reader.readExact(len);
    }
    return this.reader.readExact(baselen);
  }

  async readText(): Promise<string> {
    const blob = await this.readBlob();
    return blob.toString("utf8");
  }

  async readDecimalLong(): Promise<bigint> {
    const len = await this.readByte();
    switch (len) {
      case 0: return 0n;
      case 1: return BigInt(await this.readByte());
      case 2: return BigInt(await this.readShort());
      case 3: return BigInt(await this.readInt3());
      case 4: return BigInt(await this.readInt());
      case 5: return this.readLong5();
      default: return this.readLong();
    }
  }

  async readBytes(n: number): Promise<Buffer> {
    return this.reader.readExact(n);
  }
}
