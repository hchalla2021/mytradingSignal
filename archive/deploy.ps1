# Quick Deployment Script for Digital Ocean (PowerShell)
# Run this script from your local Windows machine

param(
    [string]$DropletIP = $env:DROPLET_IP,
    [string]$DropletUser = "root"
)

# Configuration
$APP_DIR = "/var/www/mytradingSignal"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "🚀 MyDailyTradingSignals - Quick Deployment to Digital Ocean" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if DROPLET_IP is set
if (-not $DropletIP) {
    Write-Host "❌ Error: DROPLET_IP not set" -ForegroundColor Red
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  `$env:DROPLET_IP = 'your.droplet.ip.address'"
    Write-Host "  .\deploy.ps1"
    Write-Host ""
    Write-Host "Or:"
    Write-Host "  .\deploy.ps1 -DropletIP 'your.droplet.ip.address'"
    exit 1
}

Write-Host "📋 Deployment Configuration:" -ForegroundColor Yellow
Write-Host "   Droplet IP: $DropletIP"
Write-Host "   User: $DropletUser"
Write-Host "   App Directory: $APP_DIR"
Write-Host ""

# Step 1: Push code to Git
Write-Host "📤 Step 1: Pushing code to Git..." -ForegroundColor Yellow
git add .
git status

$commitMsg = Read-Host "Commit message (or press Enter for default)"
if (-not $commitMsg) {
    $commitMsg = "Deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}

try {
    git commit -m $commitMsg
} catch {
    Write-Host "No changes to commit" -ForegroundColor Gray
}

git push origin main
Write-Host "✅ Code pushed to Git" -ForegroundColor Green
Write-Host ""

# Step 2: Deploy to Digital Ocean
Write-Host "📡 Step 2: Deploying to Digital Ocean..." -ForegroundColor Yellow

$sshScript = @"
set -e

echo ""
echo "🔄 Pulling latest code..."
cd $APP_DIR
git pull origin main

echo ""
echo "🐍 Updating backend dependencies..."
cd backend
source venv/bin/activate
pip install -r requirements.txt --quiet

echo ""
echo "📦 Updating frontend dependencies..."
cd ../frontend
npm install --silent

echo ""
echo "🏗️ Building frontend..."
npm run build

echo ""
echo "🔄 Restarting services..."
sudo systemctl restart mytrading-backend
sudo systemctl restart mytrading-frontend

echo ""
echo "⏳ Waiting for services to start..."
sleep 5

echo ""
echo "📊 Service status:"
sudo systemctl status mytrading-backend --no-pager | head -n 10
sudo systemctl status mytrading-frontend --no-pager | head -n 10

echo ""
echo "✅ Deployment complete!"
"@

ssh "${DropletUser}@${DropletIP}" $sshScript

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "✅ DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 Your app is live at: https://mydailytradesignals.com"
Write-Host ""
Write-Host "📋 Next steps:"
Write-Host "   1. Check logs: ssh ${DropletUser}@${DropletIP} 'journalctl -u mytrading-backend -n 50'"
Write-Host "   2. Verify frontend: https://mydailytradesignals.com"
Write-Host "   3. Test WebSocket: Open browser DevTools -> Network -> WS"
Write-Host ""
Write-Host "🔧 Troubleshooting:"
Write-Host "   - Backend logs: journalctl -u mytrading-backend -f"
Write-Host "   - Frontend logs: journalctl -u mytrading-frontend -f"
Write-Host "   - Nginx logs: tail -f /var/log/nginx/error.log"
Write-Host ""
