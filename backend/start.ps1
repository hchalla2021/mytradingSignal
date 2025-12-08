# Professional Backend Startup Script
# Starts the FastAPI backend server with proper error handling

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Trading Signals Backend Startup" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Configuration
$PORT = 8001
$HOST = "0.0.0.0"  # Listen on all interfaces (desktop + mobile)
$PYTHON = "C:/Users/hchalla2020/AppData/Local/Microsoft/WindowsApps/python3.13.exe"

# Step 1: Check if port is in use
Write-Host "[1/4] Checking port $PORT..." -ForegroundColor Yellow
$portInUse = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "  Port $PORT is in use. Clearing..." -ForegroundColor Yellow
    $proc = Get-NetTCPConnection -LocalPort $PORT | Select-Object -ExpandProperty OwningProcess -Unique
    Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "  Port cleared!" -ForegroundColor Green
} else {
    Write-Host "  Port $PORT is available" -ForegroundColor Green
}

# Step 2: Get IP addresses for access
Write-Host "`n[2/4] Network Configuration..." -ForegroundColor Yellow
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" } | Select-Object -First 1).IPAddress

Write-Host "  Desktop:  http://localhost:$PORT" -ForegroundColor Green
Write-Host "  Mobile:   http://${localIP}:$PORT" -ForegroundColor Green
Write-Host "  Network:  http://${HOST}:$PORT" -ForegroundColor Green

# Step 3: Check Python and dependencies
Write-Host "`n[3/4] Checking dependencies..." -ForegroundColor Yellow
$pythonVersion = & $PYTHON --version 2>&1
Write-Host "  Python: $pythonVersion" -ForegroundColor Green

# Step 4: Start the server
Write-Host "`n[4/4] Starting backend server..." -ForegroundColor Yellow
Write-Host "  Press Ctrl+C to stop the server`n" -ForegroundColor Cyan

Set-Location $PSScriptRoot

try {
    & $PYTHON -m uvicorn app:app --host $HOST --port $PORT --reload
} catch {
    Write-Host "`nERROR: Failed to start backend" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
