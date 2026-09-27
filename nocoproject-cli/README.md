# nocoproject-cli

Local daemon and agent CLI for NocoProject (Phase 0, protocol version 1).

- The **daemon** registers the coding tools installed on this machine (Claude Code, OpenCode) as runtimes, wakes up on the `np:daemon` realtime topic (with polling as a fallback), claims queued runs, prepares a workspace, launches the tool, streams its events back and reports the result.
- The **agent CLI** (`nocoproject issue ...`) is what the agent runs inside a run to read the issue, post comments and change the status. It authenticates with the per-run token the daemon injects.

The contract lives in `nocoproject/docs/phase0/protocol.md`; `src/protocol.ts` is a verbatim copy of the shared types.

## Install

Requires Node.js 22 or later.

```bash
pnpm install
pnpm build            # → dist/cli.js (single file) and dist/echo-agent.js
npm link              # optional: puts `nocoproject` and `ncp` on PATH
```

Without a global install, run `node dist/cli.js ...`. The daemon also writes shims to `~/.nocoproject/bin/{nocoproject,ncp}` and puts that directory first on every agent's `PATH`, so agents can always call `nocoproject`.

## Log in

```bash
nocoproject login --server http://127.0.0.1:13000/main --api-key <NocoBase API key>
```

- `--server` is the application URL **including its mount path** (`APP_BASE_PATH`, `/main` by default). If you give only an origin, login probes `<origin>/api/healthz` and then `<origin>/main/api/healthz`.
- The key is verified with `GET /api/np/me`. Use `--no-verify` to save the key without contacting the server, or `--api-key-stdin` to keep the key out of shell history.
- The config is saved to `~/.nocoproject/config.json` with mode 0600: `{ serverUrl, apiKey, daemonId, deviceName }`. `daemonId` is a UUID generated once per machine.

## Run the daemon

```bash
nocoproject daemon start --foreground      # log to stderr, Ctrl-C to stop
nocoproject daemon start                   # background; log in ~/.nocoproject/logs/daemon.log
nocoproject daemon status [--json]
nocoproject daemon logs [-n 100] [-f]
nocoproject daemon stop
```

Options for `start`: `--providers claude,opencode,echo` (the default is `claude,opencode`; tools that are not installed are skipped) and `--max-concurrent <n>` (the default is 20).

What it does:

1. Registers with `POST /np/daemon/register` and sends a heartbeat every 15 s.
2. Subscribes to `np:daemon` over `<serverUrl>/ws`, authenticated with the `x-api-key` header. It reconnects with exponential backoff and jitter and pings every 30 s. It also polls for work every `pollIntervalMs` (15 s from the server).
3. Claims runs in batches for all runtimes, within a shared slot limit. It renews each lease every 15 s until the run starts.
4. For each run, creates `~/.nocoproject/workspaces/<issueKey>-<runKey>/{workdir,logs}`. It reuses the previous `workDir` and resumes the provider session when the server hands them back and `fresh` is false.
5. Writes the runtime brief as a marker block in `CLAUDE.md` (claude) or `AGENTS.md` (opencode, echo). Content outside the markers is left untouched.
6. Launches the tool with the per-turn prompt and streams events in batches (every 500 ms, and immediately on the first visible event). Events are redacted and truncated to 64 KB, with increasing `seq` numbers.
7. Checks for cancellation every 5 s and also reacts to WebSocket `cancelRequested`, killing the whole process tree. An idle watchdog kills an agent that produces no output for 2 h.
8. Reports `complete` (with session id, summary and usage), `fail` (with a classified `FailureReason`) or `cancel-ack`.
9. On SIGINT or SIGTERM, kills running agents and reports them as `runtimeRecovery`, which the server retries. It then deregisters.

A `426 PROTOCOL_MISMATCH` stops claiming and logs a loud upgrade message.

### Environment variables

