import { describe, it, expect } from "vitest";
import { DataOutputX } from "../../protocol/data-output.js";
import { AsyncDataInput, type ByteReader } from "../../protocol/async-data-input.js";
import { readValueAsync, readPackAsync } from "../../protocol/pack-reader.js";
import { writeValue, type SValue } from "../../protocol/values.js";
import { ValueEnum, PackEnum } from "../../protocol/constants.js";

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

describe("readValueAsync - roundtrip against writeValue", () => {
  async function roundtrip(v: SValue): Promise<SValue> {
    const dout = new DataOutputX();
    writeValue(dout, v);
    const adi = asyncInput(dout.toBuffer());
    return readValueAsync(adi);
  }

  it("should read null", async () => {
    expect(await roundtrip(null)).toBeNull();
  });

  it("should read booleans", async () => {
    expect(await roundtrip(true)).toBe(true);
    expect(await roundtrip(false)).toBe(false);
  });

  it("should read integers (DECIMAL) within safe-integer range as number", async () => {
    expect(await roundtrip(0)).toBe(0);
    expect(await roundtrip(-100)).toBe(-100);
    expect(await roundtrip(100000)).toBe(100000);
  });

  it("should read bigint beyond safe-integer range as bigint", async () => {
    const v = 9223372036854775807n;
    const result = await roundtrip(v);
    expect(result).toBe(v);
    expect(typeof result).toBe("bigint");
  });

  it("should read non-integer numbers as DOUBLE", async () => {
    expect(await roundtrip(3.14) as number).toBeCloseTo(3.14, 10);
  });

  it("should read strings (TEXT) including empty and unicode", async () => {
    expect(await roundtrip("hello")).toBe("hello");
    expect(await roundtrip("")).toBe("");
    expect(await roundtrip("한글")).toBe("한글");
  });

  it("should read Buffer (BLOB)", async () => {
    const buf = Buffer.from([1, 2, 3]);
    expect(await roundtrip(buf)).toEqual(buf);
  });

  it("should read arrays (LIST) recursively", async () => {
    const arr: SValue[] = [1, "two", true, null, [3, 4]];
    const result = (await roundtrip(arr)) as SValue[];
    expect(result[0]).toBe(1);
    expect(result[1]).toBe("two");
    expect(result[2]).toBe(true);
    expect(result[3]).toBeNull();
    expect(result[4]).toEqual([3, 4]);
  });

  it("should read objects (MAP) recursively", async () => {
    const obj: SValue = { a: 1, b: "x", c: { nested: true } };
    expect(await roundtrip(obj)).toEqual(obj);
  });
});

describe("readValueAsync - known-bytes decoding of types unreachable via writeValue", () => {
  it("should read FLOAT", async () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.FLOAT);
    dout.writeFloat(2.5);
    const adi = asyncInput(dout.toBuffer());
    expect(await readValueAsync(adi) as number).toBeCloseTo(2.5, 4);
  });

  it("should read TEXT_HASH as a decimal number", async () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.TEXT_HASH);
    dout.writeDecimal(42424242);
    const adi = asyncInput(dout.toBuffer());
    expect(await readValueAsync(adi)).toBe(42424242);
  });

  it("should read IP4ADDR as 4 raw bytes", async () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.IP4ADDR);
    dout.writeRaw(Buffer.from([10, 0, 0, 1]));
    const adi = asyncInput(dout.toBuffer());
    expect(await readValueAsync(adi)).toEqual(Buffer.from([10, 0, 0, 1]));
  });

  it("should read DOUBLE_SUMMARY", async () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.DOUBLE_SUMMARY);
    dout.writeDecimal(4);
    dout.writeDouble(40);
    dout.writeDouble(1);
    dout.writeDouble(20);
    const adi = asyncInput(dout.toBuffer());
    expect(await readValueAsync(adi)).toEqual({ count: 4, sum: 40, min: 1, max: 20 });
  });

  it("should read LONG_SUMMARY", async () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.LONG_SUMMARY);
    dout.writeDecimal(2);
    dout.writeDecimal(300);
    dout.writeDecimal(100);
    dout.writeDecimal(200);
    const adi = asyncInput(dout.toBuffer());
    expect(await readValueAsync(adi)).toEqual({ count: 2, sum: 300, min: 100, max: 200 });
  });

  it("should read ARRAY_INT and ARRAY_LONG through the shared decimal-array branch", async () => {
    for (const type of [ValueEnum.ARRAY_INT, ValueEnum.ARRAY_LONG]) {
      const dout = new DataOutputX();
      dout.writeByte(type);
      dout.writeDecimal(2);
      dout.writeDecimal(11);
      dout.writeDecimal(-22);
      const adi = asyncInput(dout.toBuffer());
      expect(await readValueAsync(adi)).toEqual([11, -22]);
    }
  });

  it("should read ARRAY_FLOAT", async () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.ARRAY_FLOAT);
    dout.writeDecimal(2);
    dout.writeFloat(1.25);
    dout.writeFloat(-1.25);
    const adi = asyncInput(dout.toBuffer());
    const result = (await readValueAsync(adi)) as number[];
    expect(result[0]).toBeCloseTo(1.25, 4);
    expect(result[1]).toBeCloseTo(-1.25, 4);
  });

  it("should read ARRAY_TEXT", async () => {
    const dout = new DataOutputX();
    dout.writeByte(ValueEnum.ARRAY_TEXT);
    dout.writeDecimal(2);
    dout.writeText("a");
    dout.writeText("b");
    const adi = asyncInput(dout.toBuffer());
    expect(await readValueAsync(adi)).toEqual(["a", "b"]);
  });

  it("should return null (not throw) for an unknown value type byte", async () => {
    // differs from the synchronous values.ts readValue, which throws on unknown types
    const adi = asyncInput(Buffer.from([200]));
    expect(await readValueAsync(adi)).toBeNull();
  });
});

