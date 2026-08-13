# ===========================================================================
# stop-all.ps1 - shuts down everything start-all.ps1 launched.
#
#   - Kills the backend / decoder / file-worker / frontend console windows
#     (and their child processes: java, node, python) via the recorded PIDs.
#   - Stops the Kafka + InfluxDB containers (kept, not removed - data persists;
#     pass -Down to remove the containers instead).
#   - Leaves the MySQL80 service running (pass -StopMySql to stop it too).
#
# Usage:  .\stop-all.ps1 [-Down] [-StopMySql]
# ===========================================================================

param(
    [switch]$Down,
    [switch]$StopMySql
)

$Root    = $PSScriptRoot
$PidFile = Join-Path $Root '.run-pids.json'

Write-Host "==> Stopping app processes" -ForegroundColor Cyan
if (Test-Path $PidFile) {
    $entries = Get-Content $PidFile -Raw | ConvertFrom-Json
    foreach ($entry in @($entries)) {
        $procId = [int]$entry.pid
        $name   = $entry.name
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
            # /T kills the whole tree: powershell window -> mvnw/java, npm/node, python
            taskkill /PID $procId /T /F | Out-Null
            Write-Host "    $name (pid $procId) stopped" -ForegroundColor Green
        } else {
            Write-Host "    $name (pid $procId) already gone" -ForegroundColor DarkGray
        }
    }
    Remove-Item $PidFile -Force
} else {
    Write-Host "    no .run-pids.json found - nothing recorded to kill" -ForegroundColor Yellow
    Write-Host "    (services started manually must be closed manually)" -ForegroundColor Yellow
}

Write-Host "==> Stopping Docker services" -ForegroundColor Cyan
if ($Down) {
    docker compose -f (Join-Path $Root 'docker-compose.yml') down
} else {
    docker compose -f (Join-Path $Root 'docker-compose.yml') stop
}

if ($StopMySql) {
    Write-Host "==> Stopping MySQL80" -ForegroundColor Cyan
    try { Stop-Service MySQL80 -ErrorAction Stop; Write-Host "    stopped" -ForegroundColor Green }
    catch { Write-Host "    could not stop MySQL80 (needs admin?)" -ForegroundColor Yellow }
}

Write-Host "Done." -ForegroundColor Cyan
