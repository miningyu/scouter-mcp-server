# Scouter MCP Server

[한국어](./README.ko.md)

An MCP (Model Context Protocol) server that connects AI agents to [Scouter APM](https://github.com/scouter-project/scouter), enabling natural-language queries against real-time application performance data.

Ask your AI assistant things like *"What's the slowest SQL in the last hour?"* or *"Why is TPS dropping?"* and get answers grounded in live monitoring data.

## Features

- **32 tools** covering the full Scouter API surface
- **Dual protocol** — connects via HTTP (REST API) or TCP (binary protocol)
- **Automatic hash resolution** — SQL queries, service names, and error messages are decoded from Scouter's internal hash IDs to human-readable text
- **Executable SQL** — transaction profiles include SQL with bind parameters substituted, ready for `EXPLAIN ANALYZE`
- **Zero external dependencies** — only `@modelcontextprotocol/sdk` and `zod`

## Quick Start

### Using npx (no install needed)

```bash
npx scouter-mcp-server
```

### Or install from source

```bash
cd scouter.mcp
npm install
npm run build
```

### Configure

Set environment variables to point at your Scouter collector:

| Variable | Description | Default |
|----------|-------------|---------|
| `SCOUTER_API_URL` | Scouter webapp REST API base URL | `http://localhost:6180` |
| `SCOUTER_API_ID` | API login ID | |
| `SCOUTER_API_PASSWORD` | API login password | |
| `SCOUTER_API_TOKEN` | Bearer token (skip login) | |
| `SCOUTER_TCP_HOST` | TCP direct connection host | |
| `SCOUTER_TCP_PORT` | TCP direct connection port | `6100` |
| `SCOUTER_PROTOCOL` | Force `http` or `tcp` | auto-detect |

**HTTP mode** (recommended) — set `SCOUTER_API_URL`. Supports all 32 tools.
**TCP mode** — set `SCOUTER_TCP_HOST`. Lightweight, no webapp needed, but some admin tools are unavailable.

### 3. Add to your MCP client

**Claude Desktop** (`claude_desktop_config.json`):

HTTP mode:

```json
{
  "mcpServers": {
    "scouter": {
      "command": "npx",
      "args": ["-y", "scouter-mcp-server"],
      "env": {
        "SCOUTER_API_URL": "http://your-scouter-server:6180",
        "SCOUTER_API_ID": "admin",
        "SCOUTER_API_PASSWORD": "your-password"
      }
    }
  }
}
```

TCP mode:

```json
{
  "mcpServers": {
    "scouter": {
      "command": "npx",
      "args": ["-y", "scouter-mcp-server"],
      "env": {
        "SCOUTER_TCP_HOST": "your-scouter-server",
        "SCOUTER_TCP_PORT": "6100",
        "SCOUTER_API_ID": "admin",
        "SCOUTER_API_PASSWORD": "your-password"
      }
    }
  }
}
```

**Claude Code**:

```bash
# HTTP mode
claude mcp add scouter \
  -e SCOUTER_API_URL=http://your-scouter-server:6180 \
  -e SCOUTER_API_ID=admin \
  -e SCOUTER_API_PASSWORD=your-password \
  -- npx -y scouter-mcp-server

# TCP mode
claude mcp add scouter \
  -e SCOUTER_TCP_HOST=your-scouter-server \
  -e SCOUTER_TCP_PORT=6100 \
  -e SCOUTER_API_ID=admin \
  -e SCOUTER_API_PASSWORD=your-password \
  -- npx -y scouter-mcp-server
```

## Tools

### Performance Investigation

| Tool | Description |
|------|-------------|
| `get_system_overview` | Real-time snapshot — TPS, response time, CPU, heap, active services, alerts |
| `diagnose_performance` | Automated multi-step diagnosis with severity-ranked findings |
| `get_counter_trend` | Historical counter values (TPS, ElapsedTime, CPU, etc.) over time |
| `search_transactions` | Find slow/error transactions by time range, service, IP, login |
| `get_transaction_detail` | Full transaction profile with **executable SQL** and API call traces |
| `list_active_services` | Currently running requests with thread state |

### SQL & Database

| Tool | Description |
|------|-------------|
| `get_sql_analysis` | SQL performance ranking — count, elapsed, errors, % of total |
| `lookup_text` | Resolve hash IDs to SQL/service/error text |

### Error & Alert Analysis

| Tool | Description |
|------|-------------|
| `get_error_summary` | Errors ranked by frequency with per-service error rates |
| `get_alert_summary` | Alert statistics within a time range |
| `get_alert_scripting` | Read alert rule scripts |
| `set_alert_scripting` | Create/update alert rules (HTTP only) |

### Service & Traffic

| Tool | Description |
|------|-------------|
| `get_service_summary` | Service-level stats with external API call breakdown |
| `get_ip_summary` | Request distribution by client IP |
| `get_user_agent_summary` | Request distribution by browser/user-agent |
| `get_visitor_stats` | Unique visitor counts (realtime, daily, hourly) |
| `get_interaction_counters` | Service-to-service call relationships |

### Infrastructure

| Tool | Description |
|------|-------------|
| `get_thread_dump` | Thread dump with stack traces |
| `get_host_info` | Host-level top processes and disk usage |
| `get_agent_info` | Agent runtime info (threads, env, sockets) |
| `get_server_info` | Collector server metadata and counter model |

### Distributed Tracing

| Tool | Description |
|------|-------------|
| `get_distributed_trace` | Trace a transaction across services via GXID |
| `get_realtime_xlogs` | Real-time transaction stream |
| `get_raw_xlog` | Raw XLog data (5 query modes) |
| `get_raw_profile` | Raw profile steps with hash IDs |

### Configuration & Management

| Tool | Description |
|------|-------------|
| `get_configure` | Read server/agent configuration |
| `set_configure` | Modify configuration (HTTP only) |
| `control_thread` | Suspend/resume/interrupt threads |
| `manage_kv_store` | Global, namespaced, and private key-value store |
| `manage_shortener` | URL shortener service |
| `remove_inactive_objects` | Clean up dead agents (HTTP only) |

## Architecture

```
┌─────────────────────────────┐
│  AI Agent (Claude, etc.)    │
│  "Why is the app slow?"     │
└──────────┬──────────────────┘
           │ MCP (stdio)
┌──────────▼──────────────────┐
│  Scouter MCP Server         │
│  ┌────────────────────────┐ │
│  │ Tool Hub (31 tools)    │ │
│  │ Hash Resolution Engine │ │
│  │ SQL Param Binding      │ │
│  └────────────────────────┘ │
└──────────┬──────────────────┘
           │ HTTP REST or TCP Binary
┌──────────▼──────────────────┐
│  Scouter Collector Server   │
│  + Webapp (REST API)        │
└──────────┬──────────────────┘
           │
    ┌──────▼──────┐
    │ Java Agents │
    │ Host Agents │
    └─────────────┘
```

### Project Structure

```
scouter.mcp/
├── index.ts                 # Entry point — stdio transport + SIGINT handler
├── server/
│   └── index.ts             # createServer() factory → { server, cleanup }
├── tools/
│   ├── index.ts             # registerAllTools() hub — explicit imports of all tools
│   ├── shared-utils.ts      # Hash resolution, SQL param binding
│   └── ... (31 tool files)
├── client/
│   ├── index.ts             # Client facade — exports client, jsonStringify, catchWarn
│   ├── interface.ts         # ScouterClient interface + types
│   ├── http.ts              # HTTP/REST implementation
│   └── tcp.ts               # TCP binary protocol implementation
├── protocol/
│   ├── tcp-connection.ts    # TCP connection with handshake/auth
│   ├── packs.ts             # Scouter binary pack definitions
│   ├── values.ts            # Value type serialization
│   ├── data-input.ts        # Binary deserialization
│   ├── data-output.ts       # Binary serialization
│   └── constants.ts         # Protocol constants
├── time-utils.ts            # Time parsing utilities
├── __tests__/               # Vitest test suites
├── vitest.config.ts         # Test config (v8 coverage)
├── tsconfig.json            # NodeNext modules
└── package.json
```

## Development

```bash
npm run dev          # Watch mode (tsc --watch)
npm test             # Run tests
npm run test:coverage  # Coverage report
npm run build        # Production build
```

### Adding a New Tool

1. Create `tools/my-tool.ts` exporting `register(server: McpServer)` with `server.registerTool()`
2. Add `import { register as registerMyTool } from "./my-tool.js"` to `tools/index.ts`
3. Call `registerMyTool(server)` inside `registerAllTools()`
4. Use `shared-utils.ts` for hash resolution and SQL binding

## Protocol Details

### HTTP Mode

Connects to Scouter's webapp REST API (`/scouter/v1/*`). Supports all 32 tools including write operations (configuration, alert scripting, thread control).

Authentication: username/password login with bearer token auto-refresh on 401.

### TCP Mode

Connects directly to the Scouter collector using the binary protocol (port 6100). Handshake uses NetCafe magic number (`0xCAFE2001`), login with SHA-256 hashed password.

Supports read-only tools. Write operations (config, alerts, KV store, URL shortener) throw `UnsupportedOperationError`.

Text hash resolution uses `GET_TEXT_100` command with per-date caching.

## Requirements

- Node.js >= 18
- Scouter Collector >= 2.x with webapp enabled (for HTTP mode)

## License

Apache License 2.0 — same as the Scouter project.
