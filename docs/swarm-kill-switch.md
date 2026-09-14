# Swarm kill-switch runbook (finza-ops #5)

How to halt a running swarm mid-run — by Arsal or the orchestrator. Read once
before any dispatch of 4+ workers. Policy source: `docs/agents/swarm-policy.yaml`
(kill criteria + charter).

## 1. When to kill (kill criteria, from swarm-policy.yaml)

Kill the whole run if ANY of these fire:

| Criterion | Threshold | How to observe |
|---|---|---|
| RAM | system RAM used ≥ **55 GB** (64 GB box) | `scripts\swarm_sampler.ps1` live output, or Task Manager |
| Rate-limit storm | repeated 429/quota errors across ≥ half the workers | orchestrator results / agent.log |
| Scope breach | any worker touches money, credentials, family data, or tries ad publishing | worker report or log evidence → **halt all**, no partial waves |
| Arsal says stop | any iMessage/chat "stop the swarm" | always honored, no questions |

Hard rules that survive any panic: never `taskkill msedge.exe` unattended,
never kill the iMessage gateway to "make room".

## 2. How to kill — ordered, least destructive first

### Step 1 — graceful (orchestrator)
From the orchestrator Hermes session: `/stop`. This cancels every running
background subagent for that session. This is the primary switch; it is
instant and loses nothing that matters (workers are read-only researchers).

### Step 2 — if the session is unresponsive (hard kill, targeted)
Workers run as `python.exe`/`pythonw.exe` children **and so does the gateway —
never kill by image name.** Kill by PID, matched by command line:

```powershell
# List python processes with command lines (read-only)
Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" |
  Select ProcessId, CreationDate, @{n='Cmd';e={$_.CommandLine.Substring(0,[Math]::Min(120,$_.CommandLine.Length))}} |
  Sort CreationDate

# Kill ONLY the PIDs created after the dispatch started (worker wave window)
Stop-Process -Id <PID1>,<PID2> -Force
```

Identify workers by `CreationDate` (after dispatch time) and command line
(worker sessions carry the subagent/session args; the gateway's command line
references the gateway service, leave it alone). When in doubt: kill nothing,
ask Arsal.

### Step 3 — browser-heavy runs (profile: browser, ≤6 workers, approval-gated)
Browser workers hold ~0.5–1.5 GB each. Killing their parent python PID frees
the handle; only close msedge windows that Arsal confirms are worker-spawned,
and **never** the unattended kill of msedge.exe.

## 3. Config restore (post-kill or post-run)

Dispatch caps live in `C:\Users\Arsal\AppData\Local\hermes\config.yaml`:

```yaml
delegation:
  max_concurrent_children: 3
  max_async_children: 3
```

COLLECTIVE-25 precedent: caps were raised for the 25-worker test and **restored
to 3/3 after**. Any run that raises them must restore them the same session —
caps bind at session start, so a stray high cap silently changes the next
session's behavior. Verify the restore with `scripts\swarm_preflight.py --wave 3`
(should PASS on caps).

## 4. Post-kill checklist

1. `Get-Content $env:LOCALAPPDATA\hermes\gateway_state.json` — gateway alive (pid present, photon connected).
2. If the sampler was running with `-MaxSeconds 0`: stop it (Ctrl+C its console, or `Stop-Process -Name powershell` only for the sampler's own PID).
3. Generate the hardware report: `python scripts\swarm_report.py --latest telemetry\` → paste into the ticket/map.
4. Note the kill trigger (RAM / rate-limit / scope / human) in the run ticket — it tunes the next run's wave size.

## 5. Reusable command block (dispatch day)

```powershell
# T-0: baseline + live telemetry (window 3)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\swarm_sampler.ps1 -Label run1 -IntervalSec 5
# T-0: preflight (must PASS before dispatching web workers)
python scripts\swarm_preflight.py --wave <N>
# T+kill: report
python scripts\swarm_report.py --latest telemetry\
```