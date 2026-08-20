import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOperationContext } from "../../operations/context.js";
import {
  OperationConfirmationError,
  OperationInputError,
  OperationPermissionError,
} from "../../operations/definition.js";
import { isWriteEnabled, parseOperationInput, runOperation } from "../../operations/execute.js";
import { getOperation } from "../../operations/registry.js";
import { createMockClient, MOCK_OBJECTS } from "./mock-client.js";

const overview = getOperation("get_system_overview")!;
const search = getOperation("search_transactions")!;
const setConfigure = getOperation("set_configure")!;
const controlThread = getOperation("control_thread")!;

let originalWrite: string | undefined;

beforeEach(() => {
  originalWrite = process.env.SCOUTER_ENABLE_WRITE;
  delete process.env.SCOUTER_ENABLE_WRITE;
});

afterEach(() => {
  if (originalWrite === undefined) delete process.env.SCOUTER_ENABLE_WRITE;
  else process.env.SCOUTER_ENABLE_WRITE = originalWrite;
});

describe("input validation", () => {
  it("rejects a wrongly typed field", () => {
    expect(() => parseOperationInput(search, { max_count: "many" }))
      .toThrow(OperationInputError);
  });

  it("names the offending field", () => {
    try {
      parseOperationInput(search, { max_count: "many" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain("search_transactions");
      expect((e as Error).message).toContain("max_count");
    }
  });

  it("rejects a missing required field", () => {
    expect(() => parseOperationInput(getOperation("lookup_text")!, { type: "sql" }))
      .toThrow(OperationInputError);
  });

  it("applies schema defaults", () => {
    expect(parseOperationInput(search, {})).toMatchObject({ max_count: 50 });
  });

  it("treats missing input as an empty object", () => {
    expect(parseOperationInput(overview, undefined)).toEqual({});
  });

  it("rejects an unknown input key instead of silently stripping it", () => {
    expect(() => parseOperationInput(search, { max_cuont: 5 }))
      .toThrow(OperationInputError);
  });
});

describe("write permission", () => {
  it("refuses a write operation when SCOUTER_ENABLE_WRITE is unset", async () => {
    const ctx = createOperationContext(createMockClient());
    await expect(runOperation(setConfigure, ctx, { target: "server", values: "a=b" }))
      .rejects.toThrow(OperationPermissionError);
  });

  it("refuses a write operation when SCOUTER_ENABLE_WRITE is not exactly 'true'", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "1";
    const ctx = createOperationContext(createMockClient());
    await expect(runOperation(setConfigure, ctx, { target: "server", values: "a=b" }))
      .rejects.toThrow(OperationPermissionError);
  });

  it("allows a write operation when SCOUTER_ENABLE_WRITE=true", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const ctx = createOperationContext(createMockClient());
    const result = await runOperation(setConfigure, ctx, { target: "server", values: "a=b" });
    expect(result).toMatchObject({ target: "server", result: "saved" });
  });

  it("never blocks a read-only operation", async () => {
    const ctx = createOperationContext(createMockClient());
    await expect(runOperation(overview, ctx, {})).resolves.toBeDefined();
  });

  it("isWriteEnabled only accepts the exact string 'true'", () => {
    expect(isWriteEnabled()).toBe(false);
    process.env.SCOUTER_ENABLE_WRITE = "TRUE";
    expect(isWriteEnabled()).toBe(false);
    process.env.SCOUTER_ENABLE_WRITE = "true";
    expect(isWriteEnabled()).toBe(true);
  });
});

