# Professional Backend Startup Script
# This script ensures the backend starts correctly with proper error handling

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Trading Signals Backend Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Navigate to backend directory
Set-Location -Path "$PSScriptRoot\backend"
Write-Host "✓ Changed to backend directory" -ForegroundColor Green

# Check if Python is available
$pythonPath = "C:/Users/hchalla2020/AppData/Local/Microsoft/WindowsApps/python3.13.exe"
if (Test-Path $pythonPath) {
    Write-Host "+" -NoNewline
    Write-Host " Python 3.13 found" -ForegroundColor Green
} else {
    Write-Host "x Python not found at: $pythonPath" -ForegroundColor Red
    exit 1
}

# Check if port 8001 is available
$portCheck = Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue
if ($portCheck) {
    Write-Host "! Port 8001 is already in use. Stopping existing process..." -ForegroundColor Yellow
    $processId = $portCheck.OwningProcess | Select-Object -First 1
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "+ Port 8001 is now available" -ForegroundColor Green
}

# Verify required packages
Write-Host ""
Write-Host "Checking dependencies..." -ForegroundColor Cyan
$requiredPackages = @("fastapi", "uvicorn", "scipy", "numpy", "kiteconnect")
foreach ($package in $requiredPackages) {
    $installed = & $pythonPath -m pip list | Select-String $package
    if ($installed) {
        Write-Host "  + $package" -ForegroundColor Green
    } else {
        Write-Host "  x $package missing" -ForegroundColor Red
    }
}

# Start the backend server
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Starting Backend Server..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backend URL: http://localhost:8001" -ForegroundColor Green
Write-Host "Health Check: http://localhost:8001/health" -ForegroundColor Green
Write-Host "API Docs: http://localhost:8001/docs" -ForegroundColor Green
Write-Host ""
Write-Host "For mobile access, use: http://192.168.1.13:8001" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Start uvicorn with proper settings
& $pythonPath -m uvicorn app:app --host 0.0.0.0 --port 8001 --reload --log-level info
