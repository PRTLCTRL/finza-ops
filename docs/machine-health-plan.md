# Machine Health Monitoring + Background Process Management Plan

**Ticket:** finza-ops #11 · **Status:** design-only (no implementation yet) · **Date:** 2026-09-13
**Machine:** Arsal's PC — i9-13900K, 64 GB RAM, RTX 4090 (24 GB), Windows 10. Gaming box first, agent box second.

---

## 1. What actually exists today (verified inventory)

### Process supervision

| Component | Mechanism | Details |
|---|---|---|
| Hermes gateway | **Startup-folder .cmd** (`Hermes_Gateway.cmd` → `pythonw -m hermes_cli.main gateway run`) | Starts at login. Writes `~/AppData/Local/hermes/gateway_state.json` (pid, state, photon platform status). Runs 24/7 via iMessage (Photon). |
| Hermes watchdog | **Scheduled task `HermesGatewayWatchdog`** | Every 5 min (`PT5M`), hidden PowerShell, checks `gateway_state.json` → restarts via the .cmd if pid dead. `ExecutionTimeLimit=PT2M` (hang capped at 2 min), `MultipleInstances=IgnoreNew`. Log: `gateway-service/watchdog.log` (self-truncating at 400 KB). |
| Other scheduled tasks | Adobe CCX/Acrobat, NVIDIA App, OneDrive (2), UnpackCheck | Vendor noise, not ours. |
| Cron jobs (Hermes-native, in `cron/jobs.json`) | 5 enabled jobs | 09:00 "AM NYC news to iMessage" + "AI Insider Watch" · 09:15 "lota-ads-analytics" · 10:30 "backlog-worker" · 17:00 "backlog-daily-digest" |
| Debug Edge | `C:\Users\Arsal\EdgeDebugProfile`, port 9222 | Runs side-by-side with Arsal's normal Edge. **Never taskkill msedge unattended** — we cannot distinguish our debug instance from his by name alone. |
| Monitoring daemon | **Does not exist.** | Health checks are ad hoc, only when something breaks. |

**Known weakness (Sep 11–13 incidents):** the old wscript wrapper layer caused desktop-heap exhaustion from rapid launch churn; a hung watchdog could linger unbounded (now capped at 2 min). The design is still per-task process churn — each cron run and watchdog pass spawns fresh processes. There is no continuous sampler, no threshold alerts, no machine-health digest line.

### What already encodes gaming-coexistence rules

- `docs/agents/swarm-policy.yaml` has `kill_criteria: ram_gb: 55` and a safety charter (orchestrator holds kill switch; workers read-only by default).
- Gaming-coexistence conventions (never taskkill msedge unattended, long jobs backgrounded, heavy renders low-priority, no focus stealing) are convention-only today — not written down in this repo and not enforced by any script. **This doc is where they get pinned.**

---

## 2. Proposed thresholds (what to track, what to do when hit)

All thresholds assume the constraint hierarchy: **Arsal's gaming session > iMessage gateway 24/7 > cron/reporting > background renders.** The agent never escalates priority; it only sheds its own.

### 2.1 Metrics and thresholds

| Metric | How to read it | Green | Amber (defer/shed) | Red (agent self-throttles) |
|---|---|---|---|---|
| Free physical RAM | `Get-CimInstance Win32_OperatingSystem` → `FreePhysicalMemory` | > 16 GB | 8–16 GB | < 8 GB |
| Commit charge | `Get-Counter '\Memory\Committed Bytes'` vs limit | < 70% | 70–85% | > 85% (this is what actually caused the wscript-era failures, not raw RAM) |
| CPU peak (1 min) | `Get-Counter '\Processor(_Total)\% Processor Time'` | < 60% | 60–85% | > 85% sustained 5 min |
| GPU VRAM used | `nvidia-smi --query-gpu=memory.used,utilization.gpu` | < 8 GB | 8–16 GB | > 16 GB or util > 70% (≈ a game is running) |
| Disk C: free | `Get-PSDrive C` | > 100 GB | 50–100 GB | < 50 GB |
| Desktop heap / handles | Per-process handle counts via `Get-Process` | stable | growing trend in pythonw/wscript | spawn-churn signature (> 100 pythonw starts/hr) |
| Pagefile activity | `'\Paging File(_Total)\% Usage'` | < 50% | 50–80% | > 80% |

The 64 GB box rarely runs out of *RAM* — the real failure mode observed was **commit charge + desktop heap under launch churn**. That's why commit has a stricter relative threshold than free RAM.

### 2.2 Response ladder (when a threshold is hit)

**Hard rule: the agent NEVER kills processes it didn't start. No `taskkill` of msedge, chrome, games, Discord, Steam, or any user application — ever, unattended.** The only processes the agent may stop are ones it launched and tracked in its own PID ledger.

