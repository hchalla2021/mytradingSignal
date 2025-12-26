# MyDailyTradingSignals - Clean Startup Script

Write-Host "`n========================================"  -ForegroundColor Cyan
Write-Host "  STARTING SERVERS - CLEAN MODE" -ForegroundColor White
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Kill all existing processes
Write-Host "1. Stopping all existing servers..." -ForegroundColor Yellow
Get-Process python,node -ErrorAction SilentlyContinue | Where-Object {$_.Path -like "*mytradingSignal*"} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Step 2: Free up ports
Write-Host "2. Freeing up ports 8000 and 3000..." -ForegroundColor Yellow
$ports = @(8000, 3000, 3001)
foreach ($port in $ports) {
    $proc = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($proc) {
        $processId = $proc.OwningProcess
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 2

# Step 3: Clean Next.js cache
Write-Host "3. Cleaning Next.js cache..." -ForegroundColor Yellow
Remove-Item -Recurse -Force "frontend\.next" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host "Done cleaning`n" -ForegroundColor Green

# Step 4: Start Backend
Write-Host "4. Starting Backend (Port 8000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000" -WorkingDirectory $PWD

Start-Sleep -Seconds 5

# Step 5: Start Frontend
Write-Host "5. Starting Frontend (Port 3000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev" -WorkingDirectory $PWD

Start-Sleep -Seconds 8

# Step 6: Verify
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  SERVER STATUS" -ForegroundColor White
Write-Host "========================================`n" -ForegroundColor Green

$backend = Test-NetConnection -ComputerName 127.0.0.1 -Port 8000 -InformationLevel Quiet -WarningAction SilentlyContinue
$frontend = Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue

if ($backend) {
    Write-Host "[OK] Backend:  http://127.0.0.1:8000" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Backend:  NOT RUNNING" -ForegroundColor Red
}

if ($frontend) {
    Write-Host "[OK] Frontend: http://localhost:3000" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Frontend: Check other terminal" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Green

if ($backend -and $frontend) {
    Write-Host "`nAll systems ready!" -ForegroundColor Green
    Write-Host "Open: http://localhost:3000`n" -ForegroundColor Cyan
} else {
    Write-Host "`nCheck terminal windows for errors`n" -ForegroundColor Yellow
}
