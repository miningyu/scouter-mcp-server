import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "../../server/index.js";

describe("createServer", () => {
  it("should return an McpServer and a cleanup function", () => {
    const { server, cleanup } = createServer();
    expect(server).toBeInstanceOf(McpServer);
    expect(typeof cleanup).toBe("function");
  });

  it("should register tools on the created server", () => {
    const { server } = createServer();
    const registered = (server as unknown as {
      _registeredTools: Record<string, unknown>;
    })._registeredTools;
    expect(Object.keys(registered).length).toBeGreaterThan(0);
  });

  it("should return a cleanup function that does not throw", () => {
    const { cleanup } = createServer();
    expect(() => cleanup()).not.toThrow();
  });

  it("should create independent server instances", () => {
    const first = createServer();
    const second = createServer();
    expect(first.server).not.toBe(second.server);
  });
});
