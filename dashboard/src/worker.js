// finza-ops dashboard worker — no build step, plain JS module worker.
// Read-only dashboard: renders state, mutates nothing outside its own KV.
//
// Bindings (wrangler.jsonc):
//   PROGRESS — KV: agent activity feed lines  {ts, agent, ticket, status, note}
//   HEALTH   — KV: machine health history     {ts, ram, cpu, gateway_state, disk, ...}
//   CRASH    — KV: crash & restart events     {ts, kind, source, title, proc, ...}
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
const CRASH_KEY = "crash:hist"; // rolling array, newest first, capped
const CRASH_CAP = 100;

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

async function fetchBoard(board, headers) {
  // Return RAW issues (body needed for wayfinder map parsing); slimming happens
  // in fetchAllIssues after features are computed.
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const u = `https://api.github.com/repos/${board}/issues?state=all&per_page=100&page=${page}&sort=updated&direction=desc`;
    const r = await fetch(u, { headers, cf: { cacheTtl: 60 } });
    if (!r.ok) throw new Error(`github ${board} -> HTTP ${r.status}`);
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const it of arr) if (!it.pull_request) out.push(it);
    if (arr.length < 100) break;
  }
  return out;
}

// ---- wayfinding: feature progress from wayfinder:map issues ------------------
// A map issue's body lists children as markdown bullets, optionally with
// checkboxes. Children are resolved against the same fetch (both repos are in
// payload), so no extra GitHub calls are needed.

