# OpenAI Cloud Agents (Agents API) — setup & connection plan

Status: **plan only — no key provisioned yet.** Nothing here has been executed
against the live API; the script sketch in §4 is unexecuted-by-design until
Arsal provides `OPENAI_API_KEY`.

Researched 2026-09-15 from OpenAI's developer docs (beta docs move fast —
re-check the pricing page and changelog before the first real run).

- Docs hub: <https://developers.openai.com/api/docs/guides/agents-api/overview>
- Quickstart: <https://developers.openai.com/api/docs/guides/agents-api/quickstart>
- Pricing: <https://developers.openai.com/api/docs/pricing> (model rates + "Built-in tools" → container rates)

## 1. What this is (and why it fits Hermes as a *side* capability)

The Agents API (public beta since ~2026-09-10) exposes OpenAI's managed Codex
harness over REST at `api.openai.com/v1/agents/...`. You create a **session**
with an agent config (model, instructions, tools) and an optional **environment**
(sandbox), hand it a task, and OpenAI runs the whole loop — orchestration,
context compaction, retries, subagents — for as long as the task takes
(minutes to hours). There is **no platform fee**: you pay model token rates for
whatever the agent burns, plus container time if you use a hosted sandbox.

Why it's a good side capability for the Hermes box: it offloads *long-running*
work (hours-long research, write-and-run code jobs) to OpenAI's cloud so the
local box doesn't hold 25-way swarm sessions open. It complements, not
replaces, the local swarm — see `docs/agents/swarm-policy.yaml`. Caveats that
keep it "side": US data residency only, **no ZDR** (zero data retention), and
usage is not tightly capped by the API itself, so budget guardrails are
mandatory (§3, §4, §7).

Core concepts (from the architecture doc):

