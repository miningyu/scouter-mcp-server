import { describe, it, expect } from "vitest";
import { DataOutputX } from "../../protocol/data-output.js";
import { DataInputX } from "../../protocol/data-input.js";
import { readValue, writeValue, type SValue } from "../../protocol/values.js";
import { ValueEnum } from "../../protocol/constants.js";

function roundtrip(v: SValue): SValue {
  const dout = new DataOutputX();
  writeValue(dout, v);
  const din = new DataInputX(dout.toBuffer());
  const result = readValue(din);
  expect(din.available()).toBe(0);
  return result;
}

describe("values roundtrip (writeValue -> readValue)", () => {
  it("should roundtrip null", () => {
    expect(roundtrip(null)).toBeNull();
  });

  it("should roundtrip booleans", () => {
    expect(roundtrip(true)).toBe(true);
    expect(roundtrip(false)).toBe(false);
  });

  it("should roundtrip integer numbers of varying magnitude (DECIMAL)", () => {
    const values = [0, 42, -1, -100, 127, -128, 30000, -30000, 100000, -100000, 2000000000, -2000000000];
    for (const v of values) {
      expect(roundtrip(v)).toBe(v);
    }
  });

  it("should roundtrip bigint within safe-integer range as a number", () => {
    const v = 123456789n;
    const result = roundtrip(v);
    expect(result).toBe(123456789);
    expect(typeof result).toBe("number");
  });

  it("should roundtrip bigint beyond safe-integer range as bigint", () => {
    const v = 9223372036854775807n; // max int64, well beyond MAX_SAFE_INTEGER
    const result = roundtrip(v);
    expect(result).toBe(v);
    expect(typeof result).toBe("bigint");
  });

  it("should roundtrip bigint at the MAX_SAFE_INTEGER boundary", () => {
    const safe = BigInt(Number.MAX_SAFE_INTEGER);
    expect(roundtrip(safe)).toBe(Number.MAX_SAFE_INTEGER);
    expect(typeof roundtrip(safe)).toBe("number");

    const unsafe = safe + 1n;
    const result = roundtrip(unsafe);
    expect(result).toBe(unsafe);
    expect(typeof result).toBe("bigint");
  });

  it("should roundtrip non-integer numbers as DOUBLE", () => {
    expect(roundtrip(3.14)).toBeCloseTo(3.14, 10);
    expect(roundtrip(-2.71828)).toBeCloseTo(-2.71828, 10);
  });

  it("should roundtrip strings including empty and unicode", () => {
    expect(roundtrip("hello")).toBe("hello");
    expect(roundtrip("")).toBe("");
    expect(roundtrip("안녕하세요")).toBe("안녕하세요");
  });

  it("should roundtrip Buffer as BLOB", () => {
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    expect(roundtrip(buf)).toEqual(buf);
    expect(roundtrip(Buffer.alloc(0))).toEqual(Buffer.alloc(0));
  });

  it("should roundtrip arrays (LIST) including nested and mixed types", () => {
    const arr: SValue[] = [1, "two", true, null, [3, 4], { five: 5 }];
    const result = roundtrip(arr) as SValue[];
    expect(result[0]).toBe(1);
    expect(result[1]).toBe("two");
    expect(result[2]).toBe(true);
    expect(result[3]).toBeNull();
    expect(result[4]).toEqual([3, 4]);
    expect(result[5]).toEqual({ five: 5 });
  });

  it("should roundtrip empty arrays", () => {
    expect(roundtrip([])).toEqual([]);
  });

  it("should roundtrip objects (MAP) including nested maps", () => {
    const obj: SValue = { a: 1, b: "x", c: { nested: true }, d: null };
    expect(roundtrip(obj)).toEqual(obj);
  });

  it("should roundtrip empty objects", () => {
    expect(roundtrip({})).toEqual({});
  });

  it("should treat undefined as NULL when writing", () => {
    const dout = new DataOutputX();
    writeValue(dout, undefined as unknown as SValue);
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toBeNull();
  });

  it("should write nothing for a value outside the SValue type (e.g. symbol)", () => {
    // writeValue's if/else-if chain has no branch for symbol/function -- passing one
    // (via an unsafe cast, since SValue disallows it) falls through and writes no bytes.
    const dout = new DataOutputX();
    writeValue(dout, Symbol("x") as unknown as SValue);
    expect(dout.toBuffer().length).toBe(0);
  });
});

