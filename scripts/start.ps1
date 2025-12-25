# MyDailyTradingSignals - Windows PowerShell Startup Script
# Usage: .\start.ps1

Write-Host "🚀 Starting MyDailyTradingSignals..." -ForegroundColor Cyan

# Check if Docker is available
if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    Write-Host "📦 Using Docker Compose..." -ForegroundColor Green
    docker-compose up --build -d
    Write-Host "✅ Services started!" -ForegroundColor Green
    Write-Host "🌐 Frontend: http://localhost:3000" -ForegroundColor Yellow
    Write-Host "🔧 Backend: http://localhost:8000" -ForegroundColor Yellow
    exit 0
}

# Manual start if Docker not available
Write-Host "🔧 Starting services manually..." -ForegroundColor Yellow

# Start Backend
Write-Host "📡 Starting Backend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; python main.py" -WindowStyle Minimized
Start-Sleep -Seconds 3

# Start Frontend
Write-Host "🎨 Starting Frontend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev" -WindowStyle Minimized

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "🎉 All services running!" -ForegroundColor Green
Write-Host "🌐 Frontend: http://localhost:3000" -ForegroundColor Yellow
Write-Host "🔧 Backend: http://localhost:8000" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C in the minimized windows to stop services" -ForegroundColor Gray