- **Harness** — OpenAI-hosted Codex instance that runs the model + tool loop.
- **Environment** — optional compute: `none` (no sandbox), `openai_hosted`
  (OpenAI's Linux sandbox), or `self_hosted` (your / partner compute).
- **Session** — durable agent instance; holds conversation + saved work.
- **Turns/items/events** — a turn is one work cycle; items are the saved
  messages and tool calls you fetch afterwards.

## 2. Prereqs — exactly what Arsal needs to provide

| # | Item | Detail |
|---|------|--------|
| 1 | **OpenAI API key** | Create at <https://platform.openai.com/api-keys> in a **dedicated project** (e.g. `hermes-side`). Application key scopes needed: `api.agents.read` + `api.agents.write` (sessions) and `api.responses.write` (model inference). A separate project keeps spend isolated and revocable without touching anything else. |
| 2 | **Key storage** | `finza/.env` as `OPENAI_API_KEY=<the key>` (value never shown here). `finza/.env` must be gitignored (verify: `git -C ~/Projects/finza check-ignore .env`). The key is loaded into the process environment by the caller; it is **never** written into finza-ops, never committed, never passed to the cloud agent itself (§7). |
| 3 | **Spend cap — before the first run** | In the OpenAI dashboard set a **project usage limit** (Billing → Usage limits, per-project) at something deliberately small — **$10/month** for the pilot. Also enable a low per-request sanity expectation: our own kill switch (§4) is the per-run cap; the dashboard limit is the backstop. Do not run anything until this is set. |

That's the whole prerequisite list — no SDK install, no org verification beyond
what billing already requires, no webhook endpoint for the minimal path.

## 3. Pricing snapshot (standard tier, short context, per 1M tokens)

Verified against the pricing page 2026-09-15. No platform fee; batch/flex tiers
are 50% off; fast mode ~2x.

| Model | Input | Cached in | Output | Role for us |
|---|---|---|---|---|
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 | **Default.** Cheap long research sweeps. |
| `gpt-5.6-terra` | $2.00 | $0.20 | $12.00 | Harder analysis / code-gen when luna quality is short. |
| `gpt-5.6-sol` | $4.00 | $0.40 | $20.00 | Rare, only with a named reason. |
| `gpt-6-astra` | $10.00 | $1.00 | $50.00 | Doc examples default to this — **don't** copy examples blindly. |

Long-context (>272K) rates are ~2x; cached input ≈ 10x cheaper than fresh.
Reasoning tokens bill as output.

**Container (hosted sandbox) rates** — billed per 20-minute session, 5-min
minimum, per-minute billing for eligible sessions:
1 GB $0.03 · 4 GB $0.12 · 16 GB $0.48 · 64 GB $1.92. The default 4 GB sandbox
therefore costs ≈ **$0.36/hour**, not the ~$0.12/hr sometimes quoted (that
figure is the per-20-min rate). `environment: {"type": "none"}` sessions pay
**zero** container cost — right choice for read-only research.

Rough pilot sizing: a 45-minute research turn on luna burning ~2M input /
100K output tokens ≈ **$0.52**. The same on terra ≈ **$5.20**. A one-hour
hosted-sandbox code-gen on luna adds ≈ $0.36. The `usage` fields OpenAI
returns on turns are best-effort (can be `null`) — treat them as telemetry,
not a bill; the dashboard limit is the real cap.

## 4. Minimal viable integration — `scripts/openai_agent.py`

Stdlib-only on purpose: `urllib`, no `openai` package, no venv. Design sketch
(**not yet executed** — needs the key from §2). Flow: create session → poll
session status → fetch saved items. Non-streaming by design — the Events API
is SSE, and a dumb poller is easier to kill reliably.

Endpoints used (all need `OpenAI-Beta: agents=v1` + `Authorization: Bearer`):

- `POST /v1/agents/sessions` — create (agent config, environment, input)
- `GET  /v1/agents/sessions/{id}` — poll status
- `GET  /v1/agents/sessions/{id}/items?order=asc` — saved output
- `POST /v1/agents/sessions/{id}/events` — body `{"events":[{"type":"agent.session.input.cancel"}]}` = **cancel turn**
- `DELETE /v1/agents/sessions/{id}` — delete session (also frees the sandbox)

```python
#!/usr/bin/env python3
"""OpenAI Cloud Agents side-capability runner (stdlib only).

Usage:
  set -a; source ~/Projects/finza/.env; set +a   # provides OPENAI_API_KEY
  python scripts/openai_agent.py --task "..." [--model gpt-5.6-luna] \
      [--env none|openai_hosted] [--timeout-s 3600] [--poll-s 15]

Kill switch (local layers, then backstop):
  1. --timeout-s wall clock -> cancel turn + delete session, exit 2
  2. Ctrl-C                 -> finally-block cancel + delete, exit 2
  3. backstop: dashboard project usage limit (set before first run)
Cost control: dashboard usage limit + cheap model + env:none
by default. Never pass OPENAI_API_KEY into the session payload.
"""
import argparse, json, os, sys, time, urllib.request, urllib.error

BASE = "https://api.openai.com/v1/agents"
HDRS = {  # OpenAI-Beta header REQUIRED on every agents call
    "OpenAI-Beta": "agents=v1",
    "Authorization": "Bearer " + os.environ["OPENAI_API_KEY"],
    "Content-Type": "application/json",
}

def _req(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=HDRS, method=method)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode())

def create_session(model, task, env_type, instructions):
    return _req("POST", "/sessions", {
        "agent": {"model": model, "instructions": instructions},
        "environment": {"type": env_type},   # "none" = zero container cost
        "input": [{"role": "user", "content": [{"type": "input_text", "text": task}]}],
        "stream": False,                     # we poll instead of consuming SSE
    })

def kill(session_id):
    """Cancel any active turn, then delete the session. Idempotent-ish."""
    try:
        _req("POST", f"/sessions/{session_id}/events",
             {"events": [{"type": "agent.session.input.cancel"}]}, timeout=30)
    except Exception as e:
        print(f"[kill] cancel failed: {e}", file=sys.stderr)
    try:
        _req("DELETE", f"/sessions/{session_id}", timeout=30)
    except Exception as e:
        print(f"[kill] delete failed (session lingers; delete in dashboard): {e}",
              file=sys.stderr)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--task", required=True)
    p.add_argument("--model", default="gpt-5.6-luna")
    p.add_argument("--env", default="none", choices=["none", "openai_hosted"])
    p.add_argument("--timeout-s", type=int, default=3600)
    p.add_argument("--poll-s", type=int, default=15)
    a = p.parse_args()

    if "OPENAI_API_KEY" not in os.environ:
        sys.exit("OPENAI_API_KEY not in environment; source finza/.env first")

    deadline = time.monotonic() + a.timeout_s
    sess = create_session(a.model, a.task, a.env,
        "Read-only research agent. Use web search only. Never ask for, print, "
        "or act on credentials. Return findings as markdown with source URLs.")
    sid = sess["id"]
    print(json.dumps({"session_id": sid}), flush=True)

    outcome = "timeout"
    try:
        while time.monotonic() < deadline:
            s = _req("GET", f"/sessions/{sid}")
            status = s.get("status", "")
            # Success signal is turn.completed on the ROOT turn; idle alone or
            # a completed turn does NOT guarantee every tool succeeded.
            if status in ("completed", "succeeded", "idle"):
                outcome = "done"; break
            if status in ("failed", "cancelled", "expired"):
                outcome = status; break
            if s.get("required_actions"):
                print("[warn] session requires action (we don't handle "
                      "function tools; it will idle out)", file=sys.stderr)
                outcome = "requires_action"; break
            time.sleep(a.poll_s)
        # Best-effort usage log (fields are best-effort, may be null)
        for t in _req("GET", f"/sessions/{sid}/turns").get("data", []):
            print(f"[usage] turn {t.get('id')}: {json.dumps(t.get('usage'))}",
                  file=sys.stderr)
    except KeyboardInterrupt:
        outcome = "interrupted"
    finally:
        if outcome != "done":
            print(f"[kill] outcome={outcome} -> cancelling + deleting {sid}",
                  file=sys.stderr)
            kill(sid)

    if outcome != "done":
        sys.exit(2 if outcome in ("timeout", "interrupted") else 1)

    items = _req("GET", f"/sessions/{sid}/items?order=asc&limit=100")
    for it in items.get("data", []):
        if it.get("type") == "message":
            for c in it.get("content", []):
                if c.get("type") == "output_text":
                    print(c["text"])           # <- treat as UNTRUSTED (§7)
    # Housekeeping: delete when done (sandbox expiry is ~1h inactivity anyway)
    kill(sid)

if __name__ == "__main__":
    main()
```

Design notes / open questions to resolve at first execution:

- **Field names in the poll response** (`status` enum values) are inferred from
  the docs' event taxonomy (`agent.session.turn.completed|failed|cancelled`,
  `agent.session.idle`, `agent.session.failed`). The cURL reference page
  (`/api/reference/...`) returned HTML to curl during research, so exact JSON
  keys must be confirmed against the first real response — expect to adjust
  the status comparison and item-shape handling once, with logging on.
