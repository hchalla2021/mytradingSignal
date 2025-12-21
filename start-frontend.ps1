# Frontend Startup Script
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Trading Signals Frontend" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$frontendPath = "$PSScriptRoot\frontend"

Write-Host "Starting frontend server..." -ForegroundColor Yellow
Write-Host "Location: http://localhost:3000" -ForegroundColor Green
Write-Host "`nPress Ctrl+C to stop`n" -ForegroundColor Gray

Set-Location $frontendPath

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
}

npm run dev