function parseChildren(body) {
  const out = [];
  for (const raw of String(body || "").split("\n")) {
    if (!/^\s*[-*]\s+/.test(raw)) continue;
    const chk = /^\s*[-*]\s+\[( |x|X)\]/.exec(raw);
    const nums = raw.match(/#(\d+)/g) || [];
    if (!nums.length) continue;
    const cross = /PRTLCTRL\/([a-z0-9._-]+)#/i.exec(raw);
    for (const t of nums) {
      const n = Number(t.slice(1));
      if (n) out.push({ n, repo: cross ? cross[2] : null, checked: chk ? chk[1].toLowerCase() === "x" : null });
    }
  }
  return out;
}

function computeFeatures(rawIssues, boards) {
  const labelNames = (it) => (it.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  const repoOf = (it) => {
    const m = /PRTLCTRL\/([a-z0-9._-]+)/.exec(it.html_url || "");
    return m ? m[1] : null;
  };
  const byKey = {};
  for (const it of rawIssues) {
    if (it.pull_request) continue;
    const repo = repoOf(it);
    if (repo) byKey[`${repo}#${it.number}`] = {
      n: it.number, repo, title: it.title, state: it.state, labels: labelNames(it), url: it.html_url,
    };
  }
  const feats = [];
  for (const it of rawIssues) {
    if (it.pull_request || !labelNames(it).includes("wayfinder:map")) continue;
    const repo = repoOf(it);
    const kids = [];
    const seen = new Set();
    for (const c of parseChildren(it.body)) {
      const key = `${c.repo || repo}#${c.n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const child = byKey[key];
      const closed = c.checked === true || (child ? child.state === "closed" : false);
      const blocked = child ? (child.labels.some((l) => l === "blocked" || l === "needs-info" || l === "needs-triage") || /HITL|waiting (on|for) arsal|needs arsal/i.test(child.title)) : false;
      kids.push({ n: c.n, repo: c.repo || repo, title: child ? child.title : `(unresolved #${c.n})`, state: child ? child.state : "unknown", url: child ? child.url : null, closed, blocked });
    }
    const done = kids.filter((k) => k.closed).length;
    const frontier = kids.find((k) => !k.closed && !k.blocked) || null;
    const blockers = kids.filter((k) => k.blocked && !k.closed);
    feats.push({
      repo, n: it.number, title: it.title, url: it.html_url,
      done, total: kids.length, pct: kids.length ? Math.round((100 * done) / kids.length) : 0,
      frontier, blockers,
    });
  }
  const order = Object.fromEntries(boards.map((b, i) => [b.split("/")[1], i]));
  feats.sort((a, b) => (order[a.repo] ?? 99) - (order[b.repo] ?? 99) || a.n - b.n);
  return feats;
}

async function fetchAllIssues(env) {
  const headers = { "User-Agent": "finza-dashboard", Accept: "application/vnd.github+json" };
  if (env.GH_TOKEN) headers.Authorization = `Bearer ${env.GH_TOKEN}`;
  const nowMs = Date.now();
  const raws = await Promise.all(BOARDS.map((b) => fetchBoard(b, headers)));
  const all = raws.flat();
  const features = computeFeatures(all, BOARDS);
  return {
    boards: BOARDS, columns: COLUMNS, fetched_at: new Date().toISOString(), features,
    issues: all.map((it) => slim(it, nowMs)),
  };
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
  const out = {
    ts: new Date(Number(sample.ts) || Date.now()).toISOString(),
    ram: num(sample.ram), // GB used (poster sends used; UI labels it)
    ram_total: num(sample.ram_total),
    cpu: num(sample.cpu), // %
    gpu: num(sample.gpu),
    disk: num(sample.disk), // GB free
    disk_total: num(sample.disk_total),
    gateway_state: String(sample.gateway_state || "unknown").slice(0, 40),
    game: sample.game === true,
  };
  // crash-observability fields carried alongside each sample (all optional)
  if (sample.sidecar_alive != null) out.sidecar_alive = sample.sidecar_alive === true;
  if (sample.sidecar_pid != null) out.sidecar_pid = String(sample.sidecar_pid).slice(0, 12);
  if (sample.watchdog && typeof sample.watchdog === "object") {
    out.watchdog = {
      last_ts: String(sample.watchdog.last_ts || "").slice(0, 32),
      last_pid: String(sample.watchdog.last_pid || "").slice(0, 12),
      restarts_24h: Number.isFinite(Number(sample.watchdog.restarts_24h)) ? Number(sample.watchdog.restarts_24h) : 0,
    };
  }
  if (sample.last_stop && typeof sample.last_stop === "object" && sample.last_stop.ts) {
    out.last_stop = {
      ts: String(sample.last_stop.ts).slice(0, 32),
      signal: String(sample.last_stop.signal || "").slice(0, 24),
      parent_pid: String(sample.last_stop.parent_pid || "").slice(0, 16),
      parent_name: String(sample.last_stop.parent_name || "").slice(0, 40),
      recovered_by: String(sample.last_stop.recovered_by || "").slice(0, 24),
    };
  }
  if (sample.last_wer && typeof sample.last_wer === "object" && sample.last_wer.ts) {
    out.last_wer = {
      ts: String(sample.last_wer.ts).slice(0, 32),
      id: String(sample.last_wer.id || "").slice(0, 10),
      proc: String(sample.last_wer.proc || "").slice(0, 80),
      sig: String(sample.last_wer.sig || "").slice(0, 40),
      title: String(sample.last_wer.title || "").slice(0, 180),
    };
  }
  return out;
}

async function writeHealth(env, sample) {
  const clean = cleanHealth(sample);
  const hist = await readHealth(env);
  hist.unshift(clean);
  await env.HEALTH.put(HEALTH_KEY, JSON.stringify(hist.slice(0, HEALTH_CAP)));
  return clean;
}

// ---- crash & restart events (section 7) -------------------------------------

// Sources, all posted by the local health poster:
//   wer      — Windows Error Reporting events (Event ID + first message line + process)
//   gateway  — gateway.log "Shutdown context" lines (signal + parent_pid)
//   watchdog — watchdog.log pid-change = watchdog-detected restart
//   sidecar  — photon sidecar port 8789 death signature
function cleanCrash(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind || "other").slice(0, 16);
  const tsMs = Number(raw.ts);
  const ts = tsMs && Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : null;
  const title = String(raw.title || "").trim().slice(0, 180);
  if (!ts || !title) return null;
  const c = { ts, kind, title };
  if (raw.source != null) c.source = String(raw.source).slice(0, 40);
  if (raw.proc != null) c.proc = String(raw.proc).slice(0, 80);
  if (raw.sig != null) c.sig = String(raw.sig).slice(0, 40);
  if (raw.parent_pid != null) c.parent_pid = String(raw.parent_pid).slice(0, 16);
  if (raw.recovered_by != null) c.recovered_by = String(raw.recovered_by).slice(0, 24);
  return c;
}

async function readCrashes(env) {
  const hist = (await env.CRASH.get(CRASH_KEY, "json")) || [];
  return Array.isArray(hist) ? hist : [];
}

// Merge poster-submitted events; dedupe on (kind, ts, title) so the 10-min
// poster can resend the same recent events without flooding the timeline.
async function mergeCrashes(env, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return 0;
  const existing = await readCrashes(env);
  const seen = new Set(existing.map((c) => `${c.kind}|${c.ts}|${c.title}`));
  const added = [];
  for (const raw of incoming.slice(0, 40)) {
    const c = cleanCrash(raw);
    if (!c) continue;
    const k = `${c.kind}|${c.ts}|${c.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    added.push(c);
  }
  if (added.length > 0) {
    await env.CRASH.put(CRASH_KEY, JSON.stringify([...added, ...existing].slice(0, CRASH_CAP)));
  }
  return added.length;
}

// ---- routes -----------------------------------------------------------------

async function requireAuth(request, env, { allowQuery = false } = {}) {
  if (await authed(request, env, { allowQuery })) return null;
  return new Response("401 — auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="finza dashboard", charset="UTF-8"', ...htmlHeaders },
  });
}

// Inline the crash timeline into the page so the Crashes tab paints instantly
// (one KV read server-side instead of a client round-trip). "<" is escaped so
// the payload can never break out of the <script> tag.
function bootHtml(crashes) {
  const payload = JSON.stringify({ crashes }).replace(/</g, "\\u003c");
  return HTML.replace("window.__BOOT=null;", `window.__BOOT=${payload};`);
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
      const crashesAdded = await mergeCrashes(env, body.crashes);
      return json({ ok: true, saved: { ts: saved.ts }, crashes_added: crashesAdded });
    }

    if (path === "/health" && method === "GET") {
      const deny = await requireAuth(request, env, { allowQuery: true });
      if (deny) return deny;
      return json({ samples: await readHealth(env) });
    }

    if (path === "/crashes" && method === "GET") {
      const deny = await requireAuth(request, env, { allowQuery: true });
      if (deny) return deny;
      return json({ events: await readCrashes(env) });
    }

    if (path === "/crashes" && method === "POST") {
      const deny = await requireAuth(request, env, { allowQuery: true });
      if (deny) return deny;
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad json" }, 400);
      }
      const added = await mergeCrashes(env, Array.isArray(body) ? body : [body]);
      return json({ ok: true, added });
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
      return new Response(bootHtml(await readCrashes(env)), { headers: htmlHeaders });
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