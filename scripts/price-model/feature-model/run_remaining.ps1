param([string]$Root = 'D:\fuel-prospective-v1')
$ErrorActionPreference = 'Stop'
$deadline = (Get-Date).AddHours(3)
while (!(Test-Path "$Root\qwen-original\results.json")) {
    if ((Get-Date) -gt $deadline) { throw 'Qwen did not finish within the queue deadline' }
    Start-Sleep -Seconds 10
}
& "$Root\venv\Scripts\python.exe" -u "$Root\train_spatial.py" "$Root\dataset-enriched" "$Root\national-context.npy" "$Root\spatial-enriched" --kind spatial256 --epochs 12 *> "$Root\spatial-enriched.log"
if ($LASTEXITCODE -ne 0) { throw 'Engineered national model failed' }
& "$Root\venv\Scripts\python.exe" -u "$Root\train_spatial.py" "$Root\dataset-enriched" "$Root\national-context.npy" "$Root\spatial-large" --kind spatial512 --epochs 12 *> "$Root\spatial-large.log"
if ($LASTEXITCODE -ne 0) { throw 'Larger national model failed' }
