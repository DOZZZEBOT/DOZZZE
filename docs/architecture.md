# DOZZZE — Architecture (as of v0.1)

This document describes what's actually built today. For the full vision
(real coordinator, subscription bridging, on-chain settlement), see
`PROJECT_BRIEF.md`.

## 1. Components (built)

```
┌─────────────────────────────────────────────────────────────┐
│                     dozzze node (local)                     │
│                                                             │
│   CLI (commander)                                           │
│     │                                                       │
│     ├──▶ commands/ ┐                                        │
│     │               │                                       │
│     │   start ──────┼──▶ router ──▶ worker ──▶ Ollama REST  │
│     │   stop        │       ▲                               │
│     │   status      │       │                               │
│     │   doctor      │       │                               │
│     │   config      │   coordinator-mock (setInterval)      │
│     │   wallet      │       │                               │
│     │               │       │                               │
│     └──── config ◀──┘   pid / keystore / paths              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

All files under `packages/node/src/`:

| Module | Role |
|--------|------|
| `cli.ts` | commander entry; dispatches to subcommands |
| `commands/*.ts` | one file per subcommand (`start`, `stop`, `status`, `doctor`, `config`, `wallet`) |
| `config.ts` | `~/.dozzze/config.json` load/save/patch, zod schema |
| `wallet.ts` | scrypt + AES-256-GCM keystore; Solana keypair handling |
| `detector.ts` | probes Ollama (`:11434/api/tags`) + LM Studio (`:1234/v1/models`) |
| `protocol.ts` | zod schemas for `Job` / `Result` / `Failure`. **Source of truth for wire format.** |
| `worker.ts` | executes a `Job` via Ollama `/api/generate`, produces a `Result` |
| `coordinator-mock.ts` | synthesizes a `Job` every `pollIntervalMs` and calls a handler |
| `router.ts` | glues coordinator → worker → result sink |
| `pid.ts` | tiny pidfile helper for `start`/`stop` |
| `prompt.ts` | minimal interactive prompts (password, y/N) without pulling inquirer |
| `paths.ts` | all file locations under `~/.dozzze/` (override with `DOZZZE_HOME`) |
| `logger.ts` | ANSI-colored stdout/stderr with timestamps |

## 2. Data flow (one tick)

1. `coordinator-mock` fires `onJob(job)` every 30s (configurable).
2. `router.startRouter` receives the Job, logs "job received", calls `worker.runJob`.
3. `worker.runJob` POSTs to `{ollamaUrl}/api/generate` with the prompt.
4. Worker computes a mock `payout = (tokensIn + tokensOut) / 1000` (1 $DOZZZE per 1K tokens).
5. Router logs the Result; `onResult` callback fires (default: no-op).

## 3. What's deliberately missing in v0.1

- No network-facing coordinator. The `coordinator.mode: 'http'` branch throws on purpose.
- No Solana RPC calls beyond the devnet health probe in `dozzze doctor`.
- No subscription bridging (Claude Pro / ChatGPT Plus). **ToS-risky; deferred to v0.3 with explicit opt-in warnings.**
- No token contract. No token. Nothing to buy.
- No web dashboard.
- LM Studio is **detected**, not yet used as a worker target.

## 4. Security posture (v0.1)

| Threat | Mitigation |
|--------|-----------|
| Leaked keystore file | scrypt-KDF'd password + AES-256-GCM encryption. N=2^15 → ~90ms on consumer hardware. |
| Keystore tampering | GCM auth tag verifies integrity on decrypt. |
| Keystore overwrite | `dozzze wallet create` refuses to overwrite without explicit y/N confirmation. |
| Silent network bind | Mock coordinator is in-process (no socket). When real coordinator lands, MVP will bind to 127.0.0.1 unless user opts in. |
| PID reuse after crash | `stop` detects stale pidfile (PID not alive) and cleans up instead of killing an unrelated PID. |
| Runaway API spend | `dailyBudgetUsd` exists in config; enforcement lands when real API bridging lands (v0.3). |

## 5. Layered swaps for v0.2+

- **Real coordinator** — replace `coordinator-mock.ts` with an HTTP/SSE poller that speaks the same `Job` / `Result` schema. `protocol.ts` does not change. No other file should change.
- **Real settlement** — add `settlement.ts` that accepts a `Result`, signs a Solana transaction with the wallet, submits it to the cluster in `config.cluster`. Plug it in as an `onResult` handler.
- **LM Studio as worker** — add a branch in `worker.runJob` that dispatches to `/v1/completions` when the detected runtime is LM Studio.

## 6. Testing strategy

- Unit tests for pure logic: `config`, `protocol`, `paths`, `worker.estimateTokens`, `wallet.encrypt/decrypt`.
- HTTP-layer tests stub `fetch` with `vi.spyOn`. No live servers in CI.
- `coordinator-mock` is tested with `vi.useFakeTimers()` so the interval is deterministic.
- No integration tests against a live Ollama in CI (would require a model download). Manual QA via `dozzze start` is the canonical acceptance test until v0.2.
