// finza-ops dashboard worker — no build step, plain JS module worker.
// Read-only dashboard: renders state, mutates nothing outside its own KV.
//
// Bindings (wrangler.jsonc):
//   PROGRESS — KV: agent activity feed lines  {ts, agent, ticket, status, note}
//   HEALTH   — KV: machine health history     {ts, ram, cpu, gateway_state, disk}
// Secrets (wrangler secret put):
//   DASH_TOKEN — shared secret for Basic auth (dashboard) + /health POST (health poster)
// Optional vars:
//   GH_TOKEN — read-only GitHub token; falls back to unauthenticated REST (both repos are public)

import { HTML } from "./ui.js";

const BOARDS = ["PRTLCTRL/finza-ops", "PRTLCTRL/pocket-lota-ad"];
const ISSUES_CACHE_KEY = "issues:cache:v1"; // written by cron, no TTL
const ISSUES_TTL = 600; // seconds — live-fetch cache fallback
const FEED_PREFIX = "progress:";
const FEED_LIMIT = 60;
const HEALTH_KEY = "health:hist"; // rolling array, newest first, capped
const HEALTH_CAP = 144; // 144 x 10-min samples = 24 h

// Columns are fixed so the digest stays scannable.
const COLUMNS = [
  { id: "ready", label: "ready" },
  { id: "in-progress", label: "in-progress" },
  { id: "done", label: "done this week" },
  { id: "blocked", label: "blocked / stalled" },
];

// ---- helpers ---------------------------------------------------------------

const enc = new TextEncoder();
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function tokenEq(a, b) {
  if (a.length !== b.length) return false;
  const A = enc.encode(a), B = enc.encode(b);
  let d = 0;
  for (let i = 0; i < A.length; i++) d |= A[i] ^ B[i];
  return d === 0;
}

function basicUser(request) {
  const h = request.headers.get("Authorization") || "";
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) return null;
  try {
    const [user] = atob(m[1]).split(":");
    return user || null;
  } catch {
    return null;
  }
}

// Auth: Basic auth with the shared token (any username, token as password),
// or ?token= / X-Dash-Token (used by the phone bookmark fallback + health poster).
async function authed(request, env, { allowQuery = false } = {}) {
  const token = env.DASH_TOKEN || "";
  if (!token) return false;
  const user = basicUser(request);
  if (user && (await tokenEq(user, token))) return true;
  const header = request.headers.get("X-Dash-Token");
  if (header && (await tokenEq(header, token))) return true;
  if (allowQuery) {
    const q = new URL(request.url).searchParams.get("token");
    if (q && (await tokenEq(q, token))) return true;
  }
  return false;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const htmlHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// ---- GitHub issues ----------------------------------------------------------

function bucketOf(issue) {
  const names = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  const has = (n) => names.includes(n);
  if (issue.state === "closed") return "done";
  if (has("blocked") || has("needs-info") || has("needs-triage") || has("wayfinder:grilling")) return "blocked";
  if (has("ready-for-agent") || has("wayfinder:map") || has("wayfinder:task") || has("wayfinder:research") || has("wayfinder:prototype")) return "ready";
  if (has("ready-for-human")) return "in-progress";
  return "blocked"; // open with no actionable label => stalled
}

// "done this week" = closed within the last 7 days
function doneThisWeek(issue, nowMs) {
  const t = issue.closed_at ? Date.parse(issue.closed_at) : 0;
  return t > nowMs - 7 * 864e5;
}

function slim(issue, nowMs) {
  const closed = issue.state === "closed";
  const bucket = closed ? (doneThisWeek(issue, nowMs) ? "done" : "done-old") : bucketOf(issue);
  return {
    n: issue.number,
    t: issue.title,
    labels: (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
    state: issue.state,
    bucket,
    updated: issue.updated_at,
    closed: issue.closed_at,
    url: issue.html_url,
  };
}

async function fetchBoard(board, headers, nowMs) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const u = `https://api.github.com/repos/${board}/issues?state=all&per_page=100&page=${page}&sort=updated&direction=desc`;
    const r = await fetch(u, { headers, cf: { cacheTtl: 60 } });
    if (!r.ok) throw new Error(`github ${board} -> HTTP ${r.status}`);
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const it of arr) if (!it.pull_request) out.push(slim(it, nowMs));
    if (arr.length < 100) break;
  }
  return out;
}

async function fetchAllIssues(env) {
  const headers = { "User-Agent": "finza-dashboard", Accept: "application/vnd.github+json" };
  if (env.GH_TOKEN) headers.Authorization = `Bearer ${env.GH_TOKEN}`;
  const nowMs = Date.now();
  const boards = await Promise.all(BOARDS.map((b) => fetchBoard(b, headers, nowMs)));
  return { boards: BOARDS, columns: COLUMNS, fetched_at: new Date().toISOString(), issues: boards.flat() };
}

