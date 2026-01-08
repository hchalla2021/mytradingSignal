# Start Backend Server
Write-Host "🚀 Starting MyDailyTradingSignals Backend..." -ForegroundColor Green
Write-Host "⚠️  DO NOT CLOSE THIS WINDOW" -ForegroundColor Yellow
Write-Host ""

Set-Location "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal\backend"

# Activate virtual environment
& "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal\.venv\Scripts\Activate.ps1"

Write-Host "🔄 Starting Uvicorn server on http://0.0.0.0:8000" -ForegroundColor Cyan
Write-Host ""

# Start Uvicorn
& "D:\Trainings\GitHub projects\GitClonedProject\mytradingSignal\.venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