describe("readPackAsync - MAP pack", () => {
  it("should decode a map pack", async () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.MAP);
    dout.writeDecimal(2);
    dout.writeText("k1");
    writeValue(dout, "v1");
    dout.writeText("k2");
    writeValue(dout, 42);
    const adi = asyncInput(dout.toBuffer());
    const pack = await readPackAsync(adi);
    expect(pack).toEqual({ type: "map", data: { k1: "v1", k2: 42 } });
  });
});

describe("readPackAsync - OBJECT pack", () => {
  it("should decode all fields including MAP tags", async () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.OBJECT);
    dout.writeText("java");
    dout.writeDecimal(555);
    dout.writeText("obj1");
    dout.writeText("10.0.0.1");
    dout.writeText("2.0.0");
    dout.writeBoolean(false);
    dout.writeDecimal(111);
    writeValue(dout, { zone: "a" });
    const adi = asyncInput(dout.toBuffer());
    const pack = await readPackAsync(adi);
    expect(pack).toEqual({
      type: "object",
      objType: "java",
      objHash: 555,
      objName: "obj1",
      address: "10.0.0.1",
      version: "2.0.0",
      alive: false,
      wakeup: 111,
      tags: { zone: "a" },
    });
  });

  it("should default tags to {} when the tags value is NULL", async () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.OBJECT);
    dout.writeText("java");
    dout.writeDecimal(0);
    dout.writeText("");
    dout.writeText("");
    dout.writeText("");
    dout.writeBoolean(true);
    dout.writeDecimal(0);
    writeValue(dout, null);
    const adi = asyncInput(dout.toBuffer());
    const pack = (await readPackAsync(adi)) as { tags: unknown };
    expect(pack.tags).toEqual({});
  });
});

describe("readPackAsync - ALERT pack", () => {
  it("should decode all fields", async () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.ALERT);
    dout.writeLong(555555n);
    dout.writeByte(3); // FATAL
    dout.writeText("java");
    dout.writeInt(999);
    dout.writeText("title");
    dout.writeText("message");
    writeValue(dout, { k: "v" });
    const adi = asyncInput(dout.toBuffer());
    const pack = await readPackAsync(adi);
    expect(pack).toEqual({
      type: "alert",
      time: 555555n,
      level: 3,
      objType: "java",
      objHash: 999,
      title: "title",
      message: "message",
      tags: { k: "v" },
    });
  });

  it("should default tags to {} when the tags value is NULL", async () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.ALERT);
    dout.writeLong(0n);
    dout.writeByte(0);
    dout.writeText("");
    dout.writeInt(0);
    dout.writeText("");
    dout.writeText("");
    writeValue(dout, null);
    const adi = asyncInput(dout.toBuffer());
    const pack = (await readPackAsync(adi)) as { tags: unknown };
    expect(pack.tags).toEqual({});
  });
});

