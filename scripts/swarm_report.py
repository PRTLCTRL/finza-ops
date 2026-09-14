#!/usr/bin/env python3
"""Swarm telemetry markdown report generator (finza-ops #5).

Reads one or more telemetry CSVs written by scripts/swarm_sampler.ps1 (schema:
timestamp,cpu_pct,ram_used_gb - identical to COLLECTIVE-25) and prints a
compact markdown report block: duration, sample count, CPU avg/peak, RAM
min/avg/max/peak-delta (peak minus first-sample baseline), plus a 10-minute
per-window breakdown when the run is longer than 10 minutes.

Stdlib only. Companion to scripts/swarm_preflight.py (finza-ops #8).

Usage:
    python swarm_report.py telemetry-swarm-20260914-101500.csv
    python swarm_report.py chunk1.csv chunk2.csv        # combined report
    python swarm_report.py --latest C:\\Users\\Arsal\\Projects\\finza-ops\\telemetry

Exit code 0 on success; 1 on missing files, unreadable CSVs, or no valid
samples (with a clear [FAIL] message on stderr).
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import datetime, timedelta
from pathlib import Path

TIMESTAMP_FMT = "%Y-%m-%d %H:%M:%S"
WINDOW_MINUTES = 10        # per-window breakdown granularity
LONG_RUN_MINUTES = 10      # only emit windows when run duration exceeds this
MAX_WINDOWS_SHOWN = 10     # cap table size on very long runs (head + tail)


# --------------------------------------------------------------------------- #
# Input resolution + loading                                                   #
# --------------------------------------------------------------------------- #
def resolve_paths(args: argparse.Namespace) -> list[Path]:
    """Resolve input CSV paths from positional args and/or --latest <dir>."""
    paths = [Path(p) for p in args.csv]
    if args.latest:
        latest_dir = Path(args.latest)
        if not latest_dir.is_dir():
            raise FileNotFoundError(f"--latest directory not found: {latest_dir}")
        candidates = sorted(
            latest_dir.glob("telemetry-*.csv"), key=lambda p: p.stat().st_mtime
        )
        if not candidates:
            raise FileNotFoundError(f"no telemetry-*.csv files in {latest_dir}")
        paths.append(candidates[-1])
    if not paths:
        raise FileNotFoundError("no input given: pass CSV paths or --latest <dir>")
    return paths


def _to_float(raw: str) -> float | None:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def load_samples(path: Path) -> tuple[list[tuple[datetime, float | None, float | None]], int]:
    """Load (timestamp, cpu, ram) rows; returns (rows, malformed_count)."""
    rows: list[tuple[datetime, float | None, float | None]] = []
    skipped = 0
    with path.open(newline="", encoding="utf-8", errors="replace") as fh:
        for rec in csv.reader(fh):
            if not rec or rec[0].strip().lower() == "timestamp":
                continue  # header / blank line
            if len(rec) < 3:
                skipped += 1
                continue
            try:
                ts = datetime.strptime(rec[0].strip(), TIMESTAMP_FMT)
            except ValueError:
                skipped += 1
                continue
            rows.append((ts, _to_float(rec[1]), _to_float(rec[2])))
    return rows, skipped


# --------------------------------------------------------------------------- #
# Formatting helpers                                                           #
# --------------------------------------------------------------------------- #
def fmt_duration(td: timedelta) -> str:
    total = int(td.total_seconds())
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m {s:02d}s"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def fmt_cpu(v: float | None) -> str:
    return "n/a" if v is None else f"{v:.1f}%"


def fmt_ram(v: float | None) -> str:
    return "n/a" if v is None else f"{v:.2f} GB"


def window_start(ts: datetime) -> datetime:
    return ts.replace(
        minute=(ts.minute // WINDOW_MINUTES) * WINDOW_MINUTES, second=0, microsecond=0
    )


def avg_peak(values: list[float]) -> tuple[float | None, float | None]:
    if not values:
        return None, None
    return sum(values) / len(values), max(values)


def window_rows(rows: list[tuple[datetime, float | None, float | None]]) -> list[str]:
    """Render 10-minute window table rows for a sorted row list."""
    buckets: dict[datetime, list[tuple[datetime, float | None, float | None]]] = {}
    for row in rows:
        buckets.setdefault(window_start(row[0]), []).append(row)

    lines = []
    for start in sorted(buckets):
        chunk = buckets[start]
        cpus = [c for _, c, _ in chunk if c is not None]
        rams = [r for _, _, r in chunk if r is not None]
        c_avg = f"{sum(cpus) / len(cpus):.1f}%" if cpus else "n/a"
        c_peak = f"{max(cpus):.1f}%" if cpus else "n/a"
        r_avg = f"{sum(rams) / len(rams):.2f} GB" if rams else "n/a"
        r_max = f"{max(rams):.2f} GB" if rams else "n/a"
        end = start + timedelta(minutes=WINDOW_MINUTES)
        lines.append(
            f"| {start:%H:%M}-{end:%H:%M} | {len(chunk)} | {c_avg} | {c_peak} | {r_avg} | {r_max} |"
        )

    if len(lines) > MAX_WINDOWS_SHOWN:
        head, tail = MAX_WINDOWS_SHOWN // 2, MAX_WINDOWS_SHOWN // 2
        hidden = len(lines) - head - tail
        lines = (
            lines[:head]
            + [f"| ... ({hidden} more windows) | | | | | |"]
            + lines[-tail:]
            + [f"_(showing first/last {head} of {len(buckets)} windows)_"]
        )
    return lines


# --------------------------------------------------------------------------- #
# Report                                                                       #
# --------------------------------------------------------------------------- #
def build_report(paths: list[Path]) -> str:
    all_rows: list[tuple[datetime, float | None, float | None]] = []
    skipped_total = 0
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f"CSV not found: {path}")
        rows, skipped = load_samples(path)
        all_rows.extend(rows)
        skipped_total += skipped

    if not all_rows:
        raise ValueError(
            f"no valid samples in {', '.join(str(p) for p in paths)} "
            f"({skipped_total} malformed row(s) skipped)"
        )

    all_rows.sort(key=lambda r: r[0])
    first_ts, last_ts = all_rows[0][0], all_rows[-1][0]
    duration = last_ts - first_ts

    cpus = [c for _, c, _ in all_rows if c is not None]
    rams = [r for _, _, r in all_rows if r is not None]
    cpu_avg, cpu_peak = avg_peak(cpus)

    ram_line = (
        f"- ram: min {fmt_ram(min(rams))}, avg {fmt_ram(sum(rams) / len(rams))}, "
        f"max {fmt_ram(max(rams))}"
    )
    if rams:
        baseline = next(r for _, _, r in all_rows if r is not None)
        delta = max(rams) - baseline
        ram_line += (
            f"\n- ram peak-delta: {delta:+.2f} GB (peak minus first-sample "
            f"baseline {fmt_ram(baseline)})"
        )

    lines = [
        "## Swarm telemetry report",
        "",
        f"- files: {', '.join(str(p) for p in paths)}",
        f"- samples: {len(all_rows)}"
        + (f" ({skipped_total} malformed row(s) skipped)" if skipped_total else ""),
        f"- duration: {fmt_duration(duration)} ({first_ts:%Y-%m-%d %H:%M:%S} -> {last_ts:%H:%M:%S})",
        f"- cpu: avg {fmt_cpu(cpu_avg)}, peak {fmt_cpu(cpu_peak)} (n={len(cpus)})",
        ram_line,
    ]

    if duration > timedelta(minutes=LONG_RUN_MINUTES):
        lines += ["", f"### {WINDOW_MINUTES}-minute windows", ""]
        lines += [
            "| window | samples | cpu avg | cpu peak | ram avg | ram max |",
            "|---|---|---|---|---|---|",
        ]
        lines += window_rows(all_rows)

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Markdown telemetry report from swarm_sampler.ps1 CSVs (finza-ops #5)."
    )
    parser.add_argument(
        "csv",
        nargs="*",
        help="one or more telemetry CSV files (combined into one report)",
    )
    parser.add_argument(
        "--latest",
        metavar="DIR",
        help="pick the newest telemetry-*.csv in DIR (can combine with positional CSVs)",
    )
    args = parser.parse_args(argv)

    try:
        paths = resolve_paths(args)
        print(build_report(paths))
    except (OSError, ValueError) as exc:
        print(f"[FAIL] swarm_report: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())