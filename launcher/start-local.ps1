$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$port = if ($env:API_PORT) { $env:API_PORT } else { '5000' }
$portNumber = 0
if (-not [int]::TryParse($port, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535) {
    throw 'API_PORT must be a number from 1 to 65535.'
}
$appAddress = "http://127.0.0.1:$portNumber"
try {
    $running = Invoke-RestMethod -Uri "$appAddress/api/session" -TimeoutSec 2
    if ($running.csrf_token -and $running.authenticated -is [bool]) {
        Write-Host "FoodHeaven is already running: $appAddress/"
        exit 0
    }
} catch {
    # No existing portal responded. Continue with normal startup.
}

if (-not (Test-Path -LiteralPath $pythonPath)) {
    Write-Host 'Creating the local Python environment...'
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m venv (Join-Path $projectRoot '.venv')
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m venv (Join-Path $projectRoot '.venv')
    } else {
        throw 'Install Python 3.11 or newer, then run this launcher again.'
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
}

Write-Host 'Checking Python dependencies...'
& $pythonPath -m pip install --disable-pip-version-check -r (Join-Path $projectRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the connection and try again.' }

Write-Host "FoodHeaven: $appAddress/"
Write-Host 'Initial demo login: 1001 / DemoPass123! (saved password changes are preserved)'
Write-Host 'Keep this window open while using the app. Press Ctrl+C to stop.'
& $pythonPath (Join-Path $projectRoot 'backend\app.py')
if ($LASTEXITCODE -ne 0) { throw 'FoodHeaven stopped with an error. Review the message above.' }
