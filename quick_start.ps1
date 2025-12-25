# Quick Start Script
Write-Host "Starting servers..." -ForegroundColor Cyan

$backend = "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal\backend"
$frontend = "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal\frontend"
$python = "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal\.venv\Scripts\python.exe"

Write-Host "Backend starting..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backend'; & '$python' -m uvicorn main:app --host 127.0.0.1 --port 8000"

Start-Sleep -Seconds 8

Write-Host "Frontend starting..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontend'; npm run dev"

Start-Sleep -Seconds 10

Write-Host "Testing API..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod "http://127.0.0.1:8000/api/analysis/analyze/all"
    Write-Host "API Working!" -ForegroundColor Green
    Write-Host "NIFTY: $($response.NIFTY.signal)" -ForegroundColor Yellow
    Write-Host "BANKNIFTY: $($response.BANKNIFTY.signal)" -ForegroundColor Yellow
}
catch {
    Write-Host "Backend still starting..." -ForegroundColor Yellow
}

Write-Host "Open http://localhost:3000" -ForegroundColor Cyan
