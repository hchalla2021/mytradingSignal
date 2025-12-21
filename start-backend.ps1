# Backend Startup Script
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Trading Signals Backend" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$venvPath = "$PSScriptRoot\.venv\Scripts\python.exe"
$backendPath = "$PSScriptRoot\backend"

Write-Host "Starting backend server..." -ForegroundColor Yellow
Write-Host "Location: http://localhost:8001" -ForegroundColor Green
Write-Host "API Docs: http://localhost:8001/docs" -ForegroundColor Green
Write-Host "`nPress Ctrl+C to stop`n" -ForegroundColor Gray

Set-Location $backendPath
& $venvPath app.py
