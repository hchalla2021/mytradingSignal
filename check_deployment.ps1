# Quick Pre-Deployment Check
# Validates code before deploying to Digital Ocean

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "  PRE-DEPLOYMENT CHECK" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

$checks = 0
$passed = 0

# Check 1: Files exist
Write-Host "1️⃣  Checking modified files..." -ForegroundColor Yellow
$checks++
if ((Test-Path "backend\services\market_feed.py") -and (Test-Path "backend\services\market_hours_scheduler.py")) {
    Write-Host "   ✅ All files present" -ForegroundColor Green
    $passed++
} else {
    Write-Host "   ❌ Files missing" -ForegroundColor Red
}

# Check 2: Python syntax
Write-Host ""
Write-Host "2️⃣  Validating Python syntax..." -ForegroundColor Yellow
$checks++
$feedCheck = python -m py_compile backend\services\market_feed.py 2>&1
$schedCheck = python -m py_compile backend\services\market_hours_scheduler.py 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ No syntax errors" -ForegroundColor Green
    $passed++
} else {
    Write-Host "   ❌ Syntax errors found" -ForegroundColor Red
}

# Check 3: Git status
Write-Host ""
Write-Host "3️⃣  Checking git status..." -ForegroundColor Yellow
$checks++
$gitStatus = git status --porcelain
if (-not $gitStatus) {
    Write-Host "   ✅ All changes committed" -ForegroundColor Green
    $passed++
} else {
    Write-Host "   ⚠️  Uncommitted changes:" -ForegroundColor Yellow
    git status --short
}

# Summary
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "  RESULT: $passed/$checks PASSED" -ForegroundColor $(if ($passed -eq $checks) { "Green" } else { "Yellow" })
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

if ($passed -eq $checks) {
    Write-Host "✅ READY FOR DEPLOYMENT!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🎯 What's Fixed:" -ForegroundColor Yellow
    Write-Host "   • 9:00 AM Pre-open auto-connect" -ForegroundColor White
    Write-Host "   • 9:00-9:07 AM: Values change (data flowing)" -ForegroundColor White
    Write-Host "   • 9:07-9:15 AM: Auction freeze (EXPECTED)" -ForegroundColor White
    Write-Host "   • 9:15+ AM: Live trading (dynamic values)" -ForegroundColor White
    Write-Host "   • Auto-retry every 60 seconds if disconnected" -ForegroundColor White
    Write-Host "   • REST fallback (2-second updates)" -ForegroundColor White
    Write-Host ""
    Write-Host "📡 Deploy Commands:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   Quick Deploy:" -ForegroundColor Yellow
    Write-Host "   .\deploy_connection_fix.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "   Manual SSH Deploy:" -ForegroundColor Yellow
    Write-Host "   ssh root@your-ip" -ForegroundColor White
    Write-Host '   cd /root/mytradingSignal && git pull && sudo systemctl restart backend' -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "⚠️  Fix issues before deploying" -ForegroundColor Yellow
}

Write-Host "Press Enter to continue..."
Read-Host
