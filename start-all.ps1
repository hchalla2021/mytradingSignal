# Professional All-In-One Startup Script
# Starts both backend and frontend in separate terminals

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Trading Signals - Complete Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Kill any existing processes on ports 8001 and 3000
Write-Host "Cleaning up existing processes..." -ForegroundColor Yellow

# Port 8001 (Backend)
$port8001 = Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue
if ($port8001) {
    $processId = $port8001.OwningProcess | Select-Object -First 1
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ Stopped process on port 8001" -ForegroundColor Green
}

# Port 3000 (Frontend)
$port3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($port3000) {
    $processId = $port3000.OwningProcess | Select-Object -First 1
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ Stopped process on port 3000" -ForegroundColor Green
}

Start-Sleep -Seconds 2

# Get your local IP for mobile access
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Starting Backend..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Start backend in new PowerShell window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$PSScriptRoot\start-backend.ps1'"
Write-Host "✓ Backend starting in new window..." -ForegroundColor Green

# Wait for backend to initialize
Write-Host "Waiting for backend to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Test backend connectivity
$backendReady = $false
$retries = 0
$maxRetries = 10

while (-not $backendReady -and $retries -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8001/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $backendReady = $true
            Write-Host "✓ Backend is ready!" -ForegroundColor Green
        }
    } catch {
        $retries++
        Write-Host "  Waiting... ($retries/$maxRetries)" -ForegroundColor Gray
        Start-Sleep -Seconds 2
    }
}

if (-not $backendReady) {
    Write-Host "⚠ Backend may still be starting. Check the backend window for errors." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Starting Frontend..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Start frontend in new PowerShell window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$PSScriptRoot\start-frontend.ps1'"
Write-Host "✓ Frontend starting in new window..." -ForegroundColor Green

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  🚀 ALL SYSTEMS READY!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Desktop Access:" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "  Backend:  http://localhost:8001" -ForegroundColor White
Write-Host "  API Docs: http://localhost:8001/docs" -ForegroundColor White
Write-Host ""
Write-Host "Mobile Access (same WiFi):" -ForegroundColor Cyan
Write-Host "  Frontend: http://${localIP}:3000" -ForegroundColor White
Write-Host "  Backend:  http://${localIP}:8001" -ForegroundColor White
Write-Host ""
Write-Host "To stop all servers:" -ForegroundColor Yellow
Write-Host "  Close both PowerShell windows or press Ctrl+C in each" -ForegroundColor Gray
Write-Host ""
Write-Host "Press any key to close this window..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
