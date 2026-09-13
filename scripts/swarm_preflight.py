#!/usr/bin/env python3
"""Swarm preflight + telemetry harness (finza-ops #8).

Implements the preflight checklist from the issue #7 findings (COLLECTIVE-25:
~50% of workers had zero web tools because check_web_api_key() was False and
web.backend was left on empty auto-detect) as a reusable, READ-ONLY script.

This tool never mutates config.yaml, never spawns subagents, and never
dispatches swarms.

Usage:
    python swarm_preflight.py [--wave N] [--probe]

Exit code 0 = all checks pass, 1 = at least one check failed.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

HOME = Path.home()  # C:\Users\Arsal on this box
CONFIG_PATH = HOME / "AppData" / "Local" / "hermes" / "config.yaml"
HERMES_SRC = HOME / "AppData" / "Local" / "hermes" / "hermes-agent"
LOG_HINT = HOME / "AppData" / "Local" / "hermes" / "logs" / "agent.log"

DEFAULT_WAVE = 8

# Values that mean "not explicitly configured" (auto-detect / placeholder).
AUTO_VALUES = {"", "auto", "auto-detect", "none", "null", "~"}


# --------------------------------------------------------------------------- #
# Minimal YAML subset parser (stdlib only)                                    #
# --------------------------------------------------------------------------- #
def _parse_scalar(raw: str):
    """Parse a YAML scalar into a Python value (bool / int / str; '' if empty)."""
    s = raw.strip()
    if s in ("", "~", "null", "Null", "NULL"):
        return ""
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        return s[1:-1]
    if s in ("true", "True", "TRUE", "yes", "Yes"):
        return True
    if s in ("false", "False", "FALSE", "no", "No"):
        return False
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


def load_config_subset(path: Path) -> dict:
    """Extract only the `delegation:` and `web:` subtrees from config.yaml.

    Handles the plain 2-space-indented mapping style used by the generated
    config (scalars only; deeper nesting and lists are ignored, which is fine
    for the keys this harness reads).
    """
    subset: dict = {}
    root = None  # current top-level key we care about
    if not path.is_file():
        return subset
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        m = re.match(r"^([\w.-]+)\s*:(.*)$", line.strip())
        if not m:
            continue
        key, raw = m.group(1), m.group(2)
        if indent == 0:
            root = key if key in ("delegation", "web") else None
            if root:
                subset.setdefault(root, {})
            continue
        if root is None or indent != 2:
            continue  # deeper nesting / lists not needed here
        subset[root][key] = _parse_scalar(raw)
    return subset


# --------------------------------------------------------------------------- #
# Reporting                                                                    #
# --------------------------------------------------------------------------- #
class Report:
    """Collects check results, prints them, and computes the exit code."""

    def __init__(self) -> None:
        self.results: list[tuple[str, bool, str, str]] = []

    def add(self, name: str, passed: bool, detail: str, fix: str = "") -> None:
        self.results.append((name, passed, detail, fix))
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {name}: {detail}")
        if not passed and fix:
            print(f"        fix: {fix}")

    @property
    def all_passed(self) -> bool:
        return all(passed for _, passed, _, _ in self.results)

    @property
    def failed(self) -> list[str]:
        return [name for name, passed, _, _ in self.results if not passed]


def info(msg: str) -> None:
    print(f"[INFO] {msg}")


# --------------------------------------------------------------------------- #
# Checks                                                                       #
# --------------------------------------------------------------------------- #
def check_delegation_caps(report: Report, cfg: dict, wave: int) -> None:
    """Check (a): delegation caps must cover the requested wave size."""
    delegation = cfg.get("delegation") or {}
    conc = delegation.get("max_concurrent_children", "")
    asy = delegation.get("max_async_children", "")
    detail = (
        f"wave={wave} vs max_concurrent_children={conc}, max_async_children={asy}"
    )
    passed = True
    fix = ""
    try:
        conc_i, asy_i = int(conc), int(asy)
        if conc_i < wave or asy_i < wave:
            passed = False
            short = []
            if conc_i < wave:
                short.append(f"max_concurrent_children ({conc_i} < {wave})")
            if asy_i < wave:
                short.append(f"max_async_children ({asy_i} < {wave})")
            fix = (
                "raise delegation caps in "
                f"{CONFIG_PATH} to >= {wave} for both "
                f"max_concurrent_children and max_async_children "
                f"(short: {'; '.join(short)}); #7 recommended 8/8 for 25-worker runs"
            )
    except (TypeError, ValueError):
        passed = False
        fix = (
            f"set integer values for delegation.max_concurrent_children and "
            f"delegation.max_async_children in {CONFIG_PATH}"
        )
    report.add("delegation caps >= wave", passed, detail, fix)


def check_web_gate(report: Report) -> None:
    """Check (b): probe the actual web gate via hermes-agent's own function."""
    probe_code = (
        "import sys; "
        f"sys.path.insert(0, r'{HERMES_SRC}'); "
        "from tools.web_tools import check_web_api_key; "
        "print(check_web_api_key())"
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", probe_code],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        report.add(
            "web gate check_web_api_key()",
            False,
            f"probe failed to run: {exc}",
            f"verify hermes-agent source exists at {HERMES_SRC} and that "
            f"python is on PATH",
        )
        return

    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if proc.returncode != 0:
        report.add(
            "web gate check_web_api_key()",
            False,
            f"probe exited {proc.returncode}: {err.splitlines()[-1] if err else out!r}",
            "verify hermes-agent source tree is intact at "
            f"{HERMES_SRC} (tools/web_tools.py present)",
        )
        return

    passed = out == "True"
    detail = f"check_web_api_key() -> {out or '(no output)'}"
    fix = "" if passed else (
        "set web.backend explicitly in config.yaml (e.g.\n"
        "        web:\n"
        "          backend: ddgs\n"
        "        ) and/or configure a search API key (e.g. TAVILY_API_KEY) "
        "in the environment; an empty backend auto-detect fails and drops both "
        "web tools from 'web'-toolset workers (issue #7 root cause #1)"
    )
    report.add("web gate check_web_api_key()", passed, detail, fix)


