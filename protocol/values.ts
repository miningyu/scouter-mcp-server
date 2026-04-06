import { DataInputX } from "./data-input.js";
import { DataOutputX } from "./data-output.js";
import { ValueEnum } from "./constants.js";

export type SValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Buffer
  | SValue[]
  | { [key: string]: SValue };

export function readValue(din: DataInputX): SValue {
  const type = din.readUnsignedByte();
  switch (type) {
    case ValueEnum.NULL:
      return null;
    case ValueEnum.BOOLEAN:
      return din.readBoolean();
    case ValueEnum.DECIMAL: {
      const v = din.readDecimalLong();
      return (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : v;
    }
    case ValueEnum.FLOAT:
      return din.readFloat();
    case ValueEnum.DOUBLE:
      return din.readDouble();
    case ValueEnum.TEXT:
      return din.readText();
    case ValueEnum.TEXT_HASH:
      return din.readDecimal();
    case ValueEnum.BLOB:
      return din.readBlob();
    case ValueEnum.IP4ADDR:
      return din.readBytes(4);
    case ValueEnum.LIST:
      return readListValue(din);
    case ValueEnum.MAP:
      return readMapValue(din);
    case ValueEnum.DOUBLE_SUMMARY:
      return readDoubleSummary(din);
    case ValueEnum.LONG_SUMMARY:
      return readLongSummary(din);
    case ValueEnum.ARRAY_INT:
      return readIntArray(din);
    case ValueEnum.ARRAY_FLOAT:
      return readFloatArray(din);
    case ValueEnum.ARRAY_TEXT:
      return readTextArray(din);
    case ValueEnum.ARRAY_LONG:
      return readLongArray(din);
    default:
      throw new Error(`Unknown value type: ${type}`);
  }
}

function readListValue(din: DataInputX): SValue[] {
  const count = din.readDecimal();
  const list: SValue[] = [];
  for (let i = 0; i < count; i++) {
    list.push(readValue(din));
  }
  return list;
}

function readMapValue(din: DataInputX): Record<string, SValue> {
  const count = din.readDecimal();
  const map: Record<string, SValue> = {};
  for (let i = 0; i < count; i++) {
    const key = din.readText();
    map[key] = readValue(din);
  }
  return map;
}

function readDoubleSummary(din: DataInputX): Record<string, number> {
  return {
    count: din.readDecimal(),
    sum: din.readDouble(),
    min: din.readDouble(),
    max: din.readDouble(),
  };
}

function readLongSummary(din: DataInputX): Record<string, number> {
  return {
    count: din.readDecimal(),
    sum: din.readDecimal(),
    min: din.readDecimal(),
    max: din.readDecimal(),
  };
}

function readIntArray(din: DataInputX): number[] {
  const count = din.readDecimal();
  const arr: number[] = [];
  for (let i = 0; i < count; i++) arr.push(din.readDecimal());
  return arr;
}

function readFloatArray(din: DataInputX): number[] {
  const count = din.readDecimal();
  const arr: number[] = [];
  for (let i = 0; i < count; i++) arr.push(din.readFloat());
  return arr;
}

function readTextArray(din: DataInputX): string[] {
  const count = din.readDecimal();
  const arr: string[] = [];
  for (let i = 0; i < count; i++) arr.push(din.readText());
  return arr;
}

function readLongArray(din: DataInputX): number[] {
  const count = din.readDecimal();
  const arr: number[] = [];
  for (let i = 0; i < count; i++) arr.push(din.readDecimal());
  return arr;
}

export function writeValue(dout: DataOutputX, v: SValue): void {
  if (v === null || v === undefined) {
    dout.writeByte(ValueEnum.NULL);
  } else if (typeof v === "boolean") {
    dout.writeByte(ValueEnum.BOOLEAN);
    dout.writeBoolean(v);
  } else if (typeof v === "number") {
    if (Number.isInteger(v)) {
      dout.writeByte(ValueEnum.DECIMAL);
      dout.writeDecimal(v);
    } else {
      dout.writeByte(ValueEnum.DOUBLE);
      dout.writeDouble(v);
    }
  } else if (typeof v === "bigint") {
    dout.writeByte(ValueEnum.DECIMAL);
    dout.writeDecimal(v);
  } else if (typeof v === "string") {
    dout.writeByte(ValueEnum.TEXT);
    dout.writeText(v);
  } else if (Buffer.isBuffer(v)) {
    dout.writeByte(ValueEnum.BLOB);
    dout.writeBlob(v);
  } else if (Array.isArray(v)) {
    dout.writeByte(ValueEnum.LIST);
    dout.writeDecimal(v.length);
    for (const item of v) writeValue(dout, item);
  } else if (typeof v === "object") {
    dout.writeByte(ValueEnum.MAP);
    const entries = Object.entries(v);
    dout.writeDecimal(entries.length);
    for (const [key, val] of entries) {
      dout.writeText(key);
      writeValue(dout, val as SValue);
    }
  }
}
