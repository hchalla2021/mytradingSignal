@echo off
REM MyDailyTradingSignals - Windows Batch Startup Script
REM Usage: start.bat

echo 🚀 Starting MyDailyTradingSignals...

REM Check if Docker is available
where docker-compose >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo 📦 Using Docker Compose...
    docker-compose up --build -d
    echo ✅ Services started!
    echo 🌐 Frontend: http://localhost:3000
    echo 🔧 Backend: http://localhost:8000
    exit /b 0
)

REM Manual start if Docker not available
echo 🔧 Starting services manually...

REM Start Backend
echo 📡 Starting Backend...
start "MyDailyTradingSignals Backend" /MIN cmd /k "cd /d %~dp0backend && python main.py"
timeout /t 3 /nobreak >nul

REM Start Frontend
echo 🎨 Starting Frontend...
start "MyDailyTradingSignals Frontend" /MIN cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 2 /nobreak >nul

echo.
echo 🎉 All services running!
echo 🌐 Frontend: http://localhost:3000
echo 🔧 Backend: http://localhost:8000
echo.
echo Press any key to exit (services will keep running)...
pause >nul
