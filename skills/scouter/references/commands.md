# scouter-mcp-server CLI reference

Run with `npx -y scouter-mcp-server <command>`, or `scouter-mcp-server <command>` when the
package is installed globally. With no arguments the binary starts the stdio MCP server
instead — always pass a command.

## Global

| Command | Purpose |
|---|---|
| `scouter-mcp-server --help` | Full usage summary |
| `scouter-mcp-server --version` | Installed package version |

## doctor

```bash
scouter-mcp-server doctor [--json] [--output <file>]
```

Reports the selected protocol (HTTP or TCP), the endpoint with any credentials redacted,
whether `SCOUTER_API_ID` / `SCOUTER_API_PASSWORD` are set, whether writes and PII masking are
enabled, then verifies the connection by listing objects.

Exit 0 when every check passes, non-zero when any check fails. It never prints a password.

## tools

```bash
scouter-mcp-server tools list [--json] [--all]
scouter-mcp-server tools describe <operation> [--json]
scouter-mcp-server tools run <operation> --input '<json>' [--yes] [--output <file>]
```

- `list` shows the operations this environment can run. Write operations are hidden unless
  `SCOUTER_ENABLE_WRITE=true`; `--all` shows them anyway, marked as not runnable.
- `describe` shows the description, the read-only / destructive / idempotent flags, and every
  input field with its type, whether it is required, its default and its meaning.
- `run` validates `--input` against the operation's schema before calling Scouter.

## Shortcuts

```bash
scouter-mcp-server overview [--obj-type <type>] [--json]
scouter-mcp-server diagnose [--since 30m] [--obj-type <type>] [--json]
scouter-mcp-server transactions search [--since 10m] [--limit 20] [--service <name>] [--ip <ip>] [--login <id>] [--obj-hashes <a,b>] [--json]
scouter-mcp-server transactions get <txid> [--date YYYYMMDD] [--max-steps 80] [--json]
```

Shortcuts call the same operations as `tools run`. Without `--json` they print a short human
summary; with `--json` or `--output` they print the full operation result.

`--since` takes a number plus `s`, `m`, `h` or `d` — for example `45s`, `30m`, `2h`, `1d`.

Two limits to know: `diagnose` analyzes at most 60 minutes (a larger `--since` is clamped with
a warning), and a `--since` window crossing local midnight only covers today's partition — pass
an explicit earlier `date` to `tools run search_transactions` to query yesterday.

## Options

| Option | Meaning |
|---|---|
| `--json` | Print the machine-readable result instead of a summary |
| `--input <json>` | Operation input, validated against the schema |
| `--output <file>` | Write the result to a file; stdout gets only the path and a summary |
| `--yes` | Confirm a destructive operation |
| `--all` | Include operations this environment cannot run (`tools list`) |
| `--since <dur>` | Relative time window |
| `--limit <n>` | Maximum transactions to return |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success — the result is on stdout |
| 1 | Could not reach or query Scouter |
| 2 | Bad command line or input that failed schema validation |
| 3 | Operation not permitted in this environment |

## Environment variables

Set these in the shell or MCP client configuration, never on the command line.

| Variable | Purpose |
|---|---|
| `SCOUTER_API_URL` | Scouter webapp base URL (HTTP mode) |
| `SCOUTER_API_ID` | Scouter user id |
| `SCOUTER_API_PASSWORD` | Scouter password |
| `SCOUTER_TCP_HOST` | Collector host (TCP mode; takes precedence over HTTP) |
| `SCOUTER_TCP_PORT` | Collector TCP port, default 6100 |
| `SCOUTER_ENABLE_WRITE` | `true` allows write operations |
| `SCOUTER_MASK_PII` | `false` reveals IPs, login ids, user agents and SQL bind parameters |

## Operations by area

Run `tools describe <name>` for the exact input of any of these.

- **Overview and diagnosis** — `get_system_overview`, `diagnose_performance`, `get_counter_trend`
- **Transactions** — `search_transactions`, `get_transaction_detail`, `get_realtime_xlogs`,
  `list_active_services`, `get_distributed_trace`, `get_raw_xlog`, `get_raw_profile`
- **SQL and services** — `get_sql_analysis`, `get_service_summary`, `get_interaction_counters`
- **Errors and alerts** — `get_error_summary`, `get_alert_summary`, `get_alert_scripting`
- **Traffic** — `get_visitor_stats`, `get_ip_summary`, `get_user_agent_summary`
- **Infrastructure** — `get_host_info`, `get_agent_info`, `get_thread_dump`, `get_server_info`,
  `get_configure` (read collector or agent configuration)
- **Lookup** — `lookup_text` resolves the integer hashes Scouter stores instead of text
- **Write (needs `SCOUTER_ENABLE_WRITE=true`)** — `set_configure`, `set_alert_scripting`,
  `manage_kv_store`, `manage_shortener`
- **Destructive (also needs `--yes`)** — `control_thread`, `remove_inactive_objects`
