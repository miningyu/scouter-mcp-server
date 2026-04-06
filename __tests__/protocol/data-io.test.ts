import { describe, it, expect } from "vitest";
import { DataOutputX } from "../../protocol/data-output.js";
import { DataInputX } from "../../protocol/data-input.js";

describe("DataOutputX / DataInputX roundtrip", () => {
  it("should roundtrip byte", () => {
    const dout = new DataOutputX();
    dout.writeByte(42);
    dout.writeByte(-1);
    dout.writeByte(0);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readByte()).toBe(42);
    expect(din.readByte()).toBe(-1);
    expect(din.readByte()).toBe(0);
    expect(din.available()).toBe(0);
  });

  it("should roundtrip boolean", () => {
    const dout = new DataOutputX();
    dout.writeBoolean(true);
    dout.writeBoolean(false);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readBoolean()).toBe(true);
    expect(din.readBoolean()).toBe(false);
  });

  it("should roundtrip short", () => {
    const dout = new DataOutputX();
    dout.writeShort(12345);
    dout.writeShort(-32768);
    dout.writeShort(0);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readShort()).toBe(12345);
    expect(din.readShort()).toBe(-32768);
    expect(din.readShort()).toBe(0);
  });

  it("should roundtrip int", () => {
    const dout = new DataOutputX();
    dout.writeInt(2147483647);
    dout.writeInt(-2147483648);
    dout.writeInt(0);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readInt()).toBe(2147483647);
    expect(din.readInt()).toBe(-2147483648);
    expect(din.readInt()).toBe(0);
  });

  it("should roundtrip int3", () => {
    const dout = new DataOutputX();
    dout.writeInt3(100000);
    dout.writeInt3(-100000);
    dout.writeInt3(0);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readInt3()).toBe(100000);
    expect(din.readInt3()).toBe(-100000);
    expect(din.readInt3()).toBe(0);
  });

  it("should roundtrip float", () => {
    const dout = new DataOutputX();
    dout.writeFloat(3.14);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readFloat()).toBeCloseTo(3.14, 2);
  });

  it("should roundtrip double", () => {
    const dout = new DataOutputX();
    dout.writeDouble(3.141592653589793);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readDouble()).toBe(3.141592653589793);
  });

  it("should roundtrip long", () => {
    const dout = new DataOutputX();
    dout.writeLong(9007199254740991n);
    dout.writeLong(-1n);
    dout.writeLong(0n);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readLong()).toBe(9007199254740991n);
    expect(din.readLong()).toBe(-1n);
    expect(din.readLong()).toBe(0n);
  });

  it("should roundtrip long5", () => {
    const dout = new DataOutputX();
    dout.writeLong5(549755813887n);
    dout.writeLong5(0n);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readLong5()).toBe(549755813887n);
    expect(din.readLong5()).toBe(0n);
  });

  it("should roundtrip decimal with varying sizes", () => {
    const values = [0, 42, -100, 30000, -30000, 100000, -100000, 2000000000, -2000000000];
    const dout = new DataOutputX();
    for (const v of values) dout.writeDecimal(v);
    const din = new DataInputX(dout.toBuffer());
    for (const v of values) expect(din.readDecimal()).toBe(v);
    expect(din.available()).toBe(0);
  });

  it("should roundtrip text", () => {
    const dout = new DataOutputX();
    dout.writeText("hello");
    dout.writeText("안녕하세요");
    dout.writeText("");
    const din = new DataInputX(dout.toBuffer());
    expect(din.readText()).toBe("hello");
    expect(din.readText()).toBe("안녕하세요");
    expect(din.readText()).toBe("");
  });

  it("should roundtrip blob", () => {
    const data = Buffer.from([1, 2, 3, 4, 5]);
    const dout = new DataOutputX();
    dout.writeBlob(data);
    dout.writeBlob(Buffer.alloc(0));
    dout.writeBlob(null);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readBlob()).toEqual(data);
    expect(din.readBlob()).toEqual(Buffer.alloc(0));
    expect(din.readBlob()).toEqual(Buffer.alloc(0));
  });

  it("should read large blob with 255 prefix", () => {
    // Manually construct a blob with 255 prefix (unsigned byte)
    // since writeByte uses signed int8 and can't write 255 directly
    const data = Buffer.alloc(300, 0xab);
    const prefix = Buffer.alloc(3);
    prefix.writeUInt8(255, 0);       // 255 = large blob marker
    prefix.writeUInt16BE(300, 1);    // 2-byte length
    const buf = Buffer.concat([prefix, data]);
    const din = new DataInputX(buf);
    expect(din.readBlob()).toEqual(data);
  });

  it("should handle offset constructor", () => {
    const buf = Buffer.alloc(10);
    buf.writeInt32BE(42, 4);
    const din = new DataInputX(buf, 4);
    expect(din.readInt()).toBe(42);
    expect(din.available()).toBe(2);
  });

  it("should roundtrip decimalLong", () => {
    const dout = new DataOutputX();
    dout.writeDecimal(0);
    dout.writeDecimal(42);
    dout.writeDecimal(100000);
    const din = new DataInputX(dout.toBuffer());
    expect(din.readDecimalLong()).toBe(0n);
    expect(din.readDecimalLong()).toBe(42n);
    expect(din.readDecimalLong()).toBe(100000n);
  });
});