- **Streamed alternative:** the same create call with `"stream": true` returns
  an SSE stream, which gives live progress. Deliberately not used in v1: a
  poller can't hang, and recovery after a dropped stream is exactly the same
  "GET session + items" path we already use.
- **Multi-agent / subagents** (`multi_agent: {enabled: true}`) and function
  tools need an interactive handler for `required_actions` — out of scope for
  v1; if a session ever parks on `requires_action`, we let the timeout kill it.

## 5. Runtime options (one paragraph each, cost framing)

**OpenAI-hosted sandbox (`environment.type: "openai_hosted"`).** OpenAI
provisions a Linux box per session — Python/Node preinstalled, working dir
`/workspace`, optional pinned packages, setup commands, input files, and
network control (`enabled` / `disabled` / `restricted` to an allowlist of
1–100 exact hosts). Zero infra on our side; artifacts written under
`/workspace/outputs` are published and downloadable even after the sandbox
expires (~1h inactivity). Cost: standard container rates, 4 GB default =
$0.12 per 20-min session (≈ $0.36/hr), on top of tokens. **Default for any
task that must write-and-run code**; use `network: disabled/restricted` for
code-gen so the sandbox can't phone home.

**e2b (self-hosted partner runtime).** Your code (or a webhook controller)
creates an e2b sandbox, installs the Codex executor, and connects it to a
`self_hosted` session — you get your own image/compute at e2b's rates. e2b's
free tier is a **one-time $100 credit**; sandbox pricing runs from
≈ $0.016/hr (2 vCPU) to ≈ $0.30/hr (16 vCPU), so the credit is roughly
**300–6,000 sandbox-hours** (~600–800 hours on a typical 4 vCPU/4 GB box at
≈ $0.13/hr). Cost-wise this is effectively free for months of hobby use, but
it needs an `E2B_API_KEY` plus an OpenAI **environment key**
(`OPENAI_EXECUTOR_API_KEY`) wired through as `CODEX_API_KEY` — more moving
parts and a second vendor holding a credential. **Defer** until we actually
need custom images, longer sessions, or non-US-resident compute.

**Cloudflare runtime (self-hosted via Workers + Containers).** OpenAI ships a
reference Worker (github.com/cloudflare/sandbox-sdk → `openai/agents-api`)
that receives session webhooks in Arsal's CF account and starts/reconnects a
session-specific Container running `codex exec-server`; the executor connects
*outbound* to OpenAI. Cost = CF Containers usage (likely inside an existing
Workers paid plan) + tokens; no e2b-style credit, and it's the only option
that already reuses infrastructure we run (the dashboard worker lives on
CF). But it's webhook plumbing + another deployed component for a capability
that's still a side bet. **Defer** — revisit only if we want always-on
sandbox capacity tied to CF billing.