describe("readPackAsync - PROFILE pack (XLOG_PROFILE / XLOG_PROFILE2)", () => {
  function buildProfileBase(dout: DataOutputX) {
    dout.writeDecimal(2000);
    dout.writeDecimal(11);
    dout.writeDecimal(22);
    dout.writeLong(987654321n);
    dout.writeBlob(Buffer.from([5, 5, 5]));
  }

  it("should decode XLOG_PROFILE", async () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.XLOG_PROFILE);
    buildProfileBase(dout);
    const adi = asyncInput(dout.toBuffer());
    const pack = await readPackAsync(adi);
    expect(pack).toEqual({
      type: "profile",
      time: 2000,
      objHash: 11,
      service: 22,
      txid: 987654321n,
      profile: Buffer.from([5, 5, 5]),
    });
  });

  it("should decode XLOG_PROFILE2 and consume the trailing extra fields", async () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.XLOG_PROFILE2);
    buildProfileBase(dout);
    dout.writeLong(111n); // gxid
    dout.writeByte(1); // xType
    dout.writeByte(0); // discardType
    dout.writeBoolean(true); // ignoreGlobalConsequentSampling
    const adi = asyncInput(dout.toBuffer());
    const pack = await readPackAsync(adi);
    expect(pack).toEqual({
      type: "profile",
      time: 2000,
      objHash: 11,
      service: 22,
      txid: 987654321n,
      profile: Buffer.from([5, 5, 5]),
    });
  });
});

describe("readPackAsync - unknown pack type", () => {
  it("should return an unknown pack and not throw", async () => {
    const adi = asyncInput(Buffer.from([250]));
    const pack = await readPackAsync(adi);
    expect(pack).toEqual({ type: "unknown", raw: Buffer.alloc(0) });
  });
});

