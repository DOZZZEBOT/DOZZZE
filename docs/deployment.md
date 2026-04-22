# Deploy the DOZZZE coordinator

The coordinator is the one piece that has to live on a public address for
nodes and consumers to find each other. Everything else (nodes, bots) can
be anywhere.

This doc is the **runbook** — copy the commands, fill the blanks, you're live.
Two paths: a generic VPS (most control, ~$4/mo) or Fly.io (easiest TLS, free
tier usually works).

---

## 0. Prerequisites

- A domain you control (for TLS). Examples below use `coord.dozzze.xyz` —
  swap for your own.
- A machine with public IPv4/IPv6 and at least 512 MB RAM. Hetzner CX11,
  DigitalOcean $4 droplet, Scaleway Stardust — all fine.
- SSH access to that machine.
- The `ghcr.io/dozzzebot/dozzze-coord:latest` image already exists on GHCR
  — the `.github/workflows/publish-coordinator.yml` workflow pushes it on
  every merge to `main`.

## 1. Generate API keys

Pick keys once, give one to each consumer (bot, app, your own CLI). Never
reuse keys across operators — revoking is just "edit the env var".

```bash
for name in discord-bot my-cli hunt-alpha; do
  echo "$name: $(openssl rand -hex 32)"
done
```

Save these somewhere safe. We'll feed them to the container as
`DOZZZE_COORD_API_KEYS=k1,k2,k3`.

---

## Option A — Generic VPS with Docker + Caddy

Most flexibility. Works on any Linux box you can SSH into.

### A.1 Install Docker + Caddy

```bash
# Debian / Ubuntu
curl -fsSL https://get.docker.com | sh
sudo apt-get install -y caddy
```

### A.2 Open the firewall

```bash
# Ubuntu ufw example
sudo ufw allow 80
sudo ufw allow 443
# Do NOT open 8787 to the public — Caddy proxies to it over loopback.
```

### A.3 Start the coordinator

```bash
sudo docker volume create dozzze-coord

sudo docker run -d \
  --name dozzze-coord \
  --restart unless-stopped \
  --publish 127.0.0.1:8787:8787 \
  -v dozzze-coord:/data \
  -e DOZZZE_COORD_API_KEYS="k1,k2,k3" \
  -e DOZZZE_COORD_DB="/data/coord.sqlite" \
  ghcr.io/dozzzebot/dozzze-coord:latest \
    --host 0.0.0.0 \
    --long-poll 25000 \
    --rate-limit 120 \
    --window 60000
```

Notes:
- `--publish 127.0.0.1:8787:8787` binds ONLY to localhost on the host.
  Caddy (next step) is the only thing that gets to speak to the container.
- `--long-poll 25000` lets nodes hold `/poll` for up to 25 s, which
  cuts polling traffic by ~90% compared to a tight 1 s short-poll.
- Rate limits: 120 requests/min/key. Adjust to taste.

### A.4 Put Caddy in front

`/etc/caddy/Caddyfile`:

```
coord.dozzze.xyz {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8787 {
    # Give the long-poll path enough room before Caddy times out.
    transport http {
      read_timeout 40s
    }
  }
  log {
    output file /var/log/caddy/coord.log
  }
}
```

```bash
sudo systemctl reload caddy
```

Caddy auto-provisions a Let's Encrypt certificate on first request to the
hostname. Point DNS `A`/`AAAA` records at your server, then:

```bash
curl https://coord.dozzze.xyz/health
# {"ok":true,"protocolVersion":1,"authRequired":true,"pending":0,"completed":0}
```

### A.5 Verify auth

```bash
# 401 without a key
curl -sS https://coord.dozzze.xyz/submit \
  -H 'content-type: application/json' \
  -d '{"protocolVersion":1,"kind":"completion","model":"x","prompt":"hi","payout":0.01}'

# 201 with a key
curl -sS https://coord.dozzze.xyz/submit \
  -H "authorization: Bearer k1" \
  -H 'content-type: application/json' \
  -d '{"protocolVersion":1,"kind":"completion","model":"llama3.2","prompt":"hi","payout":0.01}'
```

### A.6 Tail logs

```bash
sudo docker logs -f dozzze-coord
sudo tail -f /var/log/caddy/coord.log
```

---

## Option B — Fly.io

Free tier usually covers one small coord. Fly handles TLS + multi-region
anycast for you.

### B.1 Install flyctl

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

### B.2 Create `fly.toml` in the repo root

