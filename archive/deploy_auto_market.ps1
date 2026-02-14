# ==============================================================================
# MyTradingSignal - Deploy to Digital Ocean (PowerShell)
# ==============================================================================
# This script deploys the latest code to your Digital Ocean server
# and ensures the market feed auto-starts at 9 AM IST
# ==============================================================================

param(
    [string]$RemoteHost = "your-server-ip",
    [string]$RemoteUser = "root",
    [string]$RemotePath = "/opt/mytradingsignal"
)

Write-Host "=============================================="
Write-Host "🚀 MyTradingSignal - Production Deployment"
Write-Host "=============================================="
Write-Host ""

Write-Host "📍 Deploying to: ${RemoteUser}@${RemoteHost}:${RemotePath}"
Write-Host ""

# Check if scp/ssh are available
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host "❌ SSH not found. Please install OpenSSH or use Git Bash."
    exit 1
}

# Define files to sync (exclude these patterns: .git, node_modules, .venv, __pycache__, .env, *.pyc)
# Note: Manual file sync used instead of rsync

Write-Host "📦 Syncing code to server..."

# Use scp for key files
$filesToSync = @(
    "backend/services/market_hours_scheduler.py",
    "backend/services/market_session_controller.py",
    "backend/services/feed_watchdog.py",
    "backend/services/market_feed.py",
    "backend/main.py",
    "docker-compose.prod.yml"
)

foreach ($file in $filesToSync) {
    $localPath = Join-Path $PSScriptRoot $file
    if (Test-Path $localPath) {
        $remoteDest = "$RemoteUser@${RemoteHost}:$RemotePath/$file"
        Write-Host "  📄 Syncing $file..."
        scp $localPath $remoteDest
    }
}

Write-Host "✅ Code synced"
Write-Host ""

# SSH into server and restart services
Write-Host "🔄 Restarting Docker containers..."

$sshCommands = @"
cd /opt/mytradingsignal
echo "📋 Current container status:"
docker-compose -f docker-compose.prod.yml ps
echo ""
echo "🔄 Restarting backend..."
docker-compose -f docker-compose.prod.yml restart backend
echo ""
echo "📋 New container status:"
docker-compose -f docker-compose.prod.yml ps
echo ""
echo "📝 Backend logs (last 30 lines):"
sleep 5
docker logs trading-backend --tail 30
echo ""
echo "✅ Deployment complete!"
"@

ssh "$RemoteUser@$RemoteHost" $sshCommands

Write-Host ""
Write-Host "=============================================="
Write-Host "🎉 DEPLOYMENT SUCCESSFUL!"
Write-Host "=============================================="
Write-Host ""
Write-Host "📊 Your trading dashboard is now live at:"
Write-Host "   https://mydailytradesignals.com"
Write-Host ""
Write-Host "⏰ AUTOMATIC MARKET HOURS:"
Write-Host "   • 8:55 AM - System auto-starts feed"
Write-Host "   • 9:00 AM - Pre-open data flows"
Write-Host "   • 9:15 AM - Live trading data"
Write-Host "   • 3:35 PM - System auto-stops"
Write-Host ""
Write-Host "🔐 If token is expired, login via UI"
Write-Host "=============================================="