describe("readPackAsync - XLOG pack (readXLogFromBuffer) - progressive truncation", () => {
  // Mirrors the layout used in packs.test.ts for the sync readXLogPack implementation,
  // since readPackAsync's XLOG case reads a blob and hands it to the (unexported) sync
  // helper readXLogFromBuffer -- structurally identical to packs.ts's readXLogPack.
  function buildXLogSnapshots() {
    const dout = new DataOutputX();
    const snap: Record<string, Buffer> = {};

    dout.writeDecimal(200); // endTime
    dout.writeDecimal(3); // objHash
    dout.writeDecimal(4); // service
    dout.writeLong(444n); // txid
    dout.writeLong(555n); // caller
    dout.writeLong(666n); // gxid
    dout.writeDecimal(60); // elapsed
    dout.writeDecimal(1); // error
    dout.writeDecimal(15); // cpu
    dout.writeDecimal(2); // sqlCount
    dout.writeDecimal(6); // sqlTime
    dout.writeBlob(Buffer.from([9, 8, 7, 6])); // ipaddr
    dout.writeDecimal(30); // kbytes
    dout.writeDecimal(0); // status (deprecated)
    snap.afterStatus = dout.toBuffer();

    dout.writeDecimal(70); // userid
    dout.writeDecimal(80); // userAgent
    dout.writeDecimal(90); // referer
    dout.writeDecimal(2); // group
    dout.writeDecimal(4); // apicallCount
    dout.writeDecimal(5); // apicallTime
    snap.afterApicallTime = dout.toBuffer();

    dout.writeText("US"); // countryCode
    dout.writeDecimal(12); // city
    dout.writeByte(3); // xType
    dout.writeDecimal(0); // login
    dout.writeDecimal(1); // desc
    snap.afterDesc = dout.toBuffer();

    dout.writeDecimal(0); // webHash (deprecated)
    dout.writeDecimal(0); // webTime (deprecated)
    snap.afterWebHashWebTime = dout.toBuffer();

    dout.writeByte(0); // hasDump
    snap.afterHasDump = dout.toBuffer();

    dout.writeDecimal(321); // threadNameHash
    snap.afterThreadNameHash = dout.toBuffer();

    dout.writeText("t1"); // text1
    dout.writeText("t2"); // text2
    snap.afterText1Text2 = dout.toBuffer();

    dout.writeDecimal(1); // queuingHostHash
    dout.writeDecimal(2); // queuingTime
    dout.writeDecimal(3); // queuing2ndHostHash
    dout.writeDecimal(4); // queuing2ndTime
    snap.afterQueuing = dout.toBuffer();

    dout.writeText("t3"); // text3
    dout.writeText("t4"); // text4
    dout.writeText("t5"); // text5
    snap.afterText345 = dout.toBuffer();

    dout.writeDecimal(88); // profileCount
    snap.full = dout.toBuffer();

    return snap;
  }

  async function readXLogAsync(blobBytes: Buffer) {
    const outer = new DataOutputX();
    outer.writeByte(PackEnum.XLOG);
    outer.writeBlob(blobBytes);
    const adi = asyncInput(outer.toBuffer());
    return readPackAsync(adi) as Promise<Record<string, unknown>>;
  }

  const snap = buildXLogSnapshots();

  it("should stop right after status leaving defaults for the rest", async () => {
    const pack = await readXLogAsync(snap.afterStatus);
    expect(pack.endTime).toBe(200);
    expect(pack.objHash).toBe(3);
    expect(pack.service).toBe(4);
    expect(pack.txid).toBe(444n);
    expect(pack.caller).toBe(555n);
    expect(pack.gxid).toBe(666n);
    expect(pack.elapsed).toBe(60);
    expect(pack.error).toBe(1);
    expect(pack.cpu).toBe(15);
    expect(pack.sqlCount).toBe(2);
    expect(pack.sqlTime).toBe(6);
    expect(pack.ipaddr).toEqual(Buffer.from([9, 8, 7, 6]));
    expect(pack.kbytes).toBe(30);
    expect(pack.userid).toBeUndefined();
    expect(pack.text1).toBeUndefined();
  });

  it("should stop after the apicallTime group", async () => {
    const pack = await readXLogAsync(snap.afterApicallTime);
    expect(pack.userid).toBe(70);
    expect(pack.userAgent).toBe(80);
    expect(pack.referer).toBe(90);
    expect(pack.group).toBe(2);
    expect(pack.apicallCount).toBe(4);
    expect(pack.apicallTime).toBe(5);
    expect(pack.countryCode).toBeUndefined();
  });

  it("should stop after countryCode/city/xType/login/desc group", async () => {
    const pack = await readXLogAsync(snap.afterDesc);
    expect(pack.countryCode).toBe("US");
    expect(pack.city).toBe(12);
    expect(pack.xType).toBe(3);
    expect(pack.login).toBe(0);
    expect(pack.desc).toBe(1);
    expect(pack.text1).toBeUndefined();
  });

  it("should stop after the deprecated webHash/webTime group", async () => {
    const pack = await readXLogAsync(snap.afterWebHashWebTime);
    expect(pack.desc).toBe(1);
    expect(pack.text1).toBeUndefined();
  });

  it("should stop after the deprecated hasDump byte", async () => {
    const pack = await readXLogAsync(snap.afterHasDump);
    expect(pack.text1).toBeUndefined();
  });

  it("should stop after the deprecated threadNameHash", async () => {
    const pack = await readXLogAsync(snap.afterThreadNameHash);
    expect(pack.text1).toBeUndefined();
  });

  it("should stop after text1/text2", async () => {
    const pack = await readXLogAsync(snap.afterText1Text2);
    expect(pack.text1).toBe("t1");
    expect(pack.text2).toBe("t2");
    expect(pack.text3).toBeUndefined();
  });

  it("should stop after the deprecated queuing fields", async () => {
    const pack = await readXLogAsync(snap.afterQueuing);
    expect(pack.text3).toBeUndefined();
    expect(pack.profileCount).toBeUndefined();
  });

  it("should stop after text3/text4/text5 (having consumed the deprecated queuing fields)", async () => {
    const pack = await readXLogAsync(snap.afterText345);
    expect(pack.text3).toBe("t3");
    expect(pack.text4).toBe("t4");
    expect(pack.text5).toBe("t5");
    expect(pack.profileCount).toBeUndefined();
  });

  it("should decode the full form including profileCount", async () => {
    const pack = await readXLogAsync(snap.full);
    expect(pack.profileCount).toBe(88);
  });

  it("should decode DROPPED_XLOG through the same code path as XLOG", async () => {
    const outer = new DataOutputX();
    outer.writeByte(PackEnum.DROPPED_XLOG);
    outer.writeBlob(snap.full);
    const adi = asyncInput(outer.toBuffer());
    const pack = (await readPackAsync(adi)) as Record<string, unknown>;
    expect(pack.type).toBe("xlog");
    expect(pack.profileCount).toBe(88);
  });
});