```toml
app = "dozzze-coord-<your-handle>"
primary_region = "iad"

[build]
  image = "ghcr.io/dozzzebot/dozzze-coord:latest"

[env]
  DOZZZE_COORD_DB = "/data/coord.sqlite"

[[mounts]]
  source = "dozzze_coord_data"
  destination = "/data"

[http_service]
  internal_port = 8787
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
  [http_service.concurrency]
    type = "requests"
    soft_limit = 200
    hard_limit = 400

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

### B.3 Deploy

```bash
# Create the app + volume
fly apps create dozzze-coord-<your-handle>
fly volumes create dozzze_coord_data --region iad --size 1

# Set secrets (never put these in fly.toml)
fly secrets set DOZZZE_COORD_API_KEYS="k1,k2,k3"

# Launch
fly deploy
```

Point a CNAME from `coord.dozzze.xyz` to `<app>.fly.dev` and attach it:

```bash
fly certs add coord.dozzze.xyz
fly certs show coord.dozzze.xyz   # verify DNS once it's propagated
```

---

## 2. Point a node at your live coord

On any machine that will run a node:

```bash
dozzze config set coordinator '{"mode":"http","url":"https://coord.dozzze.xyz"}'
dozzze wallet create
ollama serve &
dozzze start
```

You'll see jobs arrive from the real coord instead of the mock timer.

For the `dozzze ask` side and Discord bot, export the matching bearer:

```bash
export DOZZZE_COORD_API_KEY=k1
dozzze ask "Is this token a rug?"
```

---

## 3. Update procedure

Every merge to `main` retags `:latest`. To roll forward:

```bash
sudo docker pull ghcr.io/dozzzebot/dozzze-coord:latest
sudo docker stop dozzze-coord && sudo docker rm dozzze-coord
# re-run the `docker run` from step A.3 — the named volume preserves the
# SQLite queue across the restart.
```

To pin a specific build (recommended for production), use the `:git-<sha>`
tag the workflow also publishes.

Fly path:

```bash
fly deploy   # pulls :latest by default
```

---

## 4. Back up the queue

The SQLite DB lives in the `dozzze-coord` volume at `/data/coord.sqlite`.
Back it up hot — WAL mode makes this safe:

```bash
# Docker / VPS
sudo docker exec dozzze-coord sqlite3 /data/coord.sqlite ".backup /data/backup-$(date +%F).sqlite"
sudo docker cp dozzze-coord:/data/backup-$(date +%F).sqlite ./
```

Rclone / restic / borgbackup the `backup-*.sqlite` files to S3, B2, etc.

---

## 5. Observability (minimal)

The coord emits plain stdout. Ship it somewhere:

```bash
# Loki via docker loki driver
sudo docker run ... --log-driver=loki --log-opt loki-url=https://loki.example/loki/api/v1/push ...

# Or just persist to a file
sudo docker run ... --log-driver=json-file --log-opt max-size=10m --log-opt max-file=5 ...
```

Liveness: any uptime monitor hitting `GET /health` — the response is
JSON including queue depth, so you can graph pending jobs over time with
a one-line Prometheus exporter if you want.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl /health` hangs forever | Caddy not reloaded; still trying old cert | `sudo systemctl reload caddy`, check `/var/log/caddy/*` |
| All nodes report `coordinator poll: HTTP 401` | They're missing the bearer | `export DOZZZE_COORD_API_KEY=...` on each node, or `dozzze config set coordinator '{...}'` (URL only; API key still via env for hygiene) |
| Queue depth grows forever | No nodes are polling, or they're all failing to report | `docker logs dozzze-coord` — look for POST /report failures. Check node-side Ollama health. |
| Rate-limit 429 on a bot you trust | That bot's key is spamming | Bump `--rate-limit` for that key, or give it its own key with a higher cap |
| SQLite file grows unboundedly | Completed results are never GC'd | v0.3 keeps every Result forever. Either prune with SQL (`DELETE FROM results WHERE recorded_at < ?`) or wait for the TTL flag that lands in v0.4 |
| Fly health-check fails immediately | `DOZZZE_COORD_API_KEYS` unset → auth OFF and public `/submit` becomes abuse vector; Fly rejects if config tripwires added | Set secrets before `fly deploy` |

---

## 7. Security checklist (before you hand the URL to anyone)

- [ ] HTTPS enforced (Caddy / Fly — not plain HTTP)
- [ ] `DOZZZE_COORD_API_KEYS` set with distinct keys per operator
- [ ] Container port 8787 NOT published publicly (only via reverse proxy)
- [ ] Rate limit set to something reasonable per key
- [ ] SQLite volume backed up at least daily
- [ ] Image pinned to `:git-<sha>` for prod (not `:latest`)
- [ ] Logs going somewhere you'll actually read
- [ ] Cloudflare / similar in front if you expect abuse spikes

Nothing in this list involves tokens or money. When you do launch
`$DOZZZE`, the only deployment change needed is setting
`DOZZZE_WALLET_PASSWORD` on each node so they can sign settlement tx.
