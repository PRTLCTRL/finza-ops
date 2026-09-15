// Unit tests for finza-dashboard worker logic (run: node test.js)
import { strict as assert } from "node:assert";

const src = await import("file://" + process.argv[2].replace(/\\/g, "/"));
const worker = src.default;

// ---- bootHtml: inlines crash payload, escapes "<" ---------------------------
function fakeEnv(kv) {
  const kvget = (store) => async (k, t) => (t === "json" && store[k] != null ? JSON.parse(store[k]) : store[k] ?? null);
  return {
    PROGRESS: {
      get: kvget(kv.progress),
      put: async (k, v) => { kv.progress[k] = v; },
      list: async ({ prefix, limit }) => ({
        keys: Object.keys(kv.progress).filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })),
      }),
    },
    HEALTH: {
      get: kvget(kv.health),
      put: async (k, v) => { kv.health[k] = v; },
    },
    CRASH: {
      get: kvget(kv.crash),
      put: async (k, v) => { kv.crash[k] = v; },
    },
    DASH_TOKEN: "test-token-123",
  };
}

const htmlReq = (opts = {}) => new Request("https://dash.test/", {
  headers: opts.auth ? { Authorization: "Basic " + Buffer.from(opts.auth + ":").toString("base64") } : {},
});

{
  const env = fakeEnv({ progress: {}, health: {}, crash: { "crash:hist": JSON.stringify([{ ts: "2026-09-14T23:09:48Z", kind: "gateway", title: "gateway stopped (signal=UNKNOWN)" }]) } });
  const res = await worker.fetch(htmlReq({ auth: "test-token-123" }), env, { waitUntil: () => {} });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("window.__BOOT="), "inline boot payload present");
  assert.ok(!html.includes("window.__BOOT=null;"), "placeholder replaced");
  assert.ok(html.includes("gateway stopped"), "crash event inlined");
  assert.ok(html.includes("<script>") && html.includes("</script>"), "script tags intact");
  // the escaped payload must not contain a raw "</" sequence from data
  const boot = html.match(/window__BOOT/) ? null : html.match(/window\.(__BOOT)=/);
  assert.ok(boot, "boot marker found");
  // no token material in html
  assert.ok(!html.includes("test-token-123"), "no secret in HTML");
}

// ---- no token => 401 on UI and data routes ----------------------------------
{
  const env = fakeEnv({ progress: {}, health: {}, crash: {} });
  for (const path of ["/", "/issues", "/feed", "/health", "/crashes"]) {
    const res = await worker.fetch(new Request("https://dash.test" + path), env, { waitUntil: () => {} });
    assert.equal(res.status, 401, path + " must 401 without token");
  }
}

// ---- wrong token => 401; token via query works on / -------------------------
{
  const env = fakeEnv({ progress: {}, health: {}, crash: {} });
  const bad = await worker.fetch(htmlReq({ auth: "t:wrong" }), env, { waitUntil: () => {} });
  assert.equal(bad.status, 401);
  const okq = await worker.fetch(new Request("https://dash.test/?token=test-token-123"), env, { waitUntil: () => {} });
  assert.equal(okq.status, 200);
}

// ---- POST /health: ingest + crash merge + dedupe ----------------------------
{
  const env = fakeEnv({ progress: {}, health: {}, crash: {} });
  const sample = {
    ram: 30.4, ram_total: 68.5, cpu: 7, disk: 918.2, gateway_state: "running",
    sidecar_alive: true, watchdog: { last_ts: "2026-09-15T00:13:23", last_pid: 22596, restarts_24h: 1 },
    last_stop: { ts: "2026-09-14T23:09:48", signal: "UNKNOWN", parent_pid: "37200", recovered_by: "watchdog" },
    crashes: [
      { kind: "gateway", ts: 1760000000000, title: "gateway stopped (signal=UNKNOWN)", sig: "UNKNOWN", parent_pid: "37200", recovered_by: "watchdog" },
      { kind: "watchdog", ts: 1760000060000, title: "gateway restart detected by watchdog (pid 14920 -> 22596)", recovered_by: "watchdog" },
      { kind: "bogus-ts", ts: "garbage", title: "no ts -> dropped" },
      { kind: "notitle", ts: 1760000000000, title: "  " },
    ],
  };
  const post = (body) => worker.fetch(new Request("https://dash.test/health", { method: "POST", body: JSON.stringify(body), headers: { Authorization: "Basic " + Buffer.from("test-token-123:").toString("base64") } }), env, { waitUntil: () => {} });
  const r1 = await post(sample);
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.crashes_added, 2, "valid crashes merged, invalid dropped");
  const r2 = await post({ ...sample, cpu: 11 });
  const j2 = await r2.json();
  assert.equal(j2.crashes_added, 0, "re-post of same events dedupes");
  const hist = JSON.parse((await env.HEALTH.get("health:hist")));
  assert.equal(hist.length, 2);
  assert.equal(hist[0].cpu, 11);
  assert.equal(hist[0].last_stop.parent_pid, "37200");
  assert.equal(hist[0].sidecar_alive, true);
  assert.ok(!("last_wer" in hist[0]), "absent optional fields not invented");
  // unauthorized POST
  const un = await worker.fetch(new Request("https://dash.test/health", { method: "POST", body: "{}" }), env, { waitUntil: () => {} });
  assert.equal(un.status, 401);
}

