import { describe, it, expect } from "vitest";
import { DataOutputX } from "../../protocol/data-output.js";
import { AsyncDataInput, type ByteReader } from "../../protocol/async-data-input.js";

function createReader(buf: Buffer): ByteReader {
  let pos = 0;
  return {
    async readExact(n: number): Promise<Buffer> {
      const slice = buf.subarray(pos, pos + n);
      pos += n;
      return slice;
    },
  };
}

function asyncInput(buf: Buffer): AsyncDataInput {
  return new AsyncDataInput(createReader(buf));
}

describe("AsyncDataInput", () => {
  it("should read byte", async () => {
    const dout = new DataOutputX();
    dout.writeByte(42);
    dout.writeByte(-1);
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readByte()).toBe(42);
    expect(await adi.readByte()).toBe(-1);
  });

  it("should read boolean", async () => {
    const dout = new DataOutputX();
    dout.writeBoolean(true);
    dout.writeBoolean(false);
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readBoolean()).toBe(true);
    expect(await adi.readBoolean()).toBe(false);
  });

  it("should read short and unsigned short", async () => {
    const dout = new DataOutputX();
    dout.writeShort(12345);
    dout.writeShort(-1);
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readShort()).toBe(12345);
    expect(await adi.readUnsignedShort()).toBe(65535);
  });

  it("should read int", async () => {
    const dout = new DataOutputX();
    dout.writeInt(2147483647);
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readInt()).toBe(2147483647);
  });

  it("should read int3", async () => {
    const dout = new DataOutputX();
    dout.writeInt3(100000);
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readInt3()).toBe(100000);
  });

  it("should read long", async () => {
    const dout = new DataOutputX();
    dout.writeLong(9007199254740991n);
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readLong()).toBe(9007199254740991n);
  });

  it("should read long5", async () => {
    const dout = new DataOutputX();
    dout.writeLong5(549755813887n);
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readLong5()).toBe(549755813887n);
  });

  it("should read float and double", async () => {
    const dout = new DataOutputX();
    dout.writeFloat(3.14);
    dout.writeDouble(2.718281828459045);
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readFloat()).toBeCloseTo(3.14, 2);
    expect(await adi.readDouble()).toBe(2.718281828459045);
  });

  it("should read decimal with varying sizes", async () => {
    const values = [0, 42, -100, 30000, 100000, 2000000000];
    const dout = new DataOutputX();
    for (const v of values) dout.writeDecimal(v);
    const adi = asyncInput(dout.toBuffer());
    for (const v of values) expect(await adi.readDecimal()).toBe(v);
  });

  it("should read text", async () => {
    const dout = new DataOutputX();
    dout.writeText("hello");
    dout.writeText("한글");
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readText()).toBe("hello");
    expect(await adi.readText()).toBe("한글");
  });

  it("should read blob", async () => {
    const data = Buffer.from([10, 20, 30]);
    const dout = new DataOutputX();
    dout.writeBlob(data);
    dout.writeBlob(Buffer.alloc(0));
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readBlob()).toEqual(data);
    expect(await adi.readBlob()).toEqual(Buffer.alloc(0));
  });

  it("should read decimalLong", async () => {
    const dout = new DataOutputX();
    dout.writeDecimal(0);
    dout.writeDecimal(999999);
    const adi = asyncInput(dout.toBuffer());
    expect(await adi.readDecimalLong()).toBe(0n);
    expect(await adi.readDecimalLong()).toBe(999999n);
  });
});
