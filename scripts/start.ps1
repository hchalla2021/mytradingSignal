# MyDailyTradingSignals - Windows PowerShell Startup Script
# Usage: .\start.ps1

Write-Host "🚀 Starting MyDailyTradingSignals..." -ForegroundColor Cyan
$rootDir = Split-Path -Parent $PSScriptRoot

# Check if Docker is available
if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    Write-Host "📦 Using Docker Compose..." -ForegroundColor Green
    docker-compose -f "$rootDir\docker-compose.prod.yml" up --build -d
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "✅ Services started!" -ForegroundColor Green
    Write-Host "🌐 Frontend: http://localhost:3000" -ForegroundColor Yellow
    Write-Host "🔧 Backend: http://localhost:8000" -ForegroundColor Yellow
    exit 0
}

# Keep manual startup, including the independent Apex worker, in one launcher.
& "$rootDir\start.ps1"
