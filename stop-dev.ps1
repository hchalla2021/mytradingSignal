#!/usr/bin/env pwsh
# Stop Development Servers

Write-Host "`nStopping Development Servers..." -ForegroundColor Yellow

$pythonProcs = Get-Process python -ErrorAction SilentlyContinue
$nodeProcs = Get-Process node -ErrorAction SilentlyContinue

if ($pythonProcs) {
    $pythonProcs | Stop-Process -Force
    Write-Host "  Stopped Backend (Python)" -ForegroundColor Green
}

if ($nodeProcs) {
    $nodeProcs | Stop-Process -Force
    Write-Host "  Stopped Frontend (Node)" -ForegroundColor Green
}

if (-not $pythonProcs -and -not $nodeProcs) {
    Write-Host "  No servers were running" -ForegroundColor Gray
}

Write-Host "`nDone!`n" -ForegroundColor Green
