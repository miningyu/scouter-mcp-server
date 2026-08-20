---
name: scouter
description: Investigate application performance with Scouter APM through the scouter-mcp-server CLI. Use when asked why a service is slow, why errors spiked, what is running right now, or when the request mentions Scouter, APM, TPS, XLog, transaction traces, slow SQL, heap or CPU pressure, alerts, or thread dumps.
---

# Scouter APM investigation

Drive Scouter through the `scouter-mcp-server` CLI. Every command prints JSON on stdout and
explanations on stderr, so results can be read directly.

## 1. Check the CLI is usable

```bash
npx -y scouter-mcp-server --version
```

If that fails, the package is not reachable — say so and stop rather than guessing.

## 2. Always run doctor first

```bash
npx -y scouter-mcp-server doctor --json
```

Exit code 0 means Scouter is reachable and authenticated. A non-zero exit code means the
investigation cannot start.

When it fails, tell the user **which environment variable to set** — `SCOUTER_API_URL`,
`SCOUTER_API_ID`, `SCOUTER_API_PASSWORD`, or `SCOUTER_TCP_HOST` / `SCOUTER_TCP_PORT`.
Never print, guess, or echo a credential value, and never put one on a command line.

## 3. Work from wide to narrow

| Step | Command |
|---|---|
| Current state | `npx -y scouter-mcp-server overview --json` |
| Automated diagnosis | `npx -y scouter-mcp-server diagnose --since 30m --json` |
| Slow / failing requests | `npx -y scouter-mcp-server transactions search --since 10m --limit 20 --json` |
| One request in detail | `npx -y scouter-mcp-server transactions get <txid> --json` |
| Anything else | `npx -y scouter-mcp-server tools run <operation> --input '<json>'` |

Start with `overview` or `diagnose`. Only reach for `transactions get` once you have a txid
worth looking at — usually the slowest or an errored one from `transactions search`.

`references/diagnosis-workflows.md` has the step-by-step routes for slow responses, error
spikes, heap/CPU pressure, alerts and thread dumps.

## 4. Keep results small

Scouter results grow quickly. Before running anything:

- Prefer the narrowest window that answers the question — `--since 10m` before `--since 6h`.
- Keep `--limit` at 20 or below while exploring.
- Send anything large to a file and read only what you need:

```bash
npx -y scouter-mcp-server transactions get <txid> --output /tmp/tx.json
```

With `--output`, stdout carries only the path and a summary, so a huge profile never floods
the conversation.

Discover any operation before running it:

```bash
npx -y scouter-mcp-server tools list --json
npx -y scouter-mcp-server tools describe get_thread_dump --json
```

`references/commands.md` lists every command, option and exit code.

## 5. Writes need the user's approval

Write operations are refused unless `SCOUTER_ENABLE_WRITE=true`, and destructive ones also
need `--yes`. Both are the user's decision:

- **Never** run a write or destructive operation without asking first, in the same turn.
- State exactly what will change and on which agent, then wait for a clear yes.
- Destructive operations — `control_thread` and `remove_inactive_objects` — can disturb a
  running JVM. Treat them as a last resort and confirm the target `obj_hash` first.

Exit code 3 means the operation was refused as not permitted. Report that the environment
disallows it; do not work around it.

## Reading exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success | Use the JSON on stdout |
| 1 | Could not reach or query Scouter | Re-run `doctor`, report the failing check |
| 2 | Bad command or input | Fix with `tools describe <name>` |
| 3 | Not permitted | Ask the user; do not retry |
