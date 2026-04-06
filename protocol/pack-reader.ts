import { AsyncDataInput } from "./async-data-input.js";
import { DataInputX } from "./data-input.js";
import { ValueEnum, PackEnum } from "./constants.js";
import type { Pack, MapPack } from "./packs.js";
import type { SValue } from "./values.js";

export async function readValueAsync(s: AsyncDataInput): Promise<SValue> {
  const type = await s.readUnsignedByte();
  switch (type) {
    case ValueEnum.NULL: return null;
    case ValueEnum.BOOLEAN: return s.readBoolean();
    case ValueEnum.DECIMAL: {
      const v = await s.readDecimalLong();
      return (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : v;
    }
    case ValueEnum.FLOAT: return s.readFloat();
    case ValueEnum.DOUBLE: return s.readDouble();
    case ValueEnum.TEXT: return s.readText();
    case ValueEnum.TEXT_HASH: return s.readDecimal();
    case ValueEnum.BLOB: return s.readBlob();
    case ValueEnum.IP4ADDR: return s.readBytes(4);
    case ValueEnum.LIST: {
      const count = await s.readDecimal();
      const list: SValue[] = [];
      for (let i = 0; i < count; i++) list.push(await readValueAsync(s));
      return list;
    }
    case ValueEnum.MAP: {
      const count = await s.readDecimal();
      const map: Record<string, SValue> = {};
      for (let i = 0; i < count; i++) {
        map[await s.readText()] = await readValueAsync(s);
      }
      return map;
    }
    case ValueEnum.DOUBLE_SUMMARY:
      return { count: await s.readDecimal(), sum: await s.readDouble(), min: await s.readDouble(), max: await s.readDouble() };
    case ValueEnum.LONG_SUMMARY:
      return { count: await s.readDecimal(), sum: await s.readDecimal(), min: await s.readDecimal(), max: await s.readDecimal() };
    case ValueEnum.ARRAY_INT:
    case ValueEnum.ARRAY_LONG: {
      const cnt = await s.readDecimal();
      const arr: number[] = [];
      for (let i = 0; i < cnt; i++) arr.push(await s.readDecimal());
      return arr;
    }
    case ValueEnum.ARRAY_FLOAT: {
      const cnt = await s.readDecimal();
      const arr: number[] = [];
      for (let i = 0; i < cnt; i++) arr.push(await s.readFloat());
      return arr;
    }
    case ValueEnum.ARRAY_TEXT: {
      const cnt = await s.readDecimal();
      const arr: string[] = [];
      for (let i = 0; i < cnt; i++) arr.push(await s.readText());
      return arr;
    }
    default: return null;
  }
}

export async function readPackAsync(s: AsyncDataInput): Promise<Pack> {
  const packType = await s.readUnsignedByte();
  switch (packType) {
    case PackEnum.MAP: {
      const count = await s.readDecimal();
      const data: Record<string, SValue> = {};
      for (let i = 0; i < count; i++) {
        data[await s.readText()] = await readValueAsync(s);
      }
      return { type: "map", data } as MapPack;
    }
    case PackEnum.OBJECT: {
      const obj = {
        type: "object" as const,
        objType: await s.readText(),
        objHash: await s.readDecimal(),
        objName: await s.readText(),
        address: await s.readText(),
        version: await s.readText(),
        alive: await s.readBoolean(),
        wakeup: await s.readDecimal(),
        tags: (await readValueAsync(s) ?? {}) as Record<string, SValue>,
      };
      return obj;
    }
    case PackEnum.XLOG:
    case PackEnum.DROPPED_XLOG: {
      const blob = await s.readBlob();
      const din = new DataInputX(blob);
      return readXLogFromBuffer(din);
    }
    case PackEnum.ALERT: {
      return {
        type: "alert",
        time: await s.readLong(),
        level: await s.readByte(),
        objType: await s.readText(),
        objHash: await s.readInt(),
        title: await s.readText(),
        message: await s.readText(),
        tags: (await readValueAsync(s) ?? {}) as Record<string, SValue>,
      };
    }
    case PackEnum.XLOG_PROFILE:
    case PackEnum.XLOG_PROFILE2: {
      const pack = {
        type: "profile" as const,
        time: await s.readDecimal(),
        objHash: await s.readDecimal(),
        service: await s.readDecimal(),
        txid: await s.readLong(),
        profile: await s.readBlob(),
      };
      if (packType === PackEnum.XLOG_PROFILE2) {
        await s.readLong();    // gxid
        await s.readByte();    // xType
        await s.readByte();    // discardType
        await s.readBoolean(); // ignoreGlobalConsequentSampling
      }
      return pack;
    }
    default:
      return { type: "unknown", raw: Buffer.alloc(0) };
  }
}

function readXLogFromBuffer(d: DataInputX): Pack {
  const pack: Record<string, unknown> = { type: "xlog" };
  pack.endTime = d.readDecimal();
  pack.objHash = d.readDecimal();
  pack.service = d.readDecimal();
  pack.txid = d.readLong();
  pack.caller = d.readLong();
  pack.gxid = d.readLong();
  pack.elapsed = d.readDecimal();
  pack.error = d.readDecimal();
  pack.cpu = d.readDecimal();
  pack.sqlCount = d.readDecimal();
  pack.sqlTime = d.readDecimal();
  pack.ipaddr = d.readBlob();
  pack.kbytes = d.readDecimal();
  d.readDecimal(); // status deprecated
  if (d.available() <= 0) return pack as Pack;
  pack.userid = d.readDecimal();
  pack.userAgent = d.readDecimal();
  pack.referer = d.readDecimal();
  pack.group = d.readDecimal();
  pack.apicallCount = d.readDecimal();
  pack.apicallTime = d.readDecimal();
  if (d.available() <= 0) return pack as Pack;
  pack.countryCode = d.readText();
  pack.city = d.readDecimal();
  pack.xType = d.readUnsignedByte();
  pack.login = d.readDecimal();
  pack.desc = d.readDecimal();
  if (d.available() <= 0) return pack as Pack;
  d.readDecimal(); d.readDecimal(); // webHash, webTime deprecated
  if (d.available() <= 0) return pack as Pack;
  d.readUnsignedByte(); // hasDump
  if (d.available() <= 0) return pack as Pack;
  d.readDecimal(); // threadNameHash
  if (d.available() <= 0) return pack as Pack;
  pack.text1 = d.readText();
  pack.text2 = d.readText();
  if (d.available() <= 0) return pack as Pack;
  d.readDecimal(); d.readDecimal(); d.readDecimal(); d.readDecimal(); // queuing
  if (d.available() <= 0) return pack as Pack;
  pack.text3 = d.readText();
  pack.text4 = d.readText();
  pack.text5 = d.readText();
  if (d.available() <= 0) return pack as Pack;
  pack.profileCount = d.readDecimal();
  return pack as Pack;
}
