# iPhone Development Quick Start Script
# This script starts both backend and frontend for iPhone testing

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "iPhone 16 Plus Development Environment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get current IP address
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254.*"} | Select-Object -First 1).IPAddress

Write-Host "🖥️  Computer IP: $ip" -ForegroundColor Green
Write-Host "📱 iPhone URL: http://${ip}:3000" -ForegroundColor Yellow
Write-Host "🔧 Backend API: http://${ip}:8000" -ForegroundColor Yellow
Write-Host ""

Write-Host "📋 Setup Checklist:" -ForegroundColor Cyan
Write-Host "  ✓ Same WiFi network" -ForegroundColor Green
Write-Host "  ✓ Zerodha Kite app installed" -ForegroundColor Green
Write-Host "  ✓ Firewall ports 3000 & 8000 open" -ForegroundColor Green
Write-Host ""

# Check if firewall rules exist
Write-Host "🔥 Checking Firewall Rules..." -ForegroundColor Cyan
$frontendRule = Get-NetFirewallRule -DisplayName "Next.js Dev Server" -ErrorAction SilentlyContinue
$backendRule = Get-NetFirewallRule -DisplayName "FastAPI Backend" -ErrorAction SilentlyContinue

if (-not $frontendRule) {
    Write-Host "  ⚠️  Frontend firewall rule missing. Creating..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "Next.js Dev Server" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow | Out-Null
    Write-Host "  ✓ Frontend firewall rule created" -ForegroundColor Green
} else {
    Write-Host "  ✓ Frontend firewall rule exists" -ForegroundColor Green
}

if (-not $backendRule) {
    Write-Host "  ⚠️  Backend firewall rule missing. Creating..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "FastAPI Backend" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow | Out-Null
    Write-Host "  ✓ Backend firewall rule created" -ForegroundColor Green
} else {
    Write-Host "  ✓ Backend firewall rule exists" -ForegroundColor Green
}

Write-Host ""
Write-Host "🚀 Starting Services..." -ForegroundColor Cyan
Write-Host ""

# Start backend in new window
Write-Host "1️⃣  Starting Backend Server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; Write-Host '🔧 Backend Server Starting...' -ForegroundColor Green; python app.py"

# Wait a bit for backend to start
Start-Sleep -Seconds 3

# Start frontend in new window with environment variable
Write-Host "2️⃣  Starting Frontend Server..." -ForegroundColor Yellow
$envVar = "NEXT_PUBLIC_API_URL=http://${ip}:8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; Write-Host '🎨 Frontend Server Starting...' -ForegroundColor Green; `$env:NEXT_PUBLIC_API_URL='http://${ip}:8000'; npm run dev"

Write-Host ""
Write-Host "✅ Services Started!" -ForegroundColor Green
Write-Host ""
Write-Host "📱 On your iPhone 16 Plus:" -ForegroundColor Cyan
Write-Host "   1. Connect to same WiFi" -ForegroundColor White
Write-Host "   2. Open Safari" -ForegroundColor White
Write-Host "   3. Go to: http://${ip}:3000" -ForegroundColor Yellow
Write-Host "   4. Click 'Login with Zerodha'" -ForegroundColor White
Write-Host "   5. Kite app will open automatically! 🎉" -ForegroundColor Green
Write-Host ""
Write-Host "🔍 Health Check URLs:" -ForegroundColor Cyan
Write-Host "   Backend:  http://${ip}:8000/health" -ForegroundColor White
Write-Host "   Frontend: http://${ip}:3000" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to open browser preview..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Open browser on computer
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "🎯 Everything is ready! Check the new PowerShell windows for logs." -ForegroundColor Green
Write-Host ""
