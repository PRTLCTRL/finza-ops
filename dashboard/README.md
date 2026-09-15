# Dashboard

Cloudflare Worker serving the ops dashboard for Arsal (finza-ops #14).

- Live: https://finza-dashboard.prtl.workers.dev
- Auth: Basic auth — token-as-username (`-u "TOKEN:"`), or `?token=` / `X-Dash-Token`
- Token: stored in `C:\Users\Arsal\finza-keys\dash_token.txt` (also `wrangler secret put DASH_TOKEN`)
- KV: PROGRESS (agent feed), HEALTH (machine history, 24h/144 samples)
- Cron: 15-min issue-cache refresh + heartbeat

## Deploy

    cd dashboard && npx wrangler deploy

## Health poster (VENGEANCE side)

- `finza repo scripts/health_post.py` (stdlib-only) posts to /health every 10 min
- Scheduled task `FinzaHealthPoster` (hidden pythonw, 2-min kill cap)
- Token file read at runtime, never logged

## Endpoints

- GET / — UI (login card -> token)
- GET /issues — both boards bucketed by wayfinder labels (KV-cached, cron refreshed)
- GET/POST /feed — agent progress lines {ts, agent, ticket, status, note}
- GET /health — history; POST /health — ingest (token required)
