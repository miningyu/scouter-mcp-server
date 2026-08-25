# Diagnosis workflows

Every workflow assumes `doctor` already passed. Run the narrowest window that answers the
question, and send anything large to `--output`.

## "The service is slow"

1. **See the current state.**
   ```bash
   scouter-mcp-server overview --json
   ```
   Check `agents.deadCount`, and the TPS / ElapsedTime / ProcCpu / HeapUsed counters.

2. **Let Scouter rank the problems.**
   ```bash
   scouter-mcp-server diagnose --since 30m --json
   ```
   `findings` comes back sorted CRITICAL → WARNING → INFO, each with a `suggestedAction`.
   Follow the highest severity first; `topSlowSqls`, `topSlowServices` and `topErrorServices`
   usually name the culprit.

3. **Find the slow requests.**
   ```bash
   scouter-mcp-server transactions search --since 10m --limit 20 --json
   ```
   Results are sorted by elapsed time descending. Note the `txid` of the worst one.
   Narrow with `--service <name>` when a specific endpoint is suspected.

4. **Open one request.**
   ```bash
   scouter-mcp-server transactions get <txid> --output /tmp/tx.json
   ```
   Read `profile.sqlSummary.slowQueries` for SQL and `profile.apiCallSummary.calls` for
   outbound calls. `executableSql` is the statement with its bind parameters substituted —
   only when `SCOUTER_MASK_PII=false`, otherwise parameters read `[masked]`.

5. **Confirm the pattern across requests.**
   ```bash
   scouter-mcp-server tools run get_sql_analysis --input '{}'
   ```
   Narrow with `start_time` / `end_time` (epoch ms or HHmmss) when the default window is too wide.
   A single slow trace can be noise; the SQL summary shows whether it is systematic.

## "Errors spiked"

1. `scouter-mcp-server tools run get_error_summary --input '{}'`
   groups errors by message with counts and rates.
2. `scouter-mcp-server transactions search --since 30m --limit 20 --json`, then look for
   entries carrying `errorMessage`.
3. `scouter-mcp-server transactions get <txid> --json` on one of them for the failing step.
4. If the error text arrives as `hash:<n>`, resolve it:
   `scouter-mcp-server tools run lookup_text --input '{"type":"error","hashes":"<n>"}'`

## "Something is hanging right now"

1. `scouter-mcp-server tools run list_active_services --input '{"min_elapsed_ms":5000}'`
   shows in-flight requests sorted by elapsed time, with the thread id and current mode.
2. Take the `objHash` of the affected agent and capture threads:
   ```bash
   scouter-mcp-server tools run get_thread_dump --input '{"obj_hash":<hash>}' --output /tmp/threads.json
   ```
3. `get_agent_info` with `{"obj_hash":<hash>,"include_threads":true}` gives live thread states
   and which service each thread is serving.

## "CPU or heap is high"

1. `scouter-mcp-server tools run get_counter_trend --input '{"counter":"HeapUsed","start_time":"...","end_time":"..."}'`
   — or `{"counter":"ProcCpu","latest_sec":300}` for the last few minutes.
2. Compare `HeapUsed` against `HeapTotal`; sustained use above ~85% is pressure, not a spike.
3. Capture a heap histogram together with the dump:
   ```bash
   scouter-mcp-server tools run get_thread_dump --input '{"obj_hash":<hash>,"include_heap_histogram":true}' --output /tmp/heap.json
   ```
4. For host-level CPU, memory and disk, use `get_host_info` with the host agent's `obj_hash`.

## "What alerts fired?"

1. `scouter-mcp-server tools run get_alert_summary --input '{}'`
2. `overview --json` also carries `recentAlerts` for the live picture.
3. `get_alert_scripting` shows the rule behind a counter's alert, which explains why it fired.

## Distributed requests

When a request crosses services, the XLog carries a `gxid`. Follow the whole call chain with:

```bash
scouter-mcp-server tools run get_distributed_trace --input '{"gxid":"<gxid>"}' --json
```

## Reporting back

- Lead with the finding, not the commands you ran.
- Quote concrete numbers: elapsed time, counts, error rate, the SQL statement.
- Name the agent (`objName`) so the user knows where to look.
- If a fix would need a write operation, describe it and **ask** — do not run it.