async function getIssues(env, forceLive = false) {
  if (!forceLive) {
    const cached = await env.PROGRESS.get(ISSUES_CACHE_KEY, "json");
    if (cached) return { data: cached, source: "kv" };
  }
  try {
    const fresh = await fetchAllIssues(env);
    await env.PROGRESS.put(ISSUES_CACHE_KEY, JSON.stringify(fresh)); // no TTL: offline fallback
    return { data: fresh, source: "live" };
  } catch (e) {
    const stale = await env.PROGRESS.get(ISSUES_CACHE_KEY, "json");
    if (stale) return { data: stale, source: "kv-stale" };
    return { data: { boards: BOARDS, columns: COLUMNS, fetched_at: null, issues: [], error: String(e) }, source: "none" };
  }
}

// ---- agent feed -------------------------------------------------------------

// Feed keys are time-inverted so KV's lexicographic list() returns newest first.
function feedKey(tsMs) {
  return `${FEED_PREFIX}${String(9000000000000 - tsMs).padStart(13, "0")}:${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
}

async function appendFeed(env, line) {
  const tsMs = Number(line.ts) || Date.now();
  const entry = {
    ts: new Date(tsMs).toISOString(),
    agent: String(line.agent || "unknown").slice(0, 40),
    ticket: String(line.ticket || "").slice(0, 40),
    status: String(line.status || "info").slice(0, 20),
    note: String(line.note || "").slice(0, 200),
  };
  await env.PROGRESS.put(feedKey(tsMs), JSON.stringify(entry), { expirationTtl: 30 * 86400 });
  return entry;
}

async function readFeed(env) {
  const list = await env.PROGRESS.list({ prefix: FEED_PREFIX, limit: FEED_LIMIT });
  const items = [];
  for (const k of list.keys || []) {
    const v = await env.PROGRESS.get(k.name, "json");
    if (v) items.push(v);
  }
  return items;
}

// ---- machine health ---------------------------------------------------------

async function readHealth(env) {
  const hist = (await env.HEALTH.get(HEALTH_KEY, "json")) || [];
  return Array.isArray(hist) ? hist : [];
}

function cleanHealth(sample) {
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
  return {
    ts: new Date(Number(sample.ts) || Date.now()).toISOString(),
    ram: num(sample.ram), // GB free
    ram_total: num(sample.ram_total),
    cpu: num(sample.cpu), // %
    gpu: num(sample.gpu),
    disk: num(sample.disk), // GB free
    disk_total: num(sample.disk_total),
    gateway_state: String(sample.gateway_state || "unknown").slice(0, 40),
    game: sample.game === true,
  };
}

async function writeHealth(env, sample) {
  const clean = cleanHealth(sample);
  const hist = await readHealth(env);
  hist.unshift(clean);
  await env.HEALTH.put(HEALTH_KEY, JSON.stringify(hist.slice(0, HEALTH_CAP)));
  return clean;
}

// ---- routes -----------------------------------------------------------------

async function requireAuth(request, env, { allowQuery = false } = {}) {
  if (await authed(request, env, { allowQuery })) return null;
  return new Response("401 — auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="finza dashboard", charset="UTF-8"', ...htmlHeaders },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    // machine health ingest — token-validated, meant for the localhost health poster
    if (path === "/health" && method === "POST") {
      if (!(await authed(request, env, { allowQuery: true }))) {
        return json({ error: "unauthorized" }, 401);
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad json" }, 400);
      }
      const saved = await writeHealth(env, body);
      return json({ ok: true, saved: { ts: saved.ts } });
    }

    if (path === "/health" && method === "GET") {
      const deny = await requireAuth(request, env, { allowQuery: true });
      if (deny) return deny;
      return json({ samples: await readHealth(env) });
    }

    if (path === "/feed" && method === "GET") {
      const deny = await requireAuth(request, env);
      if (deny) return deny;
      return json({ items: await readFeed(env) });
    }

    if (path === "/feed" && method === "POST") {
      const deny = await requireAuth(request, env, { allowQuery: true });
      if (deny) return deny;
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad json" }, 400);
      }
      return json({ ok: true, saved: await appendFeed(env, body) });
    }

    if (path === "/issues" && method === "GET") {
      const deny = await requireAuth(request, env);
      if (deny) return deny;
      const { data, source } = await getIssues(env, url.searchParams.get("refresh") === "1");
      return json({ ...data, source });
    }

    if ((path === "/" || path === "/dashboard") && method === "GET") {
      const deny = await requireAuth(request, env, { allowQuery: true });
      if (deny) return deny;
      return new Response(HTML, { headers: htmlHeaders });
    }

    return new Response("404", { status: 404 });
  },

  // Every 15 min: refresh the issues cache so the phone never burns
  // unauthenticated GitHub rate limits, and drop a heartbeat into the feed.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const fresh = await fetchAllIssues(env);
          await env.PROGRESS.put(ISSUES_CACHE_KEY, JSON.stringify(fresh));
          await appendFeed(env, {
            agent: "dashboard",
            ticket: "finza-ops#14",
            status: "ok",
            note: `issue cache refreshed (${fresh.issues.length} issues)`,
          });
        } catch (e) {
          await appendFeed(env, {
            agent: "dashboard",
            ticket: "finza-ops#14",
            status: "error",
            note: `issue cache refresh failed: ${String(e).slice(0, 120)}`,
          });
        }
      })(),
    );
  },
};