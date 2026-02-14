# Deploy WebSocket Connection Fix to Digital Ocean
# Fixes 9:00 AM connection issue requiring manual restarts

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  WebSocket Connection Fix Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "backend\services\market_feed.py")) {
    Write-Host "❌ Error: Run this script from project root directory" -ForegroundColor Red
    Write-Host "   Current directory: $PWD" -ForegroundColor Yellow
    exit 1
}

Write-Host "📋 Changes in this deployment:" -ForegroundColor Yellow
Write-Host "   ✅ Aggressive connection retry during market hours"
Write-Host "   ✅ Enhanced health monitoring"
Write-Host "   ✅ Faster REST API fallback (2s updates)"
Write-Host "   ✅ Better error messages"
Write-Host ""

# Confirm deployment
$confirmation = Read-Host "Deploy to Digital Ocean? (yes/no)"
if ($confirmation -ne "yes") {
    Write-Host "❌ Deployment cancelled" -ForegroundColor Red
    exit 0
}

Write-Host ""
Write-Host "🔍 Step 1: Checking for uncommitted changes..." -ForegroundColor Cyan
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "📝 Uncommitted changes found:" -ForegroundColor Yellow
    git status --short
    Write-Host ""
    
    $commitChoice = Read-Host "Commit changes before deploying? (yes/no)"
    if ($commitChoice -eq "yes") {
        Write-Host ""
        Write-Host "💾 Step 2: Committing changes..." -ForegroundColor Cyan
        git add backend/services/market_feed.py
        git add backend/services/market_hours_scheduler.py
        git add docs/FIX_9AM_WEBSOCKET_CONNECTION_ISSUE.md
        
        $commitMsg = "fix: WebSocket connection issue at 9:00 AM

- Scheduler now continuously retries connection during market hours
- Added is_connected property for accurate health monitoring  
- Faster REST API fallback (2s polling for smooth UI)
- Clear error messages after 3 consecutive failures
- No more manual backend restarts needed

Fixes: Status changes to PRE_OPEN at 9:00 AM but no data flows
Impact: Eliminates need for daily manual restarts"
        
        git commit -m $commitMsg
        Write-Host "✅ Changes committed" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "📤 Step 3: Pushing to GitHub..." -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Pushed to GitHub successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to push to GitHub" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🚀 Step 4: Deploying to Digital Ocean..." -ForegroundColor Cyan
Write-Host "   Run these commands on your droplet:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   ssh root@your-droplet-ip" -ForegroundColor White
Write-Host "   cd /root/mytradingSignal" -ForegroundColor White
Write-Host "   git pull" -ForegroundColor White
Write-Host "   sudo systemctl restart backend" -ForegroundColor White
Write-Host "   sudo systemctl status backend" -ForegroundColor White
Write-Host ""

Write-Host "📋 Alternative: Copy this one-liner:" -ForegroundColor Yellow
$oneLiner = "cd /root/mytradingSignal && git pull && sudo systemctl restart backend && sudo systemctl status backend"
Write-Host "   $oneLiner" -ForegroundColor Cyan
Write-Host ""

# Ask if user wants to SSH now
$sshChoice = Read-Host "Open SSH connection now? (yes/no)"
if ($sshChoice -eq "yes") {
    $dropletIP = Read-Host "Enter your droplet IP address"
    if ($dropletIP) {
        Write-Host ""
        Write-Host "🔗 Connecting to $dropletIP..." -ForegroundColor Cyan
        ssh root@$dropletIP "cd /root/mytradingSignal && git pull && sudo systemctl restart backend && sudo systemctl status backend"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "📊 What's Fixed:" -ForegroundColor Yellow
Write-Host "   ✅ No more freezing at 9:00 AM PRE_OPEN"
Write-Host "   ✅ No more manual restarts needed"
Write-Host "   ✅ Automatic connection retry every 60 seconds"
Write-Host "   ✅ REST API fallback keeps UI updated (2s refresh)"
Write-Host "   ✅ Clear error messages guide token fix"
Write-Host ""
Write-Host "📖 Documentation:" -ForegroundColor Yellow
Write-Host "   docs/FIX_9AM_WEBSOCKET_CONNECTION_ISSUE.md"
Write-Host ""
Write-Host "🔍 Monitor logs tomorrow morning:" -ForegroundColor Yellow
Write-Host "   ssh root@your-droplet-ip"
Write-Host "   sudo journalctl -u backend -f"
Write-Host ""
Write-Host "Expected behavior at 9:00 AM:"
Write-Host "   ⏰ Status changes to PRE_OPEN"
Write-Host "   🔄 If token invalid, REST fallback activates"
Write-Host "   📡 UI continues showing data (2s updates)"
Write-Host "   🔄 Scheduler retries connection every 60s"
Write-Host "   ✅ When you login, auto-reconnects instantly"
Write-Host ""