| Level | Trigger | Automated response |
|---|---|---|
| L0 — observe | All green | Normal operation; sample on the health cadence (§4). |
| L1 — defer | Any Amber | Defer non-urgent cron jobs (backlog-worker, analytics) to the next green window. Digests/briefs still send (they're light). Log the deferral. |
| L2 — shed | Any Red **or** GPU busy (game detected) | Pause swarm dispatches (respecting the existing `swarm-policy.yaml` kill criteria). Heavy jobs (renders, browser-heavy workers) go to low priority (`Start-Process -Priority BelowNormal` / `.BatchPriority`). Notify Arsal via iMessage **once** per incident, not per sample. |
| L3 — protect | Commit > 90% or spawn-churn signature | Agent stops launching *anything* new (including its own helper processes). Gateway stays untouched — it's the lifeline. If the gateway itself is wedged, the existing watchdog handles it (2-min cap). |

**Game detection** is the cheapest signal we have: `nvidia-smi` GPU utilization + VRAM > 16 GB, or a known game process visible in `Win32_Process`. When a game is running, all L1/L2 responses apply regardless of other thresholds.

---

## 3. Daily machine-health report (5 lines, into the 17:00 digest)

Format is fixed so the digest stays scannable and so Arsal never has to read more than 5 lines. Proposed addition to the existing 17:00 "backlog-daily-digest" job's output:

```
MACHINE 2026-09-13
RAM free 41.3/64 GB (peak used 28 GB) · CPU peak 62% at 15:40
Disk C: 537 GB free (of ~1.4 TB)
Automation tabs: OK (debug Edge 1 wedged tab detected 09:20, reloaded)
Gaming-hours: OK — no heavy agent jobs 19:00–01:00
```

Line rules:
1. **Header** — date.
2. **RAM + CPU** — free RAM now, peak used over 24 h, CPU peak + when.
3. **Disk** — C: free.
4. **Automation tabs** — status of agent-owned browser tabs (debug Edge on 9222); any wedged/redirect-loop tabs found and what was done (reload only if agent-owned; never kill the whole browser).
5. **Gaming-hours compliance** — OK, or a one-line list of jobs that ran during 19:00–01:00 (the protected window) with justification.

Any line can say `BREACH: <detail>` when a threshold was crossed — that's the only time it gets longer than one line.

---

## 4. Long jobs yielding to games

### 4.1 Time-boxed windows

| Window | Class | What runs |
|---|---|---|
| **02:00–06:00** | Heavy renders, video exports, bulk sweeps, full swarm (25-worker `deep` profile) | These are the *only* jobs allowed to consume > 4 cores or > 4 GB sustained. |
| 09:00–11:00 | Cron block (existing schedule: 9:00, 9:15, 10:30) | Light reporting jobs — unchanged. |
| **19:00–01:00** | **Protected: gaming hours.** | No new heavy jobs. Light jobs (digests, one-shot questions) still run but at `BelowNormal` priority. Emergency-only anything. |
| Any time | Everything else | Normal, but subject to the L1/L2 ladder above. |

Renders that miss the 02:00–06:00 window queue for the *next* window rather than squeezing in — a render finishing 6 hours late beats a game stuttering.

### 4.2 Mechanics (all reversible, all available on Windows 10 today)

1. **Priority, not killing.** Long jobs launch via `Start-Process -Priority BelowNormal` (or `IDLE` for renders). Windows then does the yielding natively when a game wants CPU. Background priority can starve on busy CPU, so `BelowNormal` is the default; `IDLE` only for the 02:00–06:00 window.
2. **GPU courtesy.** nvidia-smi is checked before launching anything GPU-touching. If VRAM > 16 GB or util > 70%, GPU jobs defer. Renders use NVENC only inside the 02:00–06:00 window.
3. **Background, never foreground.** Every agent-launched job runs detached/hidden (existing pattern: `pythonw`, `-WindowStyle Hidden`, scheduled task). **No focus stealing, ever** — no job may pop a window, take focus, or bring anything to the foreground. Violations of this are what made the old wscript layer intolerable during gameplay.
4. **Time-boxing.** Any job that hasn't finished in its window gets its own 2-min warning, then checkpoint-and-defer. No unbounded jobs (lesson from the hung-watchdog incident).
5. **One iMessage per incident.** During protected hours the agent may notify Arsal at most once per incident, and only if a decision is genuinely needed. Silence otherwise.

---

## 5. Architecture options for the supervision layer (per the issue's question 1)

Design-only comparison; implementation tickets get cut from this.

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Status quo** (startup .cmd + 5-min watchdog task) | Works; zero new dependencies; already survived the wscript fix | Process churn on every watchdog miss; no health sampling; no deferral logic | Keep as baseline |
| **B. NSSM service** for gateway | Native service, auto-restart at kernel level, no churn, survives logoff | New third-party dependency; service runs as SYSTEM or a service account — breaks iMessage/Photon's user-session context unless carefully configured; harder to reverse cleanly | **Recommended (phase 2)** — biggest win: zero spawn churn |
| **C. Task Scheduler "services mode"** | No new software | Windows has no true service mode in Task Scheduler; it still spawns fresh processes per trigger | Rejected — doesn't solve churn |
| **D. Agent-run monitor loop** (Hermes session polling every 5 min) | No new infra | The monitor itself becomes a process to supervise (dogfooding problem) | Rejected for now |

**Recommended rollout, reversible steps:**

1. **Phase 1 (no new software):** scheduled task every 15 min running a single PowerShell health sampler → appends one JSON line to `logs/machine-health.jsonl`; implements the L1/L2 deferral ladder and the 5-line digest feed. Gateway/watchdog untouched.
2. **Phase 2 (needs Arsal's OK):** convert gateway + watchdog to an NSSM Windows service. Rollback = delete service, restore startup .cmd. Reversible in < 5 min.
3. **Phase 3:** wire `machine-health.jsonl` into `swarm-policy.yaml` preflight (replace the ad-hoc sampler CSV) and add the 5-line report to the 17:00 digest job.

### What Arsal must approve before implementation

- Phase 2 NSSM conversion (touches the 24/7 gateway — the lifeline).
- The 19:00–01:00 protected window and 02:00–06:00 render window (his actual gaming hours — confirm these match reality).
- Any change to the cron schedule (deferral is automatic; rescheduling is not).
- NSSM download/install (new software on his box).

### Explicit non-goals

- Killing or restarting anything Arsal runs (games, Edge, Discord, Steam).
- Admin-account changes or new user accounts.
- Any focus-stealing UI from agent jobs.
- Autonomous action during gaming beyond deferral + a single iMessage.