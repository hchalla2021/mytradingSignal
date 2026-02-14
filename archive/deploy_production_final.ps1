# Production Deployment Script with Cache Clearing
# Deploys to Digital Ocean with no-cache builds

Write-Host "================================" -ForegroundColor Cyan
Write-Host "🚀 Production Deployment to Digital Ocean" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Git operations
Write-Host "📦 Step 1: Committing and pushing changes..." -ForegroundColor Yellow
git add .
git commit -m "Fix: Added missing API_CONFIG imports to Volume Pulse and Trend Base cards"
git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Git push failed! Check your connection." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Code pushed to repository" -ForegroundColor Green
Write-Host ""

# Step 2: SSH to Digital Ocean and deploy
Write-Host "🌐 Step 2: Connecting to Digital Ocean..." -ForegroundColor Yellow
Write-Host "📋 Commands to run on server:" -ForegroundColor Cyan
Write-Host ""
Write-Host "# Navigate to project directory" -ForegroundColor Gray
Write-Host "cd /root/mytradingSignal" -ForegroundColor White
Write-Host ""
Write-Host "# Pull latest changes" -ForegroundColor Gray
Write-Host "git pull origin main" -ForegroundColor White
Write-Host ""
Write-Host "# Stop all containers" -ForegroundColor Gray
Write-Host "docker-compose -f docker-compose.prod.yml down" -ForegroundColor White
Write-Host ""
Write-Host "# Remove old images to force rebuild" -ForegroundColor Gray
Write-Host "docker rmi trading-frontend trading-backend 2>/dev/null || true" -ForegroundColor White
Write-Host ""
Write-Host "# Clear frontend build cache" -ForegroundColor Gray
Write-Host "rm -rf frontend/.next frontend/node_modules/.cache" -ForegroundColor White
Write-Host ""
Write-Host "# Rebuild with no cache" -ForegroundColor Gray
Write-Host "docker-compose -f docker-compose.prod.yml build --no-cache" -ForegroundColor White
Write-Host ""
Write-Host "# Start services" -ForegroundColor Gray
Write-Host "docker-compose -f docker-compose.prod.yml up -d" -ForegroundColor White
Write-Host ""
Write-Host "# Check status" -ForegroundColor Gray
Write-Host "docker-compose -f docker-compose.prod.yml ps" -ForegroundColor White
Write-Host ""
Write-Host "# View logs" -ForegroundColor Gray
Write-Host "docker-compose -f docker-compose.prod.yml logs -f --tail=50" -ForegroundColor White
Write-Host ""

Write-Host "================================" -ForegroundColor Cyan
Write-Host "📝 Manual Steps Required:" -ForegroundColor Yellow
Write-Host "================================" -ForegroundColor Cyan
Write-Host "1. SSH to Digital Ocean: ssh root@your-droplet-ip" -ForegroundColor White
Write-Host "2. Run the commands above" -ForegroundColor White
Write-Host "3. After deployment, clear browser cache:" -ForegroundColor White
Write-Host "   - Desktop: Ctrl+Shift+Delete (Clear cache)" -ForegroundColor White
Write-Host "   - Or use Incognito/Private mode" -ForegroundColor White
Write-Host "   - Mobile: Clear app cache in browser settings" -ForegroundColor White
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "🔧 Testing After Deployment:" -ForegroundColor Yellow
Write-Host "================================" -ForegroundColor Cyan
Write-Host "1. Open https://mydailytradesignals.com (or your domain)" -ForegroundColor White
Write-Host "2. Verify Volume Pulse shows data (not 'Data unavailable')" -ForegroundColor White
Write-Host "3. Verify Trend Base shows data" -ForegroundColor White
Write-Host "4. Test on mobile device" -ForegroundColor White
Write-Host "5. Test on different browsers (Chrome, Firefox, Safari, Edge)" -ForegroundColor White
Write-Host ""
Write-Host "✅ Deployment script ready!" -ForegroundColor Green
