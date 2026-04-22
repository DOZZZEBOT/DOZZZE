# DOZZZE — Project Brief

> This document is the **source of truth** for the DOZZZE project.
> Claude Code should read this before writing any code.

---

## 1. What is DOZZZE

DOZZZE is an **open-source protocol** that aggregates idle AI compute from
consumer-grade sources (Claude Pro subscriptions, ChatGPT Plus, local Ollama,
LM Studio, idle API keys) and routes it to memecoin traders who need cheap
AI-powered alpha discovery (new token scans, rug checks, KOL sentiment analysis).

**Two-sided market:**
- **Contributors** — run a DOZZZE node on their idle compute, earn `$DOZZZE` tokens
- **Consumers** — degens/traders who pay (in tokens or fees) for AI signals at
  60-80% below raw API cost

**Open-source, self-deployed. No SaaS. No custody. No KYC.**
Users clone the repo and run their own node. The protocol just matches supply
and demand and handles on-chain settlement.

---

## 2. Core values (non-negotiable)

1. **Open source first** — MIT or Apache 2.0 license
2. **No custody of user funds or keys** — everything stays client-side
3. **No pre-sale, no VC round, no team token unlock** — pure proof-of-work
4. **Permissionless** — anyone can run a node, anyone can submit jobs
5. **Honest documentation** — if a feature doesn't work yet, say "not implemented"
   rather than faking it

---

## 3. Architecture (planned)

```
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│  CONTRIBUTOR    │          │  COORDINATOR    │          │   CONSUMER      │
│  (Node Client)  │◄────────►│  (Matching)     │◄────────►│  (Trader App)   │
│                 │          │                 │          │                 │
│  - Ollama       │          │  - Job queue    │          │  - Web dashboard│
│  - BYOK keys    │          │  - Reputation   │          │  - CLI client   │
│  - Local GPU    │          │  - Settlement   │          │  - Discord bot  │
└─────────────────┘          └─────────────────┘          └─────────────────┘
         │                            │                            │
         └────────────── Solana Blockchain ──────────────┘
                         (settlement, staking, slashing)
```

---

## 4. Tech stack

| Layer | Choice | Reason |
|---|---|---|
| **Node client** | TypeScript + Node.js | Ollama SDK is JS-native; degens can read/fork it |
| **Chain** | Solana | Memecoin mainstreet; cheap gas; fast finality |
| **Wallet** | `@solana/web3.js` + bip39 | Standard crypto-native; no custodian |
| **Local model** | Ollama REST API (port 11434) | De-facto standard for local LLM |
| **API bridging** | OpenAI-compatible proxy | Works with Claude/OpenAI/DeepSeek out of box |
| **Coordinator** | (v2+) Cloudflare Workers / Hono | Serverless, globally low-latency |
| **Frontend (later)** | Next.js + Tailwind | Matches landing page aesthetic |
| **Testing** | vitest | Fast, modern, well-typed |

---

## 5. Repository layout (target)

```
dozzze/
├── README.md                    # Entry point, matches landing page tone
├── LICENSE                      # Apache 2.0
├── CONTRIBUTING.md
├── .github/
│   └── workflows/               # CI: test, lint, build
├── packages/
│   ├── node/                    # The node client (first priority)
│   │   ├── src/
│   │   │   ├── cli.ts           # `dozzze` command entry
│   │   │   ├── detector.ts      # Scan for local Ollama/LM Studio
│   │   │   ├── wallet.ts        # Solana keypair mgmt
│   │   │   ├── worker.ts        # Run inference, report result
│   │   │   ├── router.ts        # Receive jobs from coordinator
│   │   │   └── config.ts        # ~/.dozzze/config.json mgmt
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── sdk/                     # Shared types & protocol (future)
│   └── contracts/               # Solana programs (future)
├── docs/
│   ├── quickstart.md
│   ├── architecture.md
│   └── tokenomics.md            # Eventually
├── scripts/
│   └── install.sh               # The `curl | sh` installer
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
└── website/                     # Landing page (already done)
    ├── index.html               # (dozzze-en.html)
    └── zh/index.html            # (dozzze.html Chinese version)
```

---

## 6. MVP scope (first 2 weeks)

**Goal:** 5 real users can run `dozzze start` on their machine,
it detects their local Ollama, and it logs "job received / inference done / paid X $DOZZZE"
with a mocked coordinator.

### Must have (MVP)
1. `dozzze` CLI scaffold with commands: `start`, `stop`, `config`, `wallet`, `status`
2. Automatic detection of local Ollama (port 11434) and LM Studio (port 1234)
3. Solana wallet creation / import on first run, encrypted at `~/.dozzze/keystore.json`
4. A **mocked coordinator** (not real yet) that fires a fake inference job every 30 seconds
5. The node answers the mocked job via local Ollama, prints result + fake payout
6. Config file at `~/.dozzze/config.json`
7. Unit tests with vitest for every module
8. README.md that matches the landing page's voice (degen-friendly, no corporate tone)

### Must NOT have in MVP (defer to v0.2+)
- Real coordinator / matchmaking server
- Real on-chain settlement (mock the payouts in logs)
- Subscription account bridging (ToS risk, do later with proper warnings)
- Token launch / smart contracts
- Web dashboard
- Cross-chain support

---

## 7. Safety rules for the code

- **NEVER commit private keys, seed phrases, or API keys.** `.dozzze/` must be in `.gitignore`
- **NEVER bind node ports to 0.0.0.0 by default.** Always localhost unless user opts in
- **NEVER silently exceed API spending caps.** User-defined budget is hard ceiling
- **ALWAYS encrypt keystore at rest** (scrypt + AES-256-GCM, industry standard)
- **ALWAYS warn before any action that could violate third-party ToS**
  (e.g., subscription bridging — that's a "opt-in with red warning" path later)

---

## 8. Naming rules

- Token ticker is `$DOZZZE` (five Zs, all caps, always prefixed with `$`)
- Do NOT abbreviate to `$DOZZ` or `$DZZE`. The 5 Zs are the brand
- Project name "DOZZZE" in copy; package name `dozzze` in code (lowercase)
- Node ID example: `NODE #0069` (reference to the mascot lore)

---

## 9. Voice & tone (for README, CLI output, errors)

Copy from the landing page's voice:
- **Direct, honest, a little cheeky**
- Never corporate / enterprise-speak
- Address user as "you", not "the user"
- Show personality — e.g., CLI output can say "Your wallet just woke up" instead of "Wallet initialized"
- Errors should be helpful, not scary: "Ollama isn't running. Start it with `ollama serve` and try again."
- **No emoji spam.** One per section max. Prefer ASCII/unicode symbols (`▸`, `●`, `⚠`, `→`)

---

## 10. Open questions (decide later)

- Which Solana cluster for MVP? → Start on **devnet**, flip to mainnet when ready
- How does the coordinator prevent spam? → TBD, probably stake-based rate limits
- Where does the coordinator live? → v0.1 is local mock; v0.2 Cloudflare Worker
- Token distribution mechanism? → TBD, definitely no pre-sale