def check_web_backend_explicit(report: Report, cfg: dict) -> None:
    """Check (c): web.backend must be explicitly set, not empty/auto-detect."""
    backend = (cfg.get("web") or {}).get("backend", None)
    present = backend is not None
    value = str(backend)
    passed = present and value.strip().lower() not in AUTO_VALUES
    detail = (
        f"web.backend = {value!r} (explicitly set)"
        if passed
        else f"web.backend = {value!r} (empty/auto-detect placeholder)"
    )
    fix = "" if passed else (
        "edit config.yaml: set web.backend to an explicit backend, e.g.\n"
        "        web:\n"
        "          backend: ddgs   # or another backend supported by your install\n"
        "        (issue #7 recommended `web.backend: ddgs` on this box)"
    )
    report.add("web.backend explicitly set", passed, detail, fix)


def report_delegation_info(cfg: dict) -> None:
    """Check (d): informational dump of spawn depth + orchestrator state."""
    delegation = cfg.get("delegation") or {}
    depth = delegation.get("max_spawn_depth", "(unset)")
    orch = delegation.get("orchestrator_enabled", "(unset)")
    info(f"delegation.max_spawn_depth = {depth}")
    info(f"delegation.orchestrator_enabled = {orch}")
    info("informational only - no action required for this check")


def print_probe_banner(wave: int) -> None:
    """--probe: print instructions for a tiny 2-worker live probe (not run here)."""
    print()
    print("=" * 72)
    print("LIVE PROBE INSTRUCTIONS (--probe does NOT dispatch anything itself)")
    print("=" * 72)
    print("Dispatch a tiny 2-worker delegation probe manually (e.g. via the")
    print("delegation tool from a Hermes session, or ask the orchestrator):")
    print()
    print('  goal:      "call web_search for \'test query\' and return one real URL"')
    print("  workers:   2")
    print('  toolsets:  ["web"]')
    print()
    print("Then verify the workers ACTUALLY executed the tool (not just claimed")
    print("to) by grepping the agent log for real tool completions:")
    print()
    print(f'  grep -c "tool web_search completed" "{LOG_HINT}"')
    print()
    print("A count > 0 (and increasing after the probe) means real executions;")
    print("zero means workers still have no web tools - fix the FAIL items above")
    print("first. Full background: issue #7 findings + COLLECTIVE-25 postmortem.")
    print("=" * 72)


# --------------------------------------------------------------------------- #
# Main                                                                         #
# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Read-only swarm preflight + telemetry harness (finza-ops #8)."
    )
    parser.add_argument(
        "--wave",
        type=int,
        default=DEFAULT_WAVE,
        help=f"planned worker wave size to check caps against (default {DEFAULT_WAVE})",
    )
    parser.add_argument(
        "--probe",
        action="store_true",
        help="print instructions for a tiny 2-worker web delegation probe",
    )
    args = parser.parse_args(argv)

    print("Swarm preflight harness (finza-ops #8) - READ-ONLY preflight tool")
    print(f"config: {CONFIG_PATH}")
    print()

    if not CONFIG_PATH.is_file():
        print(f"[FAIL] config: config.yaml not found at {CONFIG_PATH}")
        return 1

    cfg = load_config_subset(CONFIG_PATH)

    report = Report()
    check_delegation_caps(report, cfg, args.wave)
    check_web_gate(report)
    check_web_backend_explicit(report, cfg)
    report_delegation_info(cfg)

    print()
    if report.all_passed:
        print(f"RESULT: PASS - all {len(report.results)} checks passed "
              f"(wave={args.wave}). Safe to dispatch.")
        return 0
    print(f"RESULT: FAIL - {len(report.failed)}/{len(report.results)} checks failed: "
          f"{', '.join(report.failed)}")
    print("Fix the items above before dispatching workers with the 'web' toolset.")
    if args.probe:
        print_probe_banner(args.wave)
    return 1


if __name__ == "__main__":
    sys.exit(main())