describe("readValue known-bytes decoding (types unreachable via writeValue)", () => {
  it("should decode FLOAT", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.FLOAT);
    dout.writeFloat(3.14);
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toBeCloseTo(3.14, 2);
  });

  it("should decode TEXT_HASH as a decimal number", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.TEXT_HASH);
    dout.writeDecimal(999888);
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toBe(999888);
  });

  it("should decode IP4ADDR as 4 raw bytes", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.IP4ADDR);
    dout.writeRaw(Buffer.from([192, 168, 1, 1]));
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toEqual(Buffer.from([192, 168, 1, 1]));
  });

  it("should decode DOUBLE_SUMMARY", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.DOUBLE_SUMMARY);
    dout.writeDecimal(10);
    dout.writeDouble(100.5);
    dout.writeDouble(1.5);
    dout.writeDouble(50.5);
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toEqual({ count: 10, sum: 100.5, min: 1.5, max: 50.5 });
  });

  it("should decode LONG_SUMMARY", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.LONG_SUMMARY);
    dout.writeDecimal(5);
    dout.writeDecimal(500);
    dout.writeDecimal(10);
    dout.writeDecimal(200);
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toEqual({ count: 5, sum: 500, min: 10, max: 200 });
  });

  it("should decode ARRAY_INT", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.ARRAY_INT);
    dout.writeDecimal(3);
    dout.writeDecimal(1);
    dout.writeDecimal(-2);
    dout.writeDecimal(30000);
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toEqual([1, -2, 30000]);
  });

  it("should decode empty ARRAY_INT", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.ARRAY_INT);
    dout.writeDecimal(0);
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toEqual([]);
  });

  it("should decode ARRAY_FLOAT", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.ARRAY_FLOAT);
    dout.writeDecimal(2);
    dout.writeFloat(1.5);
    dout.writeFloat(-2.5);
    const din = new DataInputX(dout.toBuffer());
    const result = readValue(din) as number[];
    expect(result[0]).toBeCloseTo(1.5, 4);
    expect(result[1]).toBeCloseTo(-2.5, 4);
  });

  it("should decode ARRAY_TEXT", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.ARRAY_TEXT);
    dout.writeDecimal(2);
    dout.writeText("foo");
    dout.writeText("바");
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toEqual(["foo", "바"]);
  });

  it("should decode ARRAY_LONG (decimal-encoded, not full 8-byte long)", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.ARRAY_LONG);
    dout.writeDecimal(2);
    dout.writeDecimal(123456);
    dout.writeDecimal(-654321);
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toEqual([123456, -654321]);
  });

  it("should decode nested LIST inside MAP", () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.MAP);
    dout.writeDecimal(1);
    dout.writeText("items");
    dout.writeByte(ValueEnum.LIST);
    dout.writeDecimal(2);
    dout.writeByte(ValueEnum.DECIMAL);
    dout.writeDecimal(1);
    dout.writeByte(ValueEnum.DECIMAL);
    dout.writeDecimal(2);
    const din = new DataInputX(dout.toBuffer());
    expect(readValue(din)).toEqual({ items: [1, 2] });
  });
});

describe("readValue error paths", () => {
  it("should throw on unknown value type byte", () => {
    // 200 is not a valid ValueEnum member; constructed directly since writeByte
    // only accepts signed int8 range (-128..127).
    const din = new DataInputX(Buffer.from([200]));
    expect(() => readValue(din)).toThrow(/Unknown value type/);
  });

  it("should throw when buffer is truncated mid-value", () => {
    // BOOLEAN type byte with no following payload byte
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.BOOLEAN);
    const din = new DataInputX(dout.toBuffer());
    expect(() => readValue(din)).toThrow();
  });

  it("should silently truncate when blob length prefix exceeds available bytes (Buffer.subarray clamps)", () => {
    // TEXT type followed by a blob length byte of 10 but only 2 payload bytes.
    // DataInputX.readBytes uses Buffer.subarray, which clamps rather than throwing,
    // so this does not throw -- it returns a shorter string than the declared length.
    const buf = Buffer.from([ValueEnum.TEXT, 10, 0x61, 0x62]);
    const din = new DataInputX(buf);
    expect(readValue(din)).toBe("ab");
  });
});
