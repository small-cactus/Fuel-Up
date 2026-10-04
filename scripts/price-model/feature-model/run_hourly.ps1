param([string]$Root = 'D:\fuel-prospective-v1')
$ErrorActionPreference = 'Continue'
$deadline = (Get-Date).AddHours(3)
while (!(Test-Path "$Root\spatial-large\results.json") -or !(Test-Path "$Root\dataset-hourly-enriched\ready.json")) {
    if ((Get-Date) -gt $deadline) { throw 'Dependencies did not finish within the queue deadline' }
    Start-Sleep -Seconds 10
}
& "$Root\venv\Scripts\python.exe" -u "$Root\train_spatial.py" "$Root\dataset-hourly-enriched" "$Root\national-context.npy" "$Root\hourly\spatial-enriched" --kind spatial256 --epochs 12 *> "$Root\hourly-spatial-enriched.log"
if ($LASTEXITCODE -ne 0) { throw 'Hourly national model failed' }
& "$Root\venv\Scripts\python.exe" -u "$Root\train_spatial.py" "$Root\dataset-hourly-enriched" "$Root\national-context.npy" "$Root\hourly\spatial-large" --kind spatial512 --epochs 12 *> "$Root\hourly-spatial-large.log"
if ($LASTEXITCODE -ne 0) { throw 'Larger hourly national model failed' }
& "$Root\venv\Scripts\python.exe" -u "$Root\train_spatial.py" "$Root\dataset-hourly" "$Root\national-context.npy" "$Root\hourly\qwen" --kind qwen --epochs 2 --init "$Root\qwen-original" *> "$Root\qwen-hourly.log"
if ($LASTEXITCODE -ne 0) { throw 'Hourly Qwen continuation failed' }