| Variable | Meaning |
|---|---|
| `NOCOPROJECT_HOME` | State directory (default `~/.nocoproject`) |
| `NOCOPROJECT_SERVER_URL` / `NOCOPROJECT_API_KEY` | Override the saved server URL and API key |
| `NOCOPROJECT_DAEMON_ID` / `NOCOPROJECT_DEVICE_NAME` | Override the daemon identity |
| `NOCOPROJECT_PROVIDERS` | Providers to register, e.g. `opencode,echo` |
| `NOCOPROJECT_MAX_CONCURRENT` | Concurrent run limit (default 20) |
| `NOCOPROJECT_POLL_INTERVAL` | Override the claim poll interval (`15s`, `1m`, ...) |
| `NOCOPROJECT_AGENT_IDLE_WATCHDOG` | Kill an agent after this long without output (default `2h`, `0` disables) |
| `NOCOPROJECT_WORKSPACES_ROOT` | Workspace root (default `$NOCOPROJECT_HOME/workspaces`) |
| `NOCOPROJECT_CLAUDE_PATH` / `NOCOPROJECT_OPENCODE_PATH` | Tool executables (default: looked up on `PATH`, plus `~/.opencode/bin`) |
| `NOCOPROJECT_LOG_LEVEL` | `debug`, `info`, `warn` or `error` |

The API key and run tokens are never written to logs: every log line and every event goes through redaction. Agents never receive `NOCOPROJECT_API_KEY`.

## Run-token mode (agent commands)

The daemon injects `NOCOPROJECT_SERVER_URL`, `NOCOPROJECT_TOKEN` (`npr_...`), `NOCOPROJECT_RUN_ID`, `NOCOPROJECT_AGENT_ID`, `NOCOPROJECT_ISSUE_ID` and `NOCOPROJECT_ISSUE_KEY` into the agent process. When the token and URL are present, `issue` commands call the agent API (`/api/np/agent/*`) with `Authorization: Bearer <token>`:

```bash
nocoproject issue get NP-12 --json
nocoproject issue comment list NP-12 [--thread <rootId>] [--tail 20] [--since <iso>] [--roots-only] --json
nocoproject issue comment add NP-12 --content-file ./reply.md [--parent <rootId>] [--json]
nocoproject issue status in_progress                 # the run's own issue
nocoproject issue status NP-12 in_review
```

- Issue arguments can be identifiers (`NP-12`) or raw ids. An identifier is resolved through `NOCOPROJECT_ISSUE_KEY`/`NOCOPROJECT_ISSUE_ID` or `GET /np/agent/context`. Any other value is passed through as a raw id. With no argument, the run's own issue is used.
- `comment add` requires exactly one of `--content-file` or `--content`.
- Every command accepts `--json`. Errors are printed as `{"error":{"code","message","exitCode"}}`.
- Exit codes: `0` ok, `1` other, `2` network, `3` auth (missing or invalid token, 401/403), `4` not found, `5` validation (bad input, 400/409/422, `TRANSITION_NOT_ALLOWED`).

## Adapters

| Provider | Launch | Brief |
|---|---|---|
| `claude` | `claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions [--model m] [--resume id]`, with the prompt sent on stdin as one stream-json user message. `control_request` frames are auto-approved, and stdin is closed after `result`. | `CLAUDE.md` |
| `opencode` | `opencode run --format json --auto --thinking --print-logs --log-level WARN --dir <workDir> [--session id] [--model provider/model] <prompt>` (with `PWD` reset to the workDir) | `AGENTS.md` |
| `echo` | `node dist/echo-agent.js <prompt>`: a scripted fake agent that runs the real `issue get` / `status` / `comment add` commands | `AGENTS.md` |

If the provider rejects `--resume` for an unknown session, the run is retried once with a fresh session inside the same run.

The echo agent accepts test directives in the issue title or description: `[echo:sleep=<ms>]` to exercise cancellation and the watchdog, and `[echo:fail=<text>]` to exercise failure classification (for example `[echo:fail=API Error: 429]` is reported as `agentError.providerRateLimit`).

## Development

```bash
pnpm typecheck
pnpm test                 # builds dist/ first (vitest global setup), then runs all suites
NOCOPROJECT_LIVE_OPENCODE=1 pnpm vitest run tests/opencode.live.test.ts   # real OpenCode run (costs tokens)
npm pack --dry-run
```

The tests use an in-process mock server (`tests/helpers/mock-server.ts`) that implements the daemon API, the agent API and the realtime socket.
