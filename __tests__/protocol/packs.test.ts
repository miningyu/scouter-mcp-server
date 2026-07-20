import { describe, it, expect } from "vitest";
import { DataOutputX } from "../../protocol/data-output.js";
import { DataInputX } from "../../protocol/data-input.js";
import { readPack, writeMapPack, type MapPack, type XLogPack } from "../../protocol/packs.js";
import { writeValue } from "../../protocol/values.js";
import { PackEnum } from "../../protocol/constants.js";

describe("MAP pack", () => {
  it("should roundtrip via writeMapPack -> readPack", () => {
    const dout = new DataOutputX();
    writeMapPack(dout, { name: "obj1", count: 42, active: true, nested: { a: 1 } });
    const din = new DataInputX(dout.toBuffer());
    const pack = readPack(din) as MapPack;
    expect(pack.type).toBe("map");
    expect(pack.data).toEqual({ name: "obj1", count: 42, active: true, nested: { a: 1 } });
    expect(din.available()).toBe(0);
  });

  it("should roundtrip an empty map", () => {
    const dout = new DataOutputX();
    writeMapPack(dout, {});
    const din = new DataInputX(dout.toBuffer());
    const pack = readPack(din) as MapPack;
    expect(pack.data).toEqual({});
  });
});

describe("OBJECT pack", () => {
  function buildObjectPack(tagsWriter: (dout: DataOutputX) => void): Buffer {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.OBJECT);
    dout.writeText("java");
    dout.writeDecimal(12345);
    dout.writeText("myObject");
    dout.writeText("127.0.0.1");
    dout.writeText("1.0.0");
    dout.writeBoolean(true);
    dout.writeDecimal(999);
    tagsWriter(dout);
    return dout.toBuffer();
  }

  it("should decode all fields including a MAP tags value", () => {
    const buf = buildObjectPack((dout) => writeValue(dout, { region: "kr" }));
    const din = new DataInputX(buf);
    const pack = readPack(din);
    expect(pack).toEqual({
      type: "object",
      objType: "java",
      objHash: 12345,
      objName: "myObject",
      address: "127.0.0.1",
      version: "1.0.0",
      alive: true,
      wakeup: 999,
      tags: { region: "kr" },
    });
    expect(din.available()).toBe(0);
  });

  it("should default tags to {} when the value is NULL", () => {
    const buf = buildObjectPack((dout) => writeValue(dout, null));
    const din = new DataInputX(buf);
    const pack = readPack(din) as { tags: unknown };
    expect(pack.tags).toEqual({});
  });
});

describe("ALERT pack", () => {
  it("should decode all fields", () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.ALERT);
    dout.writeLong(1234567890123n);
    dout.writeByte(2); // level = ERROR
    dout.writeText("java");
    dout.writeInt(5555);
    dout.writeText("Disk Full");
    dout.writeText("disk usage exceeded 90%");
    writeValue(dout, { host: "server1" });
    const din = new DataInputX(dout.toBuffer());
    const pack = readPack(din);
    expect(pack).toEqual({
      type: "alert",
      time: 1234567890123n,
      level: 2,
      objType: "java",
      objHash: 5555,
      title: "Disk Full",
      message: "disk usage exceeded 90%",
      tags: { host: "server1" },
    });
    expect(din.available()).toBe(0);
  });

  it("should default tags to {} when the value is NULL", () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.ALERT);
    dout.writeLong(0n);
    dout.writeByte(0);
    dout.writeText("");
    dout.writeInt(0);
    dout.writeText("");
    dout.writeText("");
    writeValue(dout, null);
    const din = new DataInputX(dout.toBuffer());
    const pack = readPack(din) as { tags: unknown };
    expect(pack.tags).toEqual({});
  });
});

