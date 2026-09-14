<#
swarm_sampler.ps1 - reusable swarm telemetry sampler (finza-ops #5).

Parameterized rewrite of the proven one-off C:\Users\Arsal\collective-25\sampler.ps1
(COLLECTIVE-25 run): Win32_Processor LoadPercentage average + Win32_OperatingSystem
memory math, sampled on a fixed cadence and appended to a CSV with the SAME schema
as COLLECTIVE-25 (no label column - the label lives in the filename):

    timestamp,cpu_pct,ram_used_gb

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\swarm_sampler.ps1 `
      [-OutDir <dir>] [-IntervalSec <sec>] [-MaxSeconds <sec>] [-Label <name>]

  -OutDir       output directory, created if missing.
                Default: C:\Users\Arsal\Projects\finza-ops\telemetry
  -IntervalSec  seconds between samples. Default: 5
  -MaxSeconds   0 = run until stopped (Ctrl+C). >0 = auto-stop after that many
                seconds and print a one-line summary. Default: 0
  -Label        run label used in the output filename. Default: swarm

Output file: <OutDir>\telemetry-<Label>-<yyyyMMdd-HHmmss>.csv
Appends to the file if it already exists (never clobbers). ASCII encoding,
matching the original sampler.
#>
param(
    [string]$OutDir = 'C:\Users\Arsal\Projects\finza-ops\telemetry',
    [int]$IntervalSec = 5,
    [int]$MaxSeconds = 0,
    [string]$Label = 'swarm'
)

$ErrorActionPreference = 'Stop'

if ($IntervalSec -lt 1) {
    throw "-IntervalSec must be >= 1 (got $IntervalSec)"
}
if ($MaxSeconds -lt 0) {
    throw "-MaxSeconds must be >= 0 (0 = run until stopped; got $MaxSeconds)"
}

# Create the output directory if missing.
if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

# telemetry-<Label>-<yyyyMMdd-HHmmss>.csv (label sanitized for the filesystem).
$safeLabel = ($Label -replace '[^\w.-]', '_')
$csv = Join-Path $OutDir ('telemetry-{0}-{1}.csv' -f $safeLabel, (Get-Date -Format 'yyyyMMdd-HHmmss'))

# Append, never clobber: write the header only when the file does not exist yet.
if (-not (Test-Path -LiteralPath $csv)) {
    'timestamp,cpu_pct,ram_used_gb' | Out-File -LiteralPath $csv -Encoding ascii
}

$maxDesc = 'unlimited'
if ($MaxSeconds -gt 0) { $maxDesc = "{0}s" -f $MaxSeconds }
Write-Output ("[swarm_sampler] logging to {0} every {1}s (max: {2})" -f $csv, $IntervalSec, $maxDesc)

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$lastSampleSecs = 0.0
$count = 0
while ($true) {
    # Baseline sample happens immediately on the first iteration (no initial sleep).
    # Same proven sampling as COLLECTIVE-25: CPU LoadPercentage avg + RAM used math.
    $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    $os = Get-CimInstance Win32_OperatingSystem
    $usedGb = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 1)
    "{0},{1},{2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $cpu, $usedGb |
        Out-File -LiteralPath $csv -Append -Encoding ascii
    $count++

    if ($MaxSeconds -gt 0 -and $sw.Elapsed.TotalSeconds -ge $MaxSeconds) { break }

    # Honor the cadence: sleep only what remains of the interval after the
    # sampling cost (the CIM query itself takes ~1s on this box).
    $sampleSecs = $sw.Elapsed.TotalSeconds - $lastSampleSecs
    $lastSampleSecs = $sw.Elapsed.TotalSeconds
    $sleepSecs = [math]::Max(0, $IntervalSec - $sampleSecs)
    if ($MaxSeconds -gt 0) {
        $sleepSecs = [math]::Min($sleepSecs, $MaxSeconds - $sw.Elapsed.TotalSeconds)
        $sleepSecs = [math]::Max(0, $sleepSecs)
    }
    Start-Sleep -Milliseconds ([int]($sleepSecs * 1000))
}

if ($MaxSeconds -gt 0) {
    Write-Output ("[swarm_sampler] done: {0} samples in {1:N0}s -> {2}" -f $count, $sw.Elapsed.TotalSeconds, $csv)
}