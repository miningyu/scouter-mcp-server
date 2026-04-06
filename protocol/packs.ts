import { DataInputX } from "./data-input.js";
import { DataOutputX } from "./data-output.js";
import { PackEnum, ValueEnum } from "./constants.js";
import { readValue, writeValue, type SValue } from "./values.js";

export interface MapPack {
  type: "map";
  data: Record<string, SValue>;
}

export interface ObjectPack {
  type: "object";
  objType: string;
  objHash: number;
  objName: string;
  address: string;
  version: string;
  alive: boolean;
  wakeup: number;
  tags: Record<string, SValue>;
  counter?: SValue;
}

export interface XLogPack {
  type: "xlog";
  endTime: number;
  objHash: number;
  service: number;
  txid: bigint;
  caller: bigint;
  gxid: bigint;
  elapsed: number;
  error: number;
  cpu: number;
  sqlCount: number;
  sqlTime: number;
  ipaddr: Buffer;
  kbytes: number;
  userid: number;
  userAgent: number;
  referer: number;
  group: number;
  apicallCount: number;
  apicallTime: number;
  countryCode: string;
  city: number;
  xType: number;
  login: number;
  desc: number;
  text1: string;
  text2: string;
  text3: string;
  text4: string;
  text5: string;
  profileCount: number;
  [key: string]: unknown;
}

export interface AlertPack {
  type: "alert";
  time: bigint;
  level: number;
  objType: string;
  objHash: number;
  title: string;
  message: string;
  tags: Record<string, SValue>;
}

export interface ProfilePack {
  type: "profile";
  time: number;
  objHash: number;
  service: number;
  txid: bigint;
  profile: Buffer;
}

export type Pack = MapPack | ObjectPack | XLogPack | AlertPack | ProfilePack | { type: "unknown"; raw: Buffer };

export function readPack(din: DataInputX): Pack {
  const packType = din.readUnsignedByte();
  switch (packType) {
    case PackEnum.MAP: return readMapPack(din);
    case PackEnum.OBJECT: return readObjectPack(din);
    case PackEnum.XLOG:
    case PackEnum.DROPPED_XLOG: return readXLogPack(din);
    case PackEnum.ALERT: return readAlertPack(din);
    case PackEnum.XLOG_PROFILE:
    case PackEnum.XLOG_PROFILE2: return readProfilePack(din, packType);
    default: return skipUnknownPack(din);
  }
}

function readMapPack(din: DataInputX): MapPack {
  const count = din.readDecimal();
  const data: Record<string, SValue> = {};
  for (let i = 0; i < count; i++) {
    const key = din.readText();
    data[key] = readValue(din);
  }
  return { type: "map", data };
}

function readObjectPack(din: DataInputX): ObjectPack {
  return {
    type: "object",
    objType: din.readText(),
    objHash: din.readDecimal(),
    objName: din.readText(),
    address: din.readText(),
    version: din.readText(),
    alive: din.readBoolean(),
    wakeup: din.readDecimal(),
    tags: readValue(din) as Record<string, SValue> ?? {},
  };
}

function readXLogPack(din: DataInputX): XLogPack {
  const blob = din.readBlob();
  const d = new DataInputX(blob);
  const pack: XLogPack = {
    type: "xlog",
    endTime: d.readDecimal(),
    objHash: d.readDecimal(),
    service: d.readDecimal(),
    txid: d.readLong(),
    caller: d.readLong(),
    gxid: d.readLong(),
    elapsed: d.readDecimal(),
    error: d.readDecimal(),
    cpu: d.readDecimal(),
    sqlCount: d.readDecimal(),
    sqlTime: d.readDecimal(),
    ipaddr: d.readBlob(),
    kbytes: d.readDecimal(),
    userid: 0, userAgent: 0, referer: 0, group: 0,
    apicallCount: 0, apicallTime: 0,
    countryCode: "", city: 0, xType: 0, login: 0, desc: 0,
    text1: "", text2: "", text3: "", text4: "", text5: "",
    profileCount: 0,
  };
  d.readDecimal(); // status (deprecated)
  if (d.available() <= 0) return pack;
  pack.userid = d.readDecimal();
  pack.userAgent = d.readDecimal();
  pack.referer = d.readDecimal();
  pack.group = d.readDecimal();
  pack.apicallCount = d.readDecimal();
  pack.apicallTime = d.readDecimal();
  if (d.available() <= 0) return pack;
  pack.countryCode = d.readText();
  pack.city = d.readDecimal();
  pack.xType = d.readUnsignedByte();
  pack.login = d.readDecimal();
  pack.desc = d.readDecimal();
  if (d.available() <= 0) return pack;
  d.readDecimal(); // webHash deprecated
  d.readDecimal(); // webTime deprecated
  if (d.available() <= 0) return pack;
  d.readUnsignedByte(); // hasDump
  if (d.available() <= 0) return pack;
  d.readDecimal(); // threadNameHash
  if (d.available() <= 0) return pack;
  pack.text1 = d.readText();
  pack.text2 = d.readText();
  if (d.available() <= 0) return pack;
  d.readDecimal(); // queuingHostHash
  d.readDecimal(); // queuingTime
  d.readDecimal(); // queuing2ndHostHash
  d.readDecimal(); // queuing2ndTime
  if (d.available() <= 0) return pack;
  pack.text3 = d.readText();
  pack.text4 = d.readText();
  pack.text5 = d.readText();
  if (d.available() <= 0) return pack;
  pack.profileCount = d.readDecimal();
  return pack;
}

function readAlertPack(din: DataInputX): AlertPack {
  return {
    type: "alert",
    time: din.readLong(),
    level: din.readByte(),
    objType: din.readText(),
    objHash: din.readInt(),
    title: din.readText(),
    message: din.readText(),
    tags: readValue(din) as Record<string, SValue> ?? {},
  };
}

function readProfilePack(din: DataInputX, packType: number): ProfilePack {
  const pack: ProfilePack = {
    type: "profile",
    time: din.readDecimal(),
    objHash: din.readDecimal(),
    service: din.readDecimal(),
    txid: din.readLong(),
    profile: din.readBlob(),
  };
  if (packType === PackEnum.XLOG_PROFILE2 && din.available() >= 10) {
    din.readLong();    // gxid
    din.readByte();    // xType
    din.readByte();    // discardType
    din.readBoolean(); // ignoreGlobalConsequentSampling
  }
  return pack;
}

function skipUnknownPack(din: DataInputX): { type: "unknown"; raw: Buffer } {
  return { type: "unknown", raw: Buffer.alloc(0) };
}

export function writeMapPack(dout: DataOutputX, data: Record<string, SValue>): void {
  dout.writeByte(PackEnum.MAP);
  const entries = Object.entries(data);
  dout.writeDecimal(entries.length);
  for (const [key, val] of entries) {
    dout.writeText(key);
    writeValue(dout, val);
  }
}
