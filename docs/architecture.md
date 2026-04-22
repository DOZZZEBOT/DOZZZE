# DOZZZE — Architecture (as of v0.2)

This document describes what's actually built today. For the full vision
(subscription bridging, real token economics), see `PROJECT_BRIEF.md`.

## 1. Packages

```
packages/
├── sdk/           ← @dozzze/sdk     zod schemas shared by every component
├── coordinator/   ← @dozzze/coord   Hono HTTP job broker (FIFO queue)
└── node/          ← @dozzze/node    worker + wallet + CLI + router
```

A node can run in two modes:

- **mock** — `setInterval` fires a synthesized Job every `pollIntervalMs`.
  Zero network deps; great for local dev, offline demos, CI.
- **http** — polls a real `@dozzze/coordinator` endpoint and POSTs results
  back. Multiple nodes can share one coordinator. **New in v0.2.**

When `settlement.enabled` is on, each Result additionally gets memoed to
Solana (devnet by default) before being reported. **New in v0.2.**

## 2. Topology

```
    ┌─────────────────────┐          ┌──────────────────────┐
    │  consumer (curl,    │  POST    │  @dozzze/coordinator │
    │  discord bot, app)  │ /submit  │  Hono + in-memory Q  │
    └─────────────────────┘─────────▶│  routes:             │
                                     │   POST /submit       │
                           ┌─────────│   GET  /poll/:node   │◀──────┐
                           │ GET     │   POST /report       │ POST  │
                           │ /result │   GET  /result/:id   │ /report
                           ▼         │   GET  /health       │       │
    ┌─────────────────────┐          └──────────────────────┘       │
    │  consumer polls for │                   ▲                     │
    │  /result/:jobId     │                   │ GET /poll           │
    └─────────────────────┘          ┌─────────┴──────────┐         │
                                     │  @dozzze/node      │─────────┘
                                     │  router + worker   │
                                     │     │              │
                                     │     ▼              │
                                     │  Ollama / LM Studio│
                                     │  (localhost)       │
                                     │     │              │
                                     │     ▼              │
                                     │  settlement.ts     │
                                     │  (optional) ──┐    │
                                     └───────────────│────┘
                                                     ▼
                                          Solana devnet memo tx
```

## 3. Files per package

### `@dozzze/sdk`

| Module | Role |
|--------|------|
| `protocol.ts` | zod schemas: `Job`, `Result`, `Failure`, `SubmitRequest`, `PollResponse`, `ReportRequest`. **Source of truth for wire format.** Bump `PROTOCOL_VERSION` for any breaking change. |

### `@dozzze/coordinator`

| Module | Role |
|--------|------|
| `server.ts` | Hono app factory. Returns `{ app, store }` so tests can drive the app directly with `app.request(...)`. |
| `queue.ts` | In-memory FIFO + result store. Zero persistence. Replaced by Durable Objects / Redis when scaling out. |
| `cli.ts` | `dozzze-coord` binary. Binds 127.0.0.1:8787 by default; warns loudly on 0.0.0.0. |

### `@dozzze/node`

| Module | Role |
|--------|------|
| `cli.ts` | commander entry; dispatches to subcommands |
| `commands/*.ts` | `start`, `stop`, `status`, `doctor`, `config`, `wallet` |
| `config.ts` | `~/.dozzze/config.json` with zod schema. Now includes `coordinator.mode` + `settlement.*`. |
| `wallet.ts` | scrypt + AES-256-GCM keystore; Solana keypair handling |
| `detector.ts` | probes Ollama (`:11434/api/tags`) + LM Studio (`:1234/v1/models`) |
| `protocol.ts` | re-exports `@dozzze/sdk` (compatibility shim) |
| `worker.ts` | executes a `Job` via Ollama `/api/generate`, produces a `Result` |
| `coordinator-mock.ts` | local `setInterval` coordinator for offline dev |
| `coordinator-http.ts` | real HTTP poller + `POST /report` client **(v0.2)** |
| `settlement.ts` | optional Solana memo tx per Result **(v0.2)** |
| `router.ts` | glues coordinator → worker → (settlement) → reporter |
| `pid.ts`, `prompt.ts`, `paths.ts`, `logger.ts` | infrastructure |

