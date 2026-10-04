param([string]$Root = 'D:\fuel-prospective-v1')
$ErrorActionPreference = 'Continue'
& "$Root\venv\Scripts\python.exe" -u "$Root\train_boost.py" "$Root\dataset-hourly-enriched" "$Root\hourly\trees" --device CPU *> "$Root\hourly-trees.log"
if ($LASTEXITCODE -ne 0) { throw 'Hourly trees failed' }
& "$Root\venv\Scripts\python.exe" -u "$Root\train_signed.py" "$Root\dataset-hourly-enriched" "$Root\hourly\signed" *> "$Root\hourly-signed.log"
if ($LASTEXITCODE -ne 0) { throw 'Hourly direction mixture failed' }
