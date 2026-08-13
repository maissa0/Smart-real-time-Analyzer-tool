# ===========================================================================
# start-all.ps1 - brings up the full KPIT CAN Analyser stack (Windows PS 5.1)
#
#   1. MySQL80 Windows service          (relational DB, port 3306)
#   2. Docker: Kafka + InfluxDB         (docker-compose.yml, ports 9092/8086)
#   3. Spring Boot backend              (mvnw spring-boot:run, port 8080)
#   4. Python decoder worker            (decoder.py     - raw-can-frames -> decoded-signals)
#   5. Python file worker               (file_worker.py - file-processing-jobs -> raw frames)
#   6. Angular frontend                 (ng serve, port 4200)
#
# Each long-running service opens in its own console window so logs are visible.
# PIDs are recorded in .run-pids.json - use .\stop-all.ps1 to shut everything down.
#
# Usage:
#   .\start-all.ps1                     # everything
#   .\start-all.ps1 -SkipFrontend      # e.g. when frontend already runs in IDE
#   Switches: -SkipMySql -SkipDocker -SkipBackend -SkipWorkers -SkipFrontend
# ===========================================================================

param(
    [switch]$SkipMySql,
    [switch]$SkipDocker,
    [switch]$SkipBackend,
    [switch]$SkipWorkers,
    [switch]$SkipFrontend
)

$ErrorActionPreference = 'Stop'
$Root      = $PSScriptRoot
$JavaHome  = 'C:\Program Files\Eclipse Adoptium\jdk-22.0.2.9-hotspot'
$VenvPy    = Join-Path $Root 'python_parser\.venv\Scripts\python.exe'
$PidFile   = Join-Path $Root '.run-pids.json'
$Pids      = @()

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok  ([string]$msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg){ Write-Host "    $msg" -ForegroundColor Yellow }

function Wait-Port([string]$Name, [int]$Port, [int]$TimeoutSec = 90) {
    Write-Host "    waiting for $Name (port $Port)..." -NoNewline
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $async = $client.BeginConnect('localhost', $Port, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(1000) -and $client.Connected) {
                $client.Close()
                Write-Host " up" -ForegroundColor Green
                return $true
            }
        } catch {} finally { $client.Close() }
        Start-Sleep -Seconds 2
    }
    Write-Host " TIMEOUT after ${TimeoutSec}s" -ForegroundColor Red
    return $false
}

function Wait-Healthy([string]$Container, [int]$TimeoutSec = 120) {
    # Docker Desktop's port proxy accepts TCP connects while the container is
    # still booting, so a plain port check passes ~15s too early and workers
    # start with a burst of librdkafka FAIL retries. The compose healthcheck
    # (kafka-topics --list / influx ping) proves actual readiness.
    Write-Host "    waiting for container '$Container' to be healthy..." -NoNewline
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $json = docker inspect --format '{{json .State.Health}}' $Container 2>$null
            if ($json) {
                $h = $json | ConvertFrom-Json
                # Trust the actual probe results, not the Status label — Docker
                # Desktop can leave Status stuck at "unhealthy" from the boot
                # window even while every probe passes (ExitCode 0, streak 0).
                $lastOk = ($h.Log.Count -gt 0) -and ($h.Log[$h.Log.Count - 1].ExitCode -eq 0)
                if ($h.Status -eq 'healthy' -or ($h.FailingStreak -eq 0 -and $lastOk)) {
                    Write-Host " ready" -ForegroundColor Green
                    return $true
                }
            }
        } catch {}
        Start-Sleep -Seconds 3
    }
    Write-Host " TIMEOUT after ${TimeoutSec}s" -ForegroundColor Red
    return $false
}

function Wait-KafkaFromHost([string]$Bootstrap, [int]$TimeoutSec = 60) {
    # The compose healthcheck probes the broker from INSIDE the container
    # (localhost:9092), but the workers connect through Docker Desktop's host
    # proxy, which can start relaying a few seconds later. Probe from the host
    # with the same client library the workers use so they never launch into a
    # half-open proxy and spam librdkafka ApiVersion FAIL retries.
    Write-Host "    waiting for Kafka from host ($Bootstrap)..." -NoNewline
    $probe = @"
import sys
try:
    from confluent_kafka.admin import AdminClient
    AdminClient({'bootstrap.servers': '$Bootstrap', 'log_level': 0}).list_topics(timeout=5)
    sys.exit(0)
except Exception:
    sys.exit(1)
"@
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        & $VenvPy -c $probe
        if ($LASTEXITCODE -eq 0) {
            Write-Host " up" -ForegroundColor Green
            return $true
        }
        Start-Sleep -Seconds 2
    }
    Write-Host " TIMEOUT after ${TimeoutSec}s" -ForegroundColor Red
    return $false
}

