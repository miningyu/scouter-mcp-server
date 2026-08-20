import { describe, it, expect, vi, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../../tools/index.js";
import { operations } from "../../operations/registry.js";
import { registerOperationTool, toMcpContent } from "../../server/mcp-tool.js";

interface Registration {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: Record<string, boolean>;
  };
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function createRecordingServer(): { server: McpServer; registrations: Registration[] } {
  const registrations: Registration[] = [];
  const server = {
    registerTool: vi.fn((name: string, config: Registration["config"], handler: Registration["handler"]) => {
      registrations.push({ name, config, handler });
      return {} as never;
    }),
  } as unknown as McpServer;
  return { server, registrations };
}

const originalWrite = process.env.SCOUTER_ENABLE_WRITE;

afterEach(() => {
  if (originalWrite === undefined) delete process.env.SCOUTER_ENABLE_WRITE;
  else process.env.SCOUTER_ENABLE_WRITE = originalWrite;
});

describe("MCP tools and the operation registry stay in sync", () => {
  it("registers the 25 read-only operations by default", () => {
    delete process.env.SCOUTER_ENABLE_WRITE;
    const { server, registrations } = createRecordingServer();
    registerAllTools(server);
    expect(registrations).toHaveLength(25);
  });

  it("registers all 31 operations when SCOUTER_ENABLE_WRITE=true", () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const { server, registrations } = createRecordingServer();
    registerAllTools(server);
    expect(registrations).toHaveLength(31);
  });

  it("registers exactly the registry's operation names, in registry order", () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const { server, registrations } = createRecordingServer();
    registerAllTools(server);
    expect(registrations.map(r => r.name)).toEqual(operations.map(op => op.name));
  });

  it("copies each operation's title, description, schema and annotations verbatim", () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const { server, registrations } = createRecordingServer();
    registerAllTools(server);
    for (const registration of registrations) {
      const operation = operations.find(op => op.name === registration.name)!;
      expect(registration.config.title, registration.name).toBe(operation.title);
      expect(registration.config.description, registration.name).toBe(operation.description);
      expect(registration.config.inputSchema, registration.name).toBe(operation.inputShape);
      expect(registration.config.annotations, registration.name).toBe(operation.annotations);
    }
  });

  it("never registers a tool the registry does not define", () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const { server, registrations } = createRecordingServer();
    registerAllTools(server);
    const known = new Set(operations.map(op => op.name));
    for (const registration of registrations) expect(known.has(registration.name), registration.name).toBe(true);
  });
});

describe("MCP response conversion", () => {
  it("renders an operation result as a single JSON text block", () => {
    const response = toMcpContent({ a: 1, nested: { b: [1, 2] } });
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe("text");
    expect(JSON.parse(response.content[0].text)).toEqual({ a: 1, nested: { b: [1, 2] } });
  });

  it("turns an operation input error into plain tool text rather than throwing", async () => {
    process.env.SCOUTER_ENABLE_WRITE = "true";
    const { server, registrations } = createRecordingServer();
    registerOperationTool(server, operations.find(op => op.name === "manage_shortener")!);
    const result = await registrations[0].handler({ operation: "get" });
    expect(result.content[0].text).toBe("Error: 'key' is required for get operation");
  });
});
