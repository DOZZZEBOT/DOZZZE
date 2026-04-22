# Contributing to DOZZZE

Thanks for showing up. DOZZZE is an open-source protocol — it gets better when
you break it.

## Ground rules

- **Open source first.** All code is Apache 2.0. If you'd rather your contribution
  stay closed, don't submit it.
- **No custody, ever.** The protocol never holds a user's funds or private keys.
  If a PR introduces custody, it does not get merged.
- **Honest docs.** If a feature doesn't work yet, the docs say "not implemented".
  We never pretend.

## Local setup

```bash
git clone https://github.com/DOZZZEBOT/DOZZZE.git
cd DOZZZE
npm install
npm test
npm run build
```

Then, from the root:

```bash
npm run dozzze -- --help
```

## Code style

- TypeScript strict mode. No `any`. No `// @ts-ignore`.
- One file = one responsibility. Short, focused modules.
- Every exported function gets a JSDoc comment.
- Every new module ships with real vitest tests. Not mocks that always pass.
- Commit messages use [Conventional Commits](https://www.conventionalcommits.org):
  `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.

## Security

- Never bind node ports to `0.0.0.0` by default. Localhost unless the user opts in.
- Never commit a private key, seed phrase, or `.env` file.
- Keystore-at-rest uses `scrypt` + `AES-256-GCM`. If you change that, the PR needs
  a security review.
- If you find a vulnerability, email the maintainers rather than opening a public
  issue. (Email TBD — for now, post a GitHub issue titled `[SECURITY]` with minimal
  detail and we'll follow up privately.)

## Branching

- `main` is always green. Don't break it.
- Feature branches: `feat/<short-name>`, fix branches: `fix/<short-name>`.
- PRs need at least one approval and passing CI before merge.

## What we won't accept

- Pre-sales, VC rounds, team token unlocks, or any form of rent-seeking.
- Closed-source dependencies for the node client.
- Bridging a user's subscription without a red-warning opt-in that explains the
  ToS risk.
