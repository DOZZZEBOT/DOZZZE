# DOZZZE

> **Idle compute, awake.**
> Your AI subscription sleeps 80% of the day. DOZZZE wakes it up, routes the
> spare cycles to degens hunting alpha on Solana, and pays you in `$DOZZZE`.

[landing page](./index.html) · [quickstart](./docs/quickstart.md) · [architecture](./docs/architecture.md)

---

## What this repo is (today)

This is the **v0.1 MVP** of the DOZZZE node client. It runs locally, detects a
local LLM runtime (Ollama or LM Studio), and — with a **mocked coordinator** —
fires a fake inference job every 30 seconds, runs it through your runtime, and
prints a fake `$DOZZZE` payout.

Everything on the landing page that isn't in this repo is **not implemented
yet**. The docs will always tell you honestly what works and what doesn't. See
[`docs/architecture.md`](./docs/architecture.md) §3 for the exact "deliberately
missing" list.

## Quick install (Unix-ish)

```bash
curl -fsSL https://raw.githubusercontent.com/DOZZZEBOT/DOZZZE/main/scripts/install.sh | sh
dozzze doctor
dozzze wallet create
dozzze start
```

**Piping-curl-to-sh is a known pattern with known risks.** Read the script
first: [`scripts/install.sh`](./scripts/install.sh). It is deliberately short.

## From source (any OS)

```bash
git clone https://github.com/DOZZZEBOT/DOZZZE.git
cd DOZZZE
npm install
npm run build
npm run dozzze -- doctor
npm run dozzze -- wallet create
npm run dozzze -- start
```

> **Windows users:** the `install.sh` one-liner does not run on cmd.exe or
> PowerShell. Use the "from source" path above, or run install.sh under WSL.

## What the node does

Every tick (default: 30s) the mocked coordinator emits a fake Job. Your node:

1. Reads the Job (model + prompt + max tokens).
2. Dispatches it to your local Ollama (`/api/generate`) or LM Studio.
3. Computes a mock payout (`(tokensIn + tokensOut) / 1000` in `$DOZZZE`).
4. Logs the result.

No network outbound except to your local runtime. No coordinator calls. No
chain calls (except a one-time `getHealth` in `dozzze doctor`, and only if
you're online).

## Commands

```
dozzze start       # boot the node (creates config on first run)
dozzze stop        # SIGTERM the running node via its pidfile
dozzze status      # one-shot: is it running? wallet OK? runtimes up?
dozzze doctor      # deeper env check; exit 0 if healthy
dozzze config      # show | get <key> | set <key> <value> | path
dozzze wallet      # create | show | import | verify
dozzze --help      # all of the above, commander-style
```

## Config

Lives at `~/.dozzze/config.json`. Safe to hand-edit (zod will tell you if you
break the schema). Relevant keys:

| Key | Default | Notes |
|-----|---------|-------|
| `nodeId` | `NODE #0069` | Human label, shown in logs. Must match `/^NODE #\d{4}$/`. |
| `cluster` | `devnet` | `devnet` \| `testnet` \| `mainnet-beta`. v0.1 only pings devnet in `doctor`. |
| `ollamaUrl` | `http://127.0.0.1:11434` | Local Ollama endpoint. |
| `lmStudioUrl` | `http://127.0.0.1:1234` | Local LM Studio endpoint. |
| `pollIntervalMs` | `30000` | Mock-coordinator tick. Set higher in dev if chatty. |
| `requireWallet` | `true` | If false, node starts without a keystore. Mock payouts only. |
| `coordinator.mode` | `mock` | Flipping to `http` errors out — v0.2 work. |

## Paths

All node state lives under `~/.dozzze/`. Override with `DOZZZE_HOME=/some/path`:

```
~/.dozzze/
├── config.json       # editable
├── keystore.json     # scrypt + AES-256-GCM encrypted Solana keypair — NEVER commit
├── dozzze.pid        # PID of the running node (removed on clean shutdown)
└── dozzze.log        # (not written in v0.1; reserved for v0.2)
```

## Security notes

- Keystore uses **scrypt (N=2^15, r=8, p=1)** + **AES-256-GCM**. Auth tag on
  every file. See [`docs/architecture.md`](./docs/architecture.md) §4.
- The node **does not** bind a public port in v0.1. The coordinator is
  in-process.
- Never commit `~/.dozzze/` or anything from it. `.gitignore` covers the root.
- This is not a hardware wallet. Use with devnet / testnet funds or small
  amounts only.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
# Run the CLI directly without a build:
npm run dozzze -- doctor
```

Tests are colocated in `packages/node/tests/`. Each module has a `.test.ts`.
Run `npm test -- --watch` during iteration.

## Contributing

Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. TL;DR:

- Open-source only. No custody. No pre-sales.
- Conventional commits. Tests with everything. No `any`. No `@ts-ignore`.
- Honest docs. If a thing doesn't work yet, say so.

## License

[Apache 2.0](./LICENSE). Copy it, fork it, break it, ship it. Don't rug people.

## Links

- Website: [dozzze.xyz](https://dozzze.xyz) (when live) / [`./index.html`](./index.html)
- X: [@DOZZZEBOT](https://x.com/DOZZZEBOT)
- GitHub: [DOZZZEBOT/DOZZZE](https://github.com/DOZZZEBOT/DOZZZE)
