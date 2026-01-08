# Quick fix: Upload clean main.py to production
$SERVER = "root@mydailytradesignals.com"

Write-Host "🚀 Fixing production server..." -ForegroundColor Cyan

# Upload clean main.py
Write-Host "📤 Uploading clean main.py..." -ForegroundColor Yellow
scp backend/main.py ${SERVER}:/var/www/mytradingSignal/backend/main.py

# Upload frontend .env.production.local
Write-Host "📤 Uploading frontend config..." -ForegroundColor Yellow
scp frontend/.env.production.local ${SERVER}:/var/www/mytradingSignal/frontend/.env.production.local

# Update backend .env and restart
Write-Host "🔧 Updating production..." -ForegroundColor Yellow
ssh $SERVER @'
cd /var/www/mytradingSignal/backend
sed -i "s/ZERODHA_ACCESS_TOKEN=.*/ZERODHA_ACCESS_TOKEN=l39xf8o7D0MfJEBLI8ALD5spJ5CUGd6s/" .env
sed -i "s|REDIRECT_URL=.*|REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback|" .env
pm2 restart backend

cd /var/www/mytradingSignal/frontend
npm run build
pm2 restart frontend

echo ""
echo "✅ Production updated!"
pm2 status
'@

Write-Host ""
Write-Host "✅ DONE! Check your site:" -ForegroundColor Green
Write-Host "   https://mydailytradesignals.com" -ForegroundColor Cyan
