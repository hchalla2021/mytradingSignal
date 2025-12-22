
# MyTradingSignal - One-Click Launcher
# Starts both Backend and Frontend servers

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "  MyTradingSignal Launcher" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Cleanup existing processes
Write-Host "`nCleaning up..." -ForegroundColor Yellow
Get-Process python,node -ErrorAction SilentlyContinue | Where-Object { 
    $_.Path -like "*mytradingSignal*" -or $_.MainWindowTitle -like "*mytradingSignal*" 
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Start Backend
Write-Host "`nStarting Backend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; & '$PSScriptRoot\.venv\Scripts\python.exe' app.py"

Start-Sleep -Seconds 5

# Start Frontend
Write-Host "Starting Frontend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; if (-not (Test-Path 'node_modules')) { npm install }; npm run dev"

Start-Sleep -Seconds 3

Write-Host "`n================================" -ForegroundColor Green
Write-Host "  Servers Started!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host "`nBackend:  http://localhost:8001" -ForegroundColor White
Write-Host "Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "API Docs: http://localhost:8001/docs" -ForegroundColor Gray
Write-Host "`nPress any key to close..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