// ---- POST /crashes dedupe across posts --------------------------------------
{
  const env = fakeEnv({ progress: {}, health: {}, crash: {} });
  const ev = [{ kind: "wer", ts: 1760001000000, title: "WER event 1001: RADAR_PRE_LEAK_64 (WindowsTerminal.exe)", id: "1001", proc: "WindowsTerminal.exe" }];
  const post = (b) => worker.fetch(new Request("https://dash.test/crashes", { method: "POST", body: JSON.stringify(b), headers: { Authorization: "Basic " + Buffer.from("test-token-123:").toString("base64") } }), env, { waitUntil: () => {} });
  const a = await (await post(ev)).json();
  const b = await (await post(ev)).json();
  assert.equal(a.added, 1);
  assert.equal(b.added, 0, "cross-post dedupe");
  const list = await (await worker.fetch(new Request("https://dash.test/crashes?token=test-token-123"), env, { waitUntil: () => {} })).json();
  assert.equal(list.events.length, 1);
  assert.equal(list.events[0].proc, "WindowsTerminal.exe");
}

// ---- feed round-trip (newest first) -----------------------------------------
{
  const env = fakeEnv({ progress: {}, health: {}, crash: {} });
  const post = (b) => worker.fetch(new Request("https://dash.test/feed", { method: "POST", body: JSON.stringify(b), headers: { Authorization: "Basic " + Buffer.from("test-token-123:").toString("base64") } }), env, { waitUntil: () => {} });
  await post({ agent: "alpha", ticket: "#1", status: "started", note: "one" });
  await new Promise((r) => setTimeout(r, 5));
  await post({ agent: "beta", ticket: "#2", status: "ok", note: "two" });
  const items = (await (await worker.fetch(new Request("https://dash.test/feed", { headers: { Authorization: "Basic " + Buffer.from("test-token-123:").toString("base64") } }), env, { waitUntil: () => {} })).json()).items;
  assert.equal(items.length, 2);
  assert.equal(items[0].agent, "beta", "newest first");
}

// ---- issues bucket logic (via KV cache path) ---------------------------------
{
  const env = fakeEnv({ progress: {}, health: {}, crash: {} });
  const now = Date.now();
  const cached = {
    boards: ["PRTLCTRL/finza-ops"], columns: [], fetched_at: new Date().toISOString(),
    issues: [
      { n: 1, t: "ready task", labels: ["ready-for-agent"], state: "open", bucket: "ready", url: "https://github.com/PRTLCTRL/finza-ops/issues/1", updated: "", closed: null },
      { n: 2, t: "blocked", labels: ["blocked"], state: "open", bucket: "blocked", url: "https://github.com/PRTLCTRL/finza-ops/issues/2", updated: "", closed: null },
      { n: 3, t: "done this week", labels: [], state: "closed", bucket: "done", url: "https://github.com/PRTLCTRL/finza-ops/issues/3", updated: "", closed: new Date(now - 86400000).toISOString() },
      { n: 4, t: "older done", labels: [], state: "closed", bucket: "done-old", url: "https://github.com/PRTLCTRL/finza-ops/issues/4", updated: "", closed: new Date(now - 30 * 86400000).toISOString() },
    ],
  };
  await env.PROGRESS.put("issues:cache:v1", JSON.stringify(cached));
  const d = await (await worker.fetch(new Request("https://dash.test/issues", { headers: { Authorization: "Basic " + Buffer.from("test-token-123:").toString("base64") } }), env, { waitUntil: () => {} })).json();
  assert.equal(d.source, "kv");
  assert.equal(d.issues.filter((i) => i.bucket === "done").length, 1);
  assert.equal(d.issues.filter((i) => i.bucket === "done-old").length, 1);
}

console.log("all worker unit tests passed");