describe("PROFILE pack (XLOG_PROFILE / XLOG_PROFILE2)", () => {
  function buildProfileBase(dout: DataOutputX) {
    dout.writeDecimal(1000);
    dout.writeDecimal(42);
    dout.writeDecimal(7);
    dout.writeLong(123456789n);
    dout.writeBlob(Buffer.from([9, 9, 9]));
  }

  it("should decode XLOG_PROFILE (no extra fields)", () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.XLOG_PROFILE);
    buildProfileBase(dout);
    const din = new DataInputX(dout.toBuffer());
    const pack = readPack(din);
    expect(pack).toEqual({
      type: "profile",
      time: 1000,
      objHash: 42,
      service: 7,
      txid: 123456789n,
      profile: Buffer.from([9, 9, 9]),
    });
    expect(din.available()).toBe(0);
  });

  it("should decode XLOG_PROFILE2 without trailing extra fields (available < 10)", () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.XLOG_PROFILE2);
    buildProfileBase(dout);
    const din = new DataInputX(dout.toBuffer());
    const pack = readPack(din);
    expect(pack).toEqual({
      type: "profile",
      time: 1000,
      objHash: 42,
      service: 7,
      txid: 123456789n,
      profile: Buffer.from([9, 9, 9]),
    });
    expect(din.available()).toBe(0);
  });

  it("should consume trailing extra fields for XLOG_PROFILE2 when present", () => {
    const dout = new DataOutputX();
    dout.writeByte(PackEnum.XLOG_PROFILE2);
    buildProfileBase(dout);
    dout.writeLong(999n); // gxid
    dout.writeByte(1);    // xType
    dout.writeByte(0);    // discardType
    dout.writeBoolean(true); // ignoreGlobalConsequentSampling
    const din = new DataInputX(dout.toBuffer());
    const pack = readPack(din);
    expect(pack).toEqual({
      type: "profile",
      time: 1000,
      objHash: 42,
      service: 7,
      txid: 123456789n,
      profile: Buffer.from([9, 9, 9]),
    });
    // the extra 11 bytes (gxid/xType/discardType/ignoreGlobalConsequentSampling) were consumed
    expect(din.available()).toBe(0);
  });
});

describe("unknown pack type", () => {
  it("should return an unknown pack and not throw", () => {
    const din = new DataInputX(Buffer.from([250, 1, 2, 3])); // 250 is not a valid PackEnum member
    const pack = readPack(din);
    expect(pack).toEqual({ type: "unknown", raw: Buffer.alloc(0) });
    // skipUnknownPack does not consume the remaining bytes itself
    expect(din.available()).toBe(3);
  });
});

