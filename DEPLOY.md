# Deployment runbook — llm_wiki_chat

Single Node service (`@sveltejs/adapter-node` output in `build/`) plus an
external `opencode serve` backend. Every command below was executed against
this repo; placeholders are `<like-this>`.

## 1. Prerequisites

- Node 22+ (`node --version`; sqlite is a Node builtin, no native modules)
- `opencode serve` running and reachable from the app host
- Ports: app `5174` (or your `PORT`), opencode `4096`

## 2. Environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENCODE_API_URL` | no | `http://127.0.0.1:4096` | LLM backend |
| `ADMIN_PASSWORD` | yes, if shared | _(unset = open)_ | gates `/admin` + curating APIs |
| `WIKI_DATA_DIR` | no | `./data` | sqlite + raw uploads + wiki vault location |
| `BODY_SIZE_LIMIT` | no | `512K` | **must be raised** — SvelteKit rejects bigger request bodies with 413 before the app sees them. Set `24M` (covers the 20MB upload policy + overhead). The `bodySizeLimit` key in `svelte.config.js` is ignored by adapter-node 5.x; this env var is the real knob (verified in `build/` output) |
| `PORT` / `HOST` | no | `3000` / `localhost` | adapter-node listen address |
| `ORIGIN` | behind a proxy | _(same-origin)_ | set to the public URL if the proxy host differs |

```sh
export OPENCODE_API_URL=http://127.0.0.1:4096
export ADMIN_PASSWORD=<secret>   # required for any shared deployment
export WIKI_DATA_DIR=/var/lib/wikichat   # survives redeploys; back this up
export PORT=5174 HOST=0.0.0.0
```

## 3. Build and start (verified)

```sh
npm ci
npm run check && npm test   # must both pass before shipping
npm run build               # adapter-node output -> build/
node build                  # serves $HOST:$PORT
```

Smoke test (expects `chat:200` and `[]` on a fresh data dir):

```sh
curl -o /dev/null -w "chat:%{http_code}\n" http://127.0.0.1:5174/chat
curl http://127.0.0.1:5174/api/wiki/pages
```

## 4. systemd service

`/etc/systemd/system/wikichat.service` (adjust paths/user):

```ini
[Unit]
Description=llm_wiki_chat
After=network.target

[Service]
User=wikichat
WorkingDirectory=/opt/llm_wiki_chat
Environment=OPENCODE_API_URL=http://127.0.0.1:4096
Environment=ADMIN_PASSWORD=<secret>
Environment=WIKI_DATA_DIR=/var/lib/wikichat
Environment=PORT=5174
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node build
Restart=always

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now wikichat
journalctl -u wikichat -f   # logs
```

Run `opencode serve` under its own unit (or existing session) on the same host.

### Read-only chat agent (one-time backend setup)

Chat answers should run with zero tools. Define once in the serving host's
`opencode.json` (`~/.config/opencode/opencode.json`, then restart serve):

```json
{ "agent": { "wiki-readonly": {
  "mode": "primary",
  "description": "Answers wiki questions from provided context. No tools.",
  "permission": { "*": "deny" }
} } }
```

Then set it in `/admin` → Chat settings → Agent (`wiki-readonly`), or leave
empty for the server-default agent. Deny, never ask — headless serve stalls on
prompts. Verified: backends may reject restricted agents (opencode free tier
403s); the app fails closed with a clear error instead of silently falling back.
The ingest worker is unaffected (never sends `agent`).

## 5. LAN / reverse proxy

- Same-machine LAN use: `HOST=0.0.0.0`, open the firewall (`sudo ufw allow 5174/tcp`),
  browse `http://<host-ip>:5174/chat`.
- Public domain via nginx + Let's Encrypt (as deployed for `chat.localhost.co.zm`):
  ```sh
  sudo apt-get install -y nginx python3-certbot-nginx
  # /etc/nginx/sites-available/wikichat — proxy_pass http://127.0.0.1:5174 with:
  # proxy_http_version 1.1; proxy_buffering off; proxy_read_timeout 600s;
  # proxy_send_timeout 600s; X-Forwarded-Proto $scheme
  # client_max_body_size 25M;   (nginx default ~1MB 413s uploads first!)
  sudo certbot --nginx -d <domain> --redirect
  ```
  Set `ORIGIN=https://<domain>` in the app unit (else SvelteKit rejects
  cross-origin POSTs), allow ports (`ufw allow 22,80,443/tcp`), reload nginx.
  Certbot handles renewal automatically via its systemd timer.

## 6. Backup and restore

State is one directory: `WIKI_DATA_DIR` (`wiki.db*` + `raw/` + `wiki/*.md`).

```sh
systemctl stop wikichat
cp -r /var/lib/wikichat /backup/wikichat-$(date +%F)
systemctl start wikichat
```

Restore = stop, copy back, start. `wiki.db-shm`/`-wal` are runtime files; copying
them stopped is safe. The `wiki/*.md` vault is also committed-friendly for history.

## 7. Health checks and ops

```sh
curl -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5174/chat            # app alive
curl http://127.0.0.1:5174/api/wiki/pages                                   # wiki readable
curl http://127.0.0.1:4096/global/health                                    # opencode alive
curl -X POST http://127.0.0.1:5174/api/jobs/run                             # nudge stuck ingest jobs
```

| Symptom | Cause / fix |
|---|---|
| Chat spins, then answers | slow free-tier model; streaming shows tokens as they arrive — normal |
| `non-JSON 200` errors in log | model gateway hiccup; retry, or pick another model in `/admin` → Chat settings |
| Job stuck `processing` | restart requeues it (`processing` → `queued` on worker start) |
| Upload rejected | policy is 20MB, `.pdf/.md/.markdown/.txt/.text` (`src/lib/uploads.ts`) |
| `/admin` locked unexpectedly | `ADMIN_PASSWORD` is set in the service env; log in or unset + restart (dev only) |
| Port busy | `ss -ltnp \| grep 5174` → kill the stale vite/node process |

## 8. Updating

```sh
cd /opt/llm_wiki_chat && git pull
npm ci && npm run check && npm test && npm run build
sudo systemctl restart wikichat
```

`data/` migrations run automatically on boot (`ALTER TABLE … ADD COLUMN` in
`getDb()`); existing databases are never wiped.
