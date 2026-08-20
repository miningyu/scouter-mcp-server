# Scouter MCP Server

[![npm provenance](https://img.shields.io/badge/npm-provenance-brightgreen?logo=npm)](https://www.npmjs.com/package/scouter-mcp-server)

[한국어](./README.ko.md)

Connects AI agents and people to [Scouter APM](https://github.com/scouter-project/scouter), enabling natural-language and command-line queries against real-time application performance data.

Ask your AI assistant things like *"What's the slowest SQL in the last hour?"* or *"Why is TPS dropping?"* and get answers grounded in live monitoring data.

The same package offers three ways in, all backed by one shared set of operations:

```
MCP-capable AI  ──▶ MCP  ─┐
                          ├──▶ operation registry ──▶ ScouterClient ──▶ Scouter
Human           ──▶ CLI  ─┤
Skill-capable AI──▶ CLI  ─┘
```

## Features

- **31 operations** covering the full Scouter API surface, exposed as both MCP tools and CLI commands
- **Built-in CLI** — `doctor`, `tools list/describe/run`, plus `overview`, `diagnose` and `transactions` shortcuts
- **Companion skill** — a ready-made skill so a skill-capable agent can investigate without MCP
- **Dual protocol** — connects via HTTP (REST API) or TCP (binary protocol)
- **Automatic hash resolution** — SQL queries, service names, and error messages are decoded from Scouter's internal hash IDs to human-readable text
- **Executable SQL** — transaction profiles include SQL with bind parameters substituted, ready for `EXPLAIN ANALYZE`
- **Zero external dependencies** — only `@modelcontextprotocol/sdk` and `zod`

## Quick Start

### Using npx (no install needed)

```bash
# no arguments: start the stdio MCP server
npx -y scouter-mcp-server

# any argument: use the CLI
npx -y scouter-mcp-server doctor
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
| `SCOUTER_TCP_HOST` | TCP direct connection host | |
| `SCOUTER_TCP_PORT` | TCP direct connection port | `6100` |
| `SCOUTER_ENABLE_WRITE` | Set to `true` to enable write tools | *(disabled)* |
| `SCOUTER_MASK_PII` | Set to `false` to disable PII masking in responses (IP, login, userAgent, SQL params) | `true` |

**HTTP mode** (recommended) — set `SCOUTER_API_URL`. Supports all 31 tools (write tools require `SCOUTER_ENABLE_WRITE=true`).
**TCP mode** — set `SCOUTER_TCP_HOST`. Lightweight, no webapp needed, but some admin tools are unavailable.

> **Note:** By default, only read-only tools (25) are registered. To enable write tools (`set_configure`, `set_alert_scripting`, `manage_kv_store`, `manage_shortener`, `control_thread`, `remove_inactive_objects`), set `SCOUTER_ENABLE_WRITE=true`.

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

**Claude Code** (use `-s user` to register globally across all projects):

```bash
# HTTP mode
claude mcp add scouter -s user \
  -e SCOUTER_API_URL=http://your-scouter-server:6180 \
  -e SCOUTER_API_ID=admin \
  -e SCOUTER_API_PASSWORD=your-password \
  -- npx -y scouter-mcp-server

# TCP mode
claude mcp add scouter -s user \
  -e SCOUTER_TCP_HOST=your-scouter-server \
  -e SCOUTER_TCP_PORT=6100 \
  -e SCOUTER_API_ID=admin \
  -e SCOUTER_API_PASSWORD=your-password \
  -- npx -y scouter-mcp-server
```

To update the configuration later, edit `~/.claude.json` directly or remove and re-add:

```bash
claude mcp remove scouter -s user
claude mcp add scouter -s user \
  -e SCOUTER_TCP_HOST=new-host \
  -e SCOUTER_TCP_PORT=6100 \
  -e SCOUTER_API_ID=admin \
  -e SCOUTER_API_PASSWORD=your-password \
  -- npx -y scouter-mcp-server
```

## Command line

The binary is both an MCP server and a CLI. With no arguments it starts the stdio MCP
server exactly as before; with any argument it runs a CLI command.

Results go to **stdout**, logs and error explanations go to **stderr**.

### Check the connection first

```bash
npx -y scouter-mcp-server doctor
npx -y scouter-mcp-server doctor --json
```

`doctor` reports the selected protocol, the endpoint with credentials redacted, whether
`SCOUTER_API_ID` / `SCOUTER_API_PASSWORD` are set, and whether Scouter actually answers.
It exits 0 when every check passes and non-zero otherwise. It never prints a password.

### Discover and run any operation

```bash
npx -y scouter-mcp-server tools list --json
npx -y scouter-mcp-server tools describe get_system_overview --json
npx -y scouter-mcp-server tools run search_transactions --input '{"max_count":20}'
```

`tools list` shows only what this environment may run — write operations stay hidden
unless `SCOUTER_ENABLE_WRITE=true` (`--all` lists them anyway, marked unrunnable).
`tools run` validates `--input` against the operation's own Zod schema before calling
Scouter, so a typo fails locally with a readable message.

### Shortcuts for the common path

```bash
npx -y scouter-mcp-server overview --json
npx -y scouter-mcp-server diagnose --since 30m --json
npx -y scouter-mcp-server transactions search --since 10m --limit 20 --json
npx -y scouter-mcp-server transactions get <txid> --json
```

`--since` accepts a number plus `s`, `m`, `h` or `d`. Without `--json` each shortcut prints
a short human summary; with `--json` it prints the untouched operation result.

### Large results

```bash
npx -y scouter-mcp-server transactions get <txid> --output ./tx.json
```

With `--output`, the full JSON goes to the file and stdout carries only the path, the byte
count and a summary — useful when a profile would otherwise flood a terminal or an agent's
context.

### Options and exit codes

| Option | Meaning |
|---|---|
| `--json` | Print the machine-readable result instead of a summary |
| `--input <json>` | Operation input, validated against the schema |
| `--output <file>` | Write the result to a file; stdout gets only the path and a summary |
| `--yes` | Confirm a destructive operation |
| `--all` | Include operations this environment cannot run (`tools list`) |
| `--since <dur>` | Relative time window (`45s`, `30m`, `2h`, `1d`) |
| `--limit <n>` | Maximum transactions to return |

| Exit code | Meaning |
|---|---|
| `0` | Success |
| `1` | Could not reach or query Scouter |
| `2` | Bad command line, or input that failed schema validation |
| `3` | Operation not permitted in this environment |

### Write safety

Write permission is enforced in the shared execution step, not only at MCP registration,
so the CLI cannot be used to get around it:

- A write operation is refused unless `SCOUTER_ENABLE_WRITE=true` (exit 3).
- A destructive operation (`control_thread`, `remove_inactive_objects`) additionally needs
  `--yes` (exit 3 without it).

```bash
SCOUTER_ENABLE_WRITE=true npx -y scouter-mcp-server \
  tools run control_thread --yes --input '{"obj_hash":123,"thread_id":45,"action":"interrupt"}'
```

## Companion skill

`skills/scouter/` is a skill for agents that run shell commands instead of speaking MCP. It
tells the agent when to reach for Scouter, to run `doctor` first, how to work from overview
to a single transaction, to keep results small, and to ask before anything that writes.

Install it by copying the directory into the agent's skills folder:

```bash
# from a clone
cp -r skills/scouter ~/.claude/skills/

# or from an npm install
cp -r "$(npm root -g)/scouter-mcp-server/skills/scouter" ~/.claude/skills/
```

Then ask in plain language:

> The checkout API got slow around 14:00. Can you look into it?

The agent runs `doctor`, then `diagnose`, then drills into the slowest transactions. It never
runs a write or destructive command without asking first, and when configuration is missing it
names the environment variable rather than revealing any value.

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
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ MCP-capable AI   │  │ Human at a shell │  │ Skill-capable AI │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │ MCP (stdio)         │ CLI                 │ CLI
┌────────▼─────────────────────▼─────────────────────▼─────────┐
│  scouter-mcp-server                                          │
│  ┌────────────────────┐   ┌───────────────────────────────┐  │
│  │ MCP tool adapter   │   │ CLI commands                  │  │
│  └─────────┬──────────┘   └───────────────┬───────────────┘  │
│            └───────────────┬──────────────┘                  │
│  ┌─────────────────────────▼─────────────────────────────┐   │
│  │ Operation registry (31 operations)                    │   │
│  │ Write / destructive guards · Hash resolution engine   │   │
│  │ SQL param binding                                     │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────┬───────────────────────────────────────────────────┘
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
├── index.ts                 # Entry point — no arguments starts MCP, arguments run the CLI
├── operations/              # Transport-neutral core, shared by MCP and CLI
│   ├── definition.ts        # OperationContext, OperationDefinition, error types
│   ├── context.ts           # Client injection + object-type discovery cache
│   ├── execute.ts           # The one execution path: permissions, confirmation, validation
│   ├── registry.ts          # The single list of all 31 operations
│   ├── shared-utils.ts      # Hash resolution, SQL param binding, PII masking
│   └── ... (31 operation files)
├── cli/
│   ├── index.ts             # runCli() — command dispatch, error → exit code mapping
│   ├── args.ts              # Minimal dependency-free argv parser
│   ├── output.ts            # stdout/stderr split, --output file writing, exit codes
│   ├── doctor.ts            # Configuration and connectivity checks
│   ├── schema-info.ts       # Zod introspection for `tools describe`
│   └── commands/            # tools list/describe/run + overview/diagnose/transactions
├── server/
│   ├── index.ts             # createServer() factory → { server, cleanup }
│   ├── stdio.ts             # startStdioServer() — stdio transport + SIGINT handler
│   └── mcp-tool.ts          # Renders an operation result as MCP tool content
├── tools/
│   ├── index.ts             # registerAllTools() — registers straight from the registry
│   ├── shared-utils.ts      # MCP-side response builder, re-exports operations/shared-utils
│   └── ... (31 thin MCP adapters)
├── skills/scouter/          # Companion skill (SKILL.md + references/)
├── client/
│   ├── index.ts             # Client facade — client, createClient, closeClient, describeConnection
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

### Adding a New Operation

An operation is written once and shows up in both MCP and the CLI.

1. Create `operations/my-operation.ts` exporting `operation = defineOperation({ name, title,
   description, inputShape, annotations, execute })`. `execute(ctx, input)` returns a plain
   object — never MCP content and never a CLI string.
2. Add it to `operations/registry.ts`.
3. Create `tools/my-operation.ts`, the four-line MCP adapter, so the tool keeps its
   `register` / `params` exports.
4. Use `operations/shared-utils.ts` for hash resolution, SQL binding and PII masking, and
   reach Scouter through `ctx.client` rather than importing a client directly.

## Protocol Details

### HTTP Mode

Connects to Scouter's webapp REST API (`/scouter/v1/*`). Supports all 31 tools including write operations (configuration, alert scripting, thread control).

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