## 4. Data flow (one tick in HTTP mode)

1. Consumer `POST /submit` → coordinator enqueues a Job with a fresh UUID.
2. Node `GET /poll/:nodeId` → coordinator shifts the queue and returns the Job.
3. Node runs `worker.runJob(job)` against local Ollama.
4. If `settlement.enabled`, node calls `settleOnChain(result)` which:
   - Builds a memo: `dozzze:v1:{"j":jobId,"n":nodeId,"t":tokens,"p":payout,"c":completedAt}`
   - Signs a 2-instruction tx (memo + 0-lamport self-transfer, the latter just for explorer visibility)
   - Submits to `config.settlement.cluster`, waits for `confirmed`
   - Attaches the signature to `result.settlementTx`
5. Node `POST /report` → coordinator stores the Result, keyed by jobId.
6. Consumer `GET /result/:jobId` → returns the stored Result (including `settlementTx`).

## 5. What's deliberately missing in v0.2

- **Auth on the coordinator.** v0.2 `/submit` is open. Rate limiting +
  consumer identity lands in v0.3. Do **not** bind 0.0.0.0 on an internet-
  reachable host.
- **Persistent queue.** In-memory store is lost on restart.
- **Payment in $DOZZZE.** The memoed `payout` is metadata only — no SPL
  token exists yet. v0.3 adds mint + transfer.
- **Subscription bridging** (Claude Pro / ChatGPT Plus). Deferred to v0.3
  behind an explicit ToS-risk opt-in warning.
- **Consumer dashboard.** `curl` / SDK only for now.
- **Slashing for bad results.** Mentioned in step 03 of the landing page
  but not yet implemented.
- **LM Studio as worker target.** Still detected only, not routed to.

## 6. Security posture (v0.2)

| Threat | Mitigation |
|--------|-----------|
| Leaked keystore file | scrypt (N=2^15) + AES-256-GCM, GCM auth tag on every file. |
| Keystore tampering | GCM auth tag verifies integrity on decrypt. |
| Keystore overwrite | `dozzze wallet create` refuses to overwrite without y/N. |
| Unprompted wallet unlock | `dozzze start` without `settlement.enabled` **does not** unlock the wallet. Settlement requires either a TTY prompt or `DOZZZE_WALLET_PASSWORD`. |
| Coordinator binding to 0.0.0.0 | Default is 127.0.0.1. Passing `--host 0.0.0.0` prints a warning to stderr. |
| Runaway API spend | `dailyBudgetUsd` exists in config; enforcement lands with BYOK in v0.3. |
| Stale pidfile PID reuse | `stop` checks PID liveness before signaling. |
| Schema drift between client / coordinator | Both import `@dozzze/sdk`. Breaking changes require a `PROTOCOL_VERSION` bump. |

## 7. Layered swaps still ahead

- **Coordinator persistence** — swap `queue.ts` for a Durable Objects /
  SQLite / Redis adapter. Hono app stays the same.
- **SSE / long-poll** — add `GET /stream/:nodeId` for low-latency job
  delivery. The current short-poll remains as the MVP fallback.
- **SPL token settlement** — extend `settlement.ts` to sign an SPL
  transfer in addition to the memo. The memo anchors the job identity;
  the transfer moves value.
- **Consumer SDK** — extract `submit + pollResult` into `@dozzze/sdk`
  so downstream apps don't rewrite it.

## 8. Testing strategy

- **sdk** (9 tests): schema acceptance / rejection, including the
  Submit/Poll/Report request-response shapes.
- **coordinator** (11 tests): queue FIFO / overwrite / stats, plus HTTP
  round-trips driven via `app.request(...)`. No live socket needed.
- **node** (42 tests): config schema + on-disk round-trip, wallet
  encrypt/decrypt + wrong-password failure, detector with `vi.spyOn(fetch)`,
  HTTP poller with `vi.useFakeTimers`, settlement memo payload shape.

**Not covered in CI:**
- Real Ollama inference (requires a model download).
- Real Solana devnet settlement (requires a funded wallet + network).
- Multi-node coordination (single-process only).

Running the end-to-end demo:

```bash
npm run build
bash scripts/demo.sh
```

requires `jq` on PATH.