describe("destructive confirmation", () => {
  it("refuses a destructive operation without confirmation", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const ctx = createOperationContext(createMockClient());
    await expect(runOperation(controlThread, ctx, { obj_hash: 1, thread_id: 2, action: "interrupt" }))
      .rejects.toThrow(OperationConfirmationError);
  });

  it("runs a destructive operation once confirmed", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const ctx = createOperationContext(createMockClient());
    const result = await runOperation(
      controlThread, ctx, { obj_hash: 1, thread_id: 2, action: "interrupt" },
      { destructiveConfirmed: true },
    );
    expect(result).toMatchObject({ objHash: 1, threadId: 2, action: "interrupt", result: "OK" });
  });

  it("checks write permission before destructive confirmation", async () => {
    const ctx = createOperationContext(createMockClient());
    await expect(runOperation(
      controlThread, ctx, { obj_hash: 1, thread_id: 2, action: "interrupt" },
      { destructiveConfirmed: true },
    )).rejects.toThrow(OperationPermissionError);
  });
});

describe("execution against a mock client", () => {
  it("computes the system overview from client data", async () => {
    const client = createMockClient();
    const result = await runOperation(overview, createOperationContext(client), {}) as any;
    expect(result.agents.aliveCount).toBe(2);
    expect(result.agents.deadCount).toBe(1);
    expect(result.countersByType.tomcat).toHaveLength(2);
  });

  it("keeps the existing transaction statistics calculation", async () => {
    const client = createMockClient();
    const result = await runOperation(search, createOperationContext(client), { max_count: 50 }) as any;
    expect(result.totalFound).toBe(2);
    expect(result.statistics.errorCount).toBe(1);
    expect(result.statistics.avgElapsed).toBe(3000);
    expect(result.statistics.maxElapsed).toBe(5000);
    expect(result.statistics.avgSqlCount).toBe(2);
    expect(result.statistics.avgSqlTime).toBe(125);
    expect(result.transactions[0].serviceName).toBe("/api/users");
  });

  it("returns a plain object, never MCP content", async () => {
    const result = await runOperation(overview, createOperationContext(createMockClient()), {});
    expect(result).not.toHaveProperty("content");
    expect(JSON.parse(JSON.stringify(result))).toBeTypeOf("object");
  });

  it("skips validation when the caller already validated", async () => {
    const client = createMockClient();
    const result = await runOperation(overview, createOperationContext(client), { obj_type: "tomcat" }, {
      validateInput: false,
    }) as any;
    expect(Object.keys(result.countersByType)).toEqual(["tomcat"]);
  });
});

describe("operation context", () => {
  it("resolves an explicit object type without calling the server", async () => {
    const client = createMockClient();
    const ctx = createOperationContext(client);
    expect(await ctx.resolveObjType("redis")).toEqual(["redis"]);
    expect(client.getObjects).not.toHaveBeenCalled();
  });

  it("discovers alive object types when none is given", async () => {
    const ctx = createOperationContext(createMockClient());
    expect(await ctx.resolveObjType()).toEqual(["tomcat"]);
  });

  it("caches discovery between calls", async () => {
    const client = createMockClient();
    const ctx = createOperationContext(client);
    await ctx.discoverObjTypes();
    await ctx.discoverObjTypes();
    expect(client.getObjects).toHaveBeenCalledTimes(1);
  });

  it("keeps caches separate per context", async () => {
    const client = createMockClient();
    await createOperationContext(client).discoverObjTypes();
    await createOperationContext(client).discoverObjTypes();
    expect(client.getObjects).toHaveBeenCalledTimes(2);
  });

  it("ignores dead agents when discovering", async () => {
    const client = createMockClient({
      getObjects: vi.fn().mockResolvedValue([
        ...MOCK_OBJECTS,
        { objHash: 4, objName: "/dead/redis", objType: "redis", objFamily: "redis", address: "", alive: false },
      ]),
    } as any);
    expect(await createOperationContext(client).discoverObjTypes()).toEqual(["tomcat"]);
  });

  it("lets a caller override discovery", async () => {
    const ctx = createOperationContext(createMockClient(), {
      resolveObjType: async () => ["injected"],
    });
    expect(await ctx.resolveObjType()).toEqual(["injected"]);
  });
});
