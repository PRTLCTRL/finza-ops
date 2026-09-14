# Swarm runbook — repeatable dispatch procedure (finza-ops #5)

Use this for ANY swarm dispatch of ≥4 workers (below that, do the work inline —
swarm overhead loses). Policy: `docs/agents/swarm-policy.yaml`. Kill switch:
`docs/swarm-kill-switch.md`. Provenance: COLLECTIVE-25 (2026-09-10) + #7/#8
findings.

## Timeline

### T-once — config edits (needs Arsal, one time)
Two edits in `C:\Users\Arsal\AppData\Local\hermes\config.yaml` put this box in
permanent GO state (preflight currently FAILs on exactly these):

```yaml
web:
  backend: ddgs          # was '' (auto-detect) — root cause of the #7 tool lottery
delegation:
  max_concurrent_children: 8   # was 3 — covers sweep (8) profiles
  max_async_children: 8
```

Optional: export `TAVILY_API_KEY` (or equivalent) so `check_web_api_key()` →
True. For deep (25-worker) runs raise caps to 8+ and dispatch in waves of 3
(session caps bind at session start — set BEFORE starting the session).

### T-15min — fresh orchestrator session
Start the Hermes session AFTER any config edits (caps bind at session start).
Verify live from the session: delegation tool reports
`max_concurrent_children`/`max_async_children` matching plan.

### T-10min — preflight gate (hard gate: no PASS, no dispatch)
```
python scripts\swarm_preflight.py --wave <N>
```
All checks must PASS (exit 0). On FAIL, apply the printed `fix:` hints and
re-run. Current known failures on this box (as of 2026-09-14): web gate +
web.backend placeholder (at any wave), plus caps 3/3 vs wave 8 (caps PASS at
wave 3) — fix via the T-once block above.

### T-5min — 2-worker live probe
Dispatch a 2-worker delegation, toolsets `["web"]`, goal: "call web_search for
'test query' and return one real URL". Then verify REAL executions:
```
grep -c "tool web_search completed" "%LOCALAPPDATA%\hermes\logs\agent.log"
```
Count must be > 0 (and higher than before the probe). Zero = tools still not
wired — stop, do not dispatch the wave.

### T-2min — telemetry on
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\swarm_sampler.ps1 -Label <runname> -IntervalSec 5
```
Runs until stopped (or use `-MaxSeconds <N>` for bounded runs).

### T-0 — dispatch (with charter)
Paste the standing charter (verbatim from `docs/agents/swarm-policy.yaml`) into
the orchestrator context of every dispatch:

> READ-ONLY researchers by default; no terminal/file/messaging/scheduling.
> Orchestrator holds dispatch/monitor/stop. Kill switch on request or criteria.
> REFUSE over FABRICATE: report capability gaps, never invent sources. No money
> movement, no credentials, no family-data contact. Escalate: anything beyond
> scope → report to orchestrator, stop.

Profiles (from policy): **sweep** 8×web/cloud-cheap · **deep** 25×web in waves
of 3 · **browser** ≤6, explicit Arsal approval required. Wave size must be ≤
the caps verified at T-10.

### During — monitor
- Watch kill criteria (RAM ≥ 55 GB · rate-limit storm · scope breach → see
  `docs/swarm-kill-switch.md`).
- Verify per-wave: workers return real sources; any worker reporting "no tools"
  = halt that wave (tool lottery regression).

### T+end — report + restore
```
python scripts\swarm_report.py --latest telemetry\
```
1. Paste the markdown block into the run ticket + map decision line.
2. Restore any raised caps to 3/3 (COLLECTIVE-25 precedent) — same session.
3. Re-run `python scripts\swarm_preflight.py --wave 3` to confirm box is back
   to baseline.
4. Stop the sampler (Ctrl+C) if still running.

## What "playbook complete" means
- [x] Preflight script exists + verified (#8)
- [x] Sampler + report generator exist + smoke-verified (#5)
- [x] Kill-switch runbook (#5)
- [x] This runbook: T-once → T-0 → post-run loop (#5)
- [ ] One real ≥4-worker run executed end-to-end using ONLY this runbook
      (blocked on T-once config edits — Arsal's go)