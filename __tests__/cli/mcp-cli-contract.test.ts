import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ScouterClient } from "../../client/interface.js";
import { createMockClient } from "../operations/mock-client.js";
import { captureIo } from "./helpers.js";

const sharedClient: ScouterClient = createMockClient();

// Both surfaces must end up on the same client, so the MCP singleton is stubbed with
// the very client the CLI is told to create.
vi.mock("../../client/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../client/index.js")>("../../client/index.js");
  return {
    ...actual,
    client: sharedClient,
    createClient: () => sharedClient,
    closeClient: async () => {},
    resolveObjType: async (objType?: string) => (objType ? [objType] : ["tomcat"]),
    discoverObjTypes: async () => ["tomcat"],
  };
});

const { runCli } = await import("../../cli/index.js");
const { registerAllTools } = await import("../../tools/index.js");
const { operations } = await import("../../operations/registry.js");

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function registerMcpTools(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
      return {} as never;
    }),
  } as unknown as McpServer;
  registerAllTools(server);
  return handlers;
}

async function viaMcp(name: string, input: Record<string, unknown>): Promise<any> {
  const handler = registerMcpTools().get(name)!;
  return JSON.parse((await handler(input)).content[0].text);
}

async function viaCli(name: string, input: Record<string, unknown>): Promise<any> {
  const io = captureIo();
  const code = await runCli(["tools", "run", name, "--input", JSON.stringify(input)], io);
  expect(code).toBe(0);
  return JSON.parse(io.stdoutText());
}

describe("MCP and CLI share one registry", () => {
  it("registers exactly the registry's read-only operations", () => {
    const handlers = registerMcpTools();
    const readOnly = operations.filter(op => op.annotations.readOnlyHint).map(op => op.name);
    expect([...handlers.keys()]).toEqual(readOnly);
  });

  it("offers the same operations to the CLI", async () => {
    const io = captureIo();
    await runCli(["tools", "list", "--json"], io);
    const listed = JSON.parse(io.stdoutText()).operations.map((o: { name: string }) => o.name);
    expect(listed).toEqual([...registerMcpTools().keys()]);
  });
});

describe("MCP and CLI produce the same core result", () => {
  it("agrees on get_system_overview", async () => {
    const [mcp, cli] = [await viaMcp("get_system_overview", {}), await viaCli("get_system_overview", {})];
    expect(cli.agents).toEqual(mcp.agents);
    expect(cli.countersByType).toEqual(mcp.countersByType);
    expect(cli.recentAlerts).toEqual(mcp.recentAlerts);
  });

  it("agrees on search_transactions", async () => {
    const input = { max_count: 50 };
    const [mcp, cli] = [await viaMcp("search_transactions", input), await viaCli("search_transactions", input)];
    expect(cli.transactions).toEqual(mcp.transactions);
    expect(cli.statistics).toEqual(mcp.statistics);
    expect(cli.totalFound).toBe(mcp.totalFound);
  });

  it("agrees on lookup_text", async () => {
    const input = { type: "service", hashes: "123,456" };
    const [mcp, cli] = [await viaMcp("lookup_text", input), await viaCli("lookup_text", input)];
    expect(cli.resolved).toEqual(mcp.resolved);
    expect(cli.resolvedCount).toBe(mcp.resolvedCount);
  });

  it("wraps the CLI result in nothing while MCP wraps it in tool content", async () => {
    const handler = registerMcpTools().get("get_system_overview")!;
    const response = await handler({});
    expect(response.content[0].type).toBe("text");
    const io = captureIo();
    await runCli(["tools", "run", "get_system_overview"], io);
    expect(io.stdoutText().trimStart().startsWith("{")).toBe(true);
  });
});