function Start-Window([string]$Name, [string]$WorkDir, [string]$Command) {
    # Each service gets its own PowerShell window (-NoExit keeps logs visible).
    $proc = Start-Process powershell -PassThru -WorkingDirectory $WorkDir -ArgumentList @(
        '-NoExit',
        '-Command',
        "`$Host.UI.RawUI.WindowTitle = 'KPIT :: $Name'; $Command"
    )
    Write-Ok "$Name started (pid $($proc.Id))"
    return @{ name = $Name; pid = $proc.Id }
}

# -- 1. MySQL -----------------------------------------------------------------
if (-not $SkipMySql) {
    Write-Step 'MySQL80 service'
    try {
        $svc = Get-Service MySQL80 -ErrorAction Stop
        if ($svc.Status -eq 'Running') {
            Write-Ok 'already running'
        } else {
            try {
                Start-Service MySQL80 -ErrorAction Stop
                Write-Ok 'started'
            } catch {
                Write-Warn2 'could not start MySQL80 (needs admin?). Run as Administrator or start it manually:'
                Write-Warn2 '  Start-Service MySQL80'
            }
        }
    } catch {
        Write-Warn2 'MySQL80 service not found - make sure MySQL 8 is installed and listening on 3306'
    }
}

# -- 2. Docker: Kafka + InfluxDB ----------------------------------------------
if (-not $SkipDocker) {
    Write-Step 'Docker (Kafka + InfluxDB)'
    docker compose -f (Join-Path $Root 'docker-compose.yml') up -d
    if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed - is Docker Desktop running?' }
    $kafkaUp  = Wait-Healthy 'kafka'
    $influxUp = Wait-Healthy 'influxdb'
    if (-not ($kafkaUp -and $influxUp)) {
        Write-Warn2 'Kafka/InfluxDB not healthy yet - downstream services may log reconnect warnings until they are'
    }
}

# -- 3. Backend (Spring Boot) -------------------------------------------------
if (-not $SkipBackend) {
    Write-Step 'Spring Boot backend (port 8080)'
    if (-not (Test-Path $JavaHome)) {
        Write-Warn2 "JAVA_HOME path not found: $JavaHome - edit `$JavaHome in this script"
    }
    $Pids += Start-Window 'backend' (Join-Path $Root 'backend') `
        "`$env:JAVA_HOME = '$JavaHome'; .\mvnw spring-boot:run"
}

# -- 4. Python workers (decoder + file worker) --------------------------------
if (-not $SkipWorkers) {
    Write-Step 'Python pipeline workers'
    if (-not (Test-Path $VenvPy)) {
        throw "venv python not found: $VenvPy - create it with:  cd python_parser; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt"
    }
    $pp = Join-Path $Root 'python_parser'
    if (-not (Wait-KafkaFromHost '127.0.0.1:9092')) {
        Write-Warn2 'Kafka not reachable from the host yet - workers will keep retrying on their own'
    }
    $Pids += Start-Window 'decoder'     $pp "& '$VenvPy' decoder.py --catalogues catalogues --kafka 127.0.0.1:9092"
    $Pids += Start-Window 'file-worker' $pp "& '$VenvPy' file_worker.py --catalogues catalogues --kafka 127.0.0.1:9092 --uploads-dir '$(Join-Path $Root 'uploads')'"
}

# -- 5. Frontend (Angular) ----------------------------------------------------
if (-not $SkipFrontend) {
    Write-Step 'Angular frontend (port 4200)'
    $fe = Join-Path $Root 'Frontend_angular'
    if (-not (Test-Path (Join-Path $fe 'node_modules'))) {
        Write-Warn2 'node_modules missing - running npm install first (one-time, may take a while)'
        Push-Location $fe; npm install; Pop-Location
    }
    $Pids += Start-Window 'frontend' $fe 'npm start'
}

# -- PID file + summary -------------------------------------------------------
if ($Pids.Count -gt 0) {
    $Pids | ConvertTo-Json | Out-File -Encoding utf8 $PidFile
}

if (-not $SkipBackend) { [void](Wait-Port 'backend' 8080 180) }
if (-not $SkipFrontend){ [void](Wait-Port 'frontend' 4200 180) }

Write-Host ''
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ' Stack is starting. Useful URLs:'                  -ForegroundColor Cyan
Write-Host '   Frontend   http://localhost:4200'
Write-Host '   Backend    http://localhost:8080/swagger-ui.html'
Write-Host '   InfluxDB   http://localhost:8086'
Write-Host ''
Write-Host ' Logs: each service runs in its own "KPIT :: <name>" window.'
Write-Host ' Stop everything:  .\stop-all.ps1'
Write-Host '================================================' -ForegroundColor Cyan
