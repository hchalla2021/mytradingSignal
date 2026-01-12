# Quick Production Update Script
$SERVER = "root@mydailytradesignals.com"

Write-Host "🚀 Updating Production..." -ForegroundColor Cyan

# Upload fixed main.py
Write-Host "📤 Uploading fixed main.py..." -ForegroundColor Cyan
scp backend/main.py ${SERVER}:/var/www/mytradingSignal/backend/main.py

# Update backend env
ssh $SERVER @"
cd /var/www/mytradingSignal/backend

# Update token in .env
sed -i 's/ZERODHA_ACCESS_TOKEN=.*/ZERODHA_ACCESS_TOKEN=l39xf8o7D0MfJEBLI8ALD5spJ5CUGd6s/' .env

# Update redirect URL
sed -i 's|REDIRECT_URL=.*|REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback|' .env

pm2 restart backend
"@

Write-Host "✅ Backend updated!" -ForegroundColor Green

# Update frontend env
Write-Host "📤 Uploading frontend .env.production.local..." -ForegroundColor Cyan
scp frontend/.env.production.local ${SERVER}:/var/www/mytradingSignal/frontend/.env.production.local

# Rebuild and restart frontend
ssh $SERVER @"
cd /var/www/mytradingSignal/frontend
npm run build
pm2 restart frontend
"@

Write-Host ""
Write-Host "✅ DONE! Check status:" -ForegroundColor Green
Write-Host "   https://mydailytradesignals.com" -ForegroundColor Yellow
