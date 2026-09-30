param([string]$Experiment = 'tev1.py')
$ErrorActionPreference = 'Stop'
$run = $PSScriptRoot
$runtime = Join-Path $env:USERPROFILE 'tev1-benchmark'
if (Get-NetTCPConnection -LocalPort 11439 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Experiment port occupied; refusing to interrupt another service.'
}
$env:OLLAMA_HOST = '127.0.0.1:11439'
$env:OLLAMA_MODELS = Join-Path $runtime 'models'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_CONTEXT_LENGTH = '4096'
$server = Start-Process -FilePath (Join-Path $runtime 'runtime\ollama.exe') -ArgumentList 'serve' -RedirectStandardOutput (Join-Path $run 'server-stdout.log') -RedirectStandardError (Join-Path $run 'server.log') -PassThru
$server.Id | Out-File (Join-Path $run 'server.pid')
try {
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            Invoke-RestMethod http://127.0.0.1:11439/api/version -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw 'Experiment server did not start.' }
    py -3 (Join-Path $run $Experiment)
    if ($LASTEXITCODE -ne 0) { throw 'Tev1 experiment failed.' }
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id }
}