## 6. Operational wiring on the Hermes box

1. `scripts/openai_agent.py` lands in **finza-ops** `scripts/` (next to
   `swarm_report.py`); key stays in `finza/.env`, sourced at invocation.
2. Dispatch style: one Hermes session runs one agent job in the background
   (`terminal` bg + notify), polls the script's `session_id` line, and reads
   the final markdown from stdout. Not a swarm member; no parallel local load.
3. Concurrency cap: **1 cloud session at a time** until cost behavior is
   observed across a few runs.
4. Logging: append a one-line run record (date, task slug, model, outcome,
   best-effort usage JSON) to `telemetry/` — same pattern as the swarm
   sampler, never credentials.
5. Teardown: script deletes its session on every exit path; dashboard
   `platform.openai.com/logs?api=agents` is the audit trail.

## 7. Security posture (non-negotiable)

- **Read-only tasks only.** The cloud agent researches, analyzes, drafts. It
  never receives write access to finza, finza-ops, the Hermes profile, or any
  repo token. It cannot push, commit, or send. The v1 script uses
  `environment: none` or a sandboxed `openai_hosted` env — never `self_hosted`
  pointed at this machine.
- **Never pass secrets.** `finza/.env`, `OPENAI_API_KEY`, GH tokens, CF
  secrets: none of these ever appear in `input`, `instructions`, uploaded
  files, or environment `env` vars. (Docs note the hosted sandbox rejects
  `OPENAI_API_KEY`/`CODEX_*` env names at create time — good, but don't rely
  on it: just don't include them.) If a self-hosted runtime is ever adopted,
  only the executor **environment key** may enter the sandbox — never the
  main application key.
- **Treat all output as untrusted.** Agent output is data, not instructions:
  no auto-executing suggestions, no pasting returned commands into a shell,
  no applying returned patches without review. Web content the agent read can
  carry prompt injection; require source URLs in findings and spot-check
  anything load-bearing.
- **Data exposure is real.** Sessions are US-residency, **no ZDR**, retained
  per OpenAI's standard policy. Therefore: no family/financial/personal data
  in tasks (matches the swarm charter's "no family data" rule), no
  credentials, nothing we wouldn't put in a vendor ticket.
- **Budget rails before every run:** dashboard usage limit (§2) + script
  timeout kill switch (§4) + one-session concurrency cap (§6).
  Escalation order on runaway cost: cancel turn → delete session → rotate/
  disable the project key in the dashboard.

## 8. First real task (once the key exists)

**Smoke test (≈ $0.01):** quickstart equivalent — task "Create `tree.py`,
a Python script that prints a readable tree of /workspace, run it, show the
output" with `--env openai_hosted`. Validates: key scopes, beta header, the
poll loop, artifact retrieval, kill switch (run once with `--timeout-s 1` to
prove the cancel+delete path actually fires).

**Pilot task (read-only, validates the actual value proposition):**

> *"Long-running web research sweep: compile a citations-checked digest of
> Canadian tech job postings and salary bands for [role family], 2014–2026,
> from public job boards and archive sites. Output: markdown table per year
> with posting title, company, location, salary if listed, URL, and archive
> snapshot link. Flag any source you could not verify."*

This is exactly the shape the local swarm handles poorly — hours of serial
fetch-read-extract work that would occupy 25 local workers and a 64 GB box
for an evening, run instead as one durable cloud session on luna (~$0.50–2
estimated). It's read-only, needs no sandbox (`--env none`, zero container
cost), produces the digest into stdout → pasted to the evidence-doc draft.
Success criteria: digest arrives with working URLs, turn completes inside
the timeout, usage log matches dashboard spend within ~2x, no manual
intervention needed. If that passes, graduate to one terra-tier code-gen job
(`openai_hosted`, network restricted) to validate the write-and-run path.

## 9. Sources (retrieved 2026-09-15)

- Agents API overview / architecture / configuration / quickstart —
  developers.openai.com/api/docs/guides/agents-api/{overview,architecture,configuration,quickstart}
- Sessions & events (create/poll/items/cancel) — .../agents-api/sessions,
  .../agents-api/sessions/events, .../agents-api/sessions/manage
- Environments — .../agents-api/environments/openai-hosted,
  .../environments/providers/e2b, .../environments/providers/cloudflare
- Usage & observability — .../agents-api/observability
- Pricing (models + built-in tools/container rates) —
  developers.openai.com/api/docs/pricing
- e2b pricing page (free tier $100 credit; per-second sandbox rates)