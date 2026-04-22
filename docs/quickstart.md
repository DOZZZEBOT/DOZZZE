# DOZZZE — Quickstart

Get a node running locally in about 5 minutes. Everything is mocked — no real
coordinator, no on-chain settlement, no token yet. This is MVP.

## Prerequisites

- **Node.js 20+** — `node -v`. If it's older, grab a newer build from
  [nodejs.org](https://nodejs.org) and re-open your shell.
- **Ollama** running locally — `ollama serve` in a separate terminal. Pull at
  least one small model:
  ```
  ollama pull llama3.2
  ```
- **git** — for cloning the repo.

You do **not** need a Solana RPC, a funded wallet, or any internet access beyond
the initial clone + npm install. MVP is fully local.

## 1. Clone and build

```bash
git clone https://github.com/DOZZZEBOT/DOZZZE.git
cd DOZZZE
npm install
npm run build
```

## 2. Sanity check

```bash
npm run dozzze -- doctor
```

You should see a list of checks. Expect:

- `node.js: ... (>= 20 OK)`
- `runtime ollama: up @ http://127.0.0.1:11434 (N models)`
- `wallet: not created yet` (that's fine — next step)
- `solana devnet RPC: reachable` (or `unreachable` if you're offline — also fine)

## 3. Create a wallet

```bash
npm run dozzze -- wallet create
```

It will ask for a password (min 8 chars), write an encrypted keystore to
`~/.dozzze/keystore.json`, and print a recovery mnemonic once. **Write the
mnemonic down.** It won't be shown again.

Confirm the wallet round-trips:

```bash
npm run dozzze -- wallet verify
```

## 4. Start the node

```bash
npm run dozzze -- start
```

You should see a banner, a runtime line, and then — every 30 seconds — a
fake job come in, get routed to your local Ollama, and log a fake $DOZZZE
payout. Ctrl-C to stop.

From another terminal:

```bash
npm run dozzze -- status
npm run dozzze -- stop
```

## Where things live

| Path | What |
|------|------|
| `~/.dozzze/config.json` | Node configuration (edit with `dozzze config set`) |
| `~/.dozzze/keystore.json` | Encrypted Solana keypair |
| `~/.dozzze/dozzze.pid` | PID of the running node (if any) |

## Troubleshooting

**`no local runtime detected`** — Ollama isn't running. Start it with
`ollama serve` and try again.

**`no wallet found`** — Run `dozzze wallet create`.

**`wrong password, or keystore is corrupted`** — Double-check your password.
If you're sure it's right, the keystore file may have been modified since
creation.

**Jobs failing with `HTTP 404`** — You don't have the model installed in
Ollama. The mock coordinator uses `llama3.2`, `qwen2.5`, and `gemma2` by
default. Pull one of them: `ollama pull llama3.2`.

## What's next

- Nothing here touches a real coordinator yet. The mock fires synthesized
  jobs on a timer.
- No on-chain settlement. Payouts are numbers printed to your terminal.
- No token launch. Don't buy anything.

v0.2 adds a real coordinator (Cloudflare Worker) and devnet settlement. v0.3
brings subscription bridging with an explicit opt-in warning. Follow along at
[github.com/DOZZZEBOT/DOZZZE](https://github.com/DOZZZEBOT/DOZZZE).