describe("XLOG pack (readXLogPack) - progressive truncation across every optional field group", () => {
  // Builds the inner (blob-wrapped) xlog byte layout incrementally, capturing a snapshot
  // after each field group so we can test every early-return branch in readXLogPack.
  function buildXLogSnapshots() {
    const dout = new DataOutputX();
    const snap: Record<string, Buffer> = {};

    dout.writeDecimal(100); // endTime
    dout.writeDecimal(1); // objHash
    dout.writeDecimal(2); // service
    dout.writeLong(111n); // txid
    dout.writeLong(222n); // caller
    dout.writeLong(333n); // gxid
    dout.writeDecimal(50); // elapsed
    dout.writeDecimal(0); // error
    dout.writeDecimal(10); // cpu
    dout.writeDecimal(3); // sqlCount
    dout.writeDecimal(5); // sqlTime
    dout.writeBlob(Buffer.from([1, 2, 3, 4])); // ipaddr
    dout.writeDecimal(20); // kbytes
    dout.writeDecimal(0); // status (deprecated)
    snap.afterStatus = dout.toBuffer();

    dout.writeDecimal(7); // userid
    dout.writeDecimal(8); // userAgent
    dout.writeDecimal(9); // referer
    dout.writeDecimal(1); // group
    dout.writeDecimal(3); // apicallCount
    dout.writeDecimal(4); // apicallTime
    snap.afterApicallTime = dout.toBuffer();

    dout.writeText("KR"); // countryCode
    dout.writeDecimal(11); // city
    dout.writeByte(2); // xType
    dout.writeDecimal(1); // login
    dout.writeDecimal(0); // desc
    snap.afterDesc = dout.toBuffer();

    dout.writeDecimal(0); // webHash (deprecated)
    dout.writeDecimal(0); // webTime (deprecated)
    snap.afterWebHashWebTime = dout.toBuffer();

    dout.writeByte(1); // hasDump
    snap.afterHasDump = dout.toBuffer();

    dout.writeDecimal(555); // threadNameHash
    snap.afterThreadNameHash = dout.toBuffer();

    dout.writeText("text1val"); // text1
    dout.writeText("text2val"); // text2
    snap.afterText1Text2 = dout.toBuffer();

    dout.writeDecimal(1); // queuingHostHash
    dout.writeDecimal(2); // queuingTime
    dout.writeDecimal(3); // queuing2ndHostHash
    dout.writeDecimal(4); // queuing2ndTime
    snap.afterQueuing = dout.toBuffer();

    dout.writeText("text3val"); // text3
    dout.writeText("text4val"); // text4
    dout.writeText("text5v"); // text5 (kept short so the "full" blob stays <= 127 bytes;
    // DataOutputX.writeBlob has a bug where lengths 128-253 pass a value > 127 to
    // Buffer.writeInt8 and throw -- not something we can work around by fixing source)
    snap.afterText345 = dout.toBuffer();

    dout.writeDecimal(77); // profileCount
    snap.full = dout.toBuffer();

    return snap;
  }

  function readXLog(blobBytes: Buffer): XLogPack {
    const outer = new DataOutputX();
    outer.writeByte(PackEnum.XLOG);
    outer.writeBlob(blobBytes);
    const din = new DataInputX(outer.toBuffer());
    return readPack(din) as XLogPack;
  }

  const snap = buildXLogSnapshots();

  it("should stop right after status (short form) leaving defaults for the rest", () => {
    const pack = readXLog(snap.afterStatus);
    expect(pack.endTime).toBe(100);
    expect(pack.objHash).toBe(1);
    expect(pack.service).toBe(2);
    expect(pack.txid).toBe(111n);
    expect(pack.caller).toBe(222n);
    expect(pack.gxid).toBe(333n);
    expect(pack.elapsed).toBe(50);
    expect(pack.error).toBe(0);
    expect(pack.cpu).toBe(10);
    expect(pack.sqlCount).toBe(3);
    expect(pack.sqlTime).toBe(5);
    expect(pack.ipaddr).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(pack.kbytes).toBe(20);
    // fields beyond status remain at their defaults
    expect(pack.userid).toBe(0);
    expect(pack.countryCode).toBe("");
    expect(pack.text1).toBe("");
    expect(pack.profileCount).toBe(0);
  });

  it("should stop after apicallTime group", () => {
    const pack = readXLog(snap.afterApicallTime);
    expect(pack.userid).toBe(7);
    expect(pack.userAgent).toBe(8);
    expect(pack.referer).toBe(9);
    expect(pack.group).toBe(1);
    expect(pack.apicallCount).toBe(3);
    expect(pack.apicallTime).toBe(4);
    expect(pack.countryCode).toBe(""); // not yet read
    expect(pack.text1).toBe("");
  });

  it("should stop after countryCode/city/xType/login/desc group", () => {
    const pack = readXLog(snap.afterDesc);
    expect(pack.countryCode).toBe("KR");
    expect(pack.city).toBe(11);
    expect(pack.xType).toBe(2);
    expect(pack.login).toBe(1);
    expect(pack.desc).toBe(0);
    expect(pack.text1).toBe(""); // not yet read
  });

  it("should stop after the deprecated webHash/webTime group", () => {
    const pack = readXLog(snap.afterWebHashWebTime);
    expect(pack.desc).toBe(0);
    expect(pack.text1).toBe("");
  });

  it("should stop after the deprecated hasDump byte", () => {
    const pack = readXLog(snap.afterHasDump);
    expect(pack.text1).toBe("");
  });

  it("should stop after the deprecated threadNameHash", () => {
    const pack = readXLog(snap.afterThreadNameHash);
    expect(pack.text1).toBe("");
  });

  it("should stop after text1/text2", () => {
    const pack = readXLog(snap.afterText1Text2);
    expect(pack.text1).toBe("text1val");
    expect(pack.text2).toBe("text2val");
    expect(pack.text3).toBe(""); // not yet read
  });

  it("should stop after the deprecated queuing fields", () => {
    const pack = readXLog(snap.afterQueuing);
    expect(pack.text3).toBe("");
    expect(pack.profileCount).toBe(0);
  });

  it("should stop after text3/text4/text5", () => {
    const pack = readXLog(snap.afterText345);
    expect(pack.text3).toBe("text3val");
    expect(pack.text4).toBe("text4val");
    expect(pack.text5).toBe("text5v");
    expect(pack.profileCount).toBe(0); // not yet read
  });

  it("should decode the full form including profileCount", () => {
    const pack = readXLog(snap.full);
    expect(pack.text3).toBe("text3val");
    expect(pack.text4).toBe("text4val");
    expect(pack.text5).toBe("text5v");
    expect(pack.profileCount).toBe(77);
  });

  it("should decode DROPPED_XLOG through the same code path as XLOG", () => {
    const outer = new DataOutputX();
    outer.writeByte(PackEnum.DROPPED_XLOG);
    outer.writeBlob(snap.full);
    const din = new DataInputX(outer.toBuffer());
    const pack = readPack(din) as XLogPack;
    expect(pack.type).toBe("xlog");
    expect(pack.profileCount).toBe(77);
  });
});
