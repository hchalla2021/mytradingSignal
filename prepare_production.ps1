# ==============================================================================
# PRODUCTION DEPLOYMENT - FINAL PREPARATION (PowerShell)
# ==============================================================================

Write-Host ""
Write-Host "=" -NoNewline; Write-Host ("=" * 79)
Write-Host "PRODUCTION DEPLOYMENT - FINAL PREPARATION" -ForegroundColor Cyan
Write-Host ("=" * 80)
Write-Host ""

# Step 1: Update backend/.env
Write-Host "Step 1: Updating backend/.env for production..." -ForegroundColor Yellow
$backendEnv = Get-Content "backend\.env" -Raw

# Comment out local URLs
$backendEnv = $backendEnv -replace '(?m)^REDIRECT_URL=http://localhost:8000', '# REDIRECT_URL=http://localhost:8000'
$backendEnv = $backendEnv -replace '(?m)^FRONTEND_URL=http://localhost:3000', '# FRONTEND_URL=http://localhost:3000'
$backendEnv = $backendEnv -replace '(?m)^CORS_ORIGINS=http://localhost.*', '# CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000'

# Uncomment production URLs
$backendEnv = $backendEnv -replace '(?m)^# REDIRECT_URL=https://mydailytradesignals.com', 'REDIRECT_URL=https://mydailytradesignals.com'
$backendEnv = $backendEnv -replace '(?m)^# FRONTEND_URL=https://mydailytradesignals.com', 'FRONTEND_URL=https://mydailytradesignals.com'
$backendEnv = $backendEnv -replace '(?m)^# CORS_ORIGINS=https://mydailytradesignals.com', 'CORS_ORIGINS=https://mydailytradesignals.com'

Set-Content "backend\.env" $backendEnv
Write-Host "✅ backend/.env updated" -ForegroundColor Green
Write-Host ""

# Step 2: Update frontend/.env.local
Write-Host "Step 2: Updating frontend/.env.local for production..." -ForegroundColor Yellow
$frontendEnv = Get-Content "frontend\.env.local" -Raw

# Comment out local URLs
$frontendEnv = $frontendEnv -replace '(?m)^NEXT_PUBLIC_API_URL=http://localhost:8000', '# NEXT_PUBLIC_API_URL=http://localhost:8000'
$frontendEnv = $frontendEnv -replace '(?m)^NEXT_PUBLIC_WS_URL=ws://localhost:8000', '# NEXT_PUBLIC_WS_URL=ws://localhost:8000'
$frontendEnv = $frontendEnv -replace '(?m)^NEXT_PUBLIC_ENVIRONMENT=local', '# NEXT_PUBLIC_ENVIRONMENT=local'

# Uncomment production URLs
$frontendEnv = $frontendEnv -replace '(?m)^# NEXT_PUBLIC_API_URL=https://mydailytradesignals.com', 'NEXT_PUBLIC_API_URL=https://mydailytradesignals.com'
$frontendEnv = $frontendEnv -replace '(?m)^# NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com', 'NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com'
$frontendEnv = $frontendEnv -replace '(?m)^# NEXT_PUBLIC_ENVIRONMENT=production', 'NEXT_PUBLIC_ENVIRONMENT=production'

Set-Content "frontend\.env.local" $frontendEnv
Write-Host "✅ frontend/.env.local updated" -ForegroundColor Green
Write-Host ""

# Step 3: Verify
Write-Host "Step 3: Verifying configuration..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Backend production URLs:" -ForegroundColor Cyan
Select-String -Path "backend\.env" -Pattern "^REDIRECT_URL=", "^FRONTEND_URL=", "^CORS_ORIGINS=" | ForEach-Object { Write-Host "  $($_.Line)" }
Write-Host ""
Write-Host "Frontend production URLs:" -ForegroundColor Cyan
Select-String -Path "frontend\.env.local" -Pattern "^NEXT_PUBLIC_API_URL=", "^NEXT_PUBLIC_WS_URL=", "^NEXT_PUBLIC_ENVIRONMENT=" | ForEach-Object { Write-Host "  $($_.Line)" }
Write-Host ""

# Step 4: Git commit
Write-Host "Step 4: Committing changes..." -ForegroundColor Yellow
git add backend\.env frontend\.env.local
git commit -m "Production ready: Update URLs for deployment"
Write-Host "✅ Changes committed" -ForegroundColor Green
Write-Host ""

# Step 5: Final instructions
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "PRODUCTION PREPARATION COMPLETE" -ForegroundColor Green
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. git push origin main" -ForegroundColor White
Write-Host "  2. SSH to Digital Ocean: ssh root@your-droplet-ip" -ForegroundColor White
Write-Host "  3. cd /opt/mytradingSignal && git pull origin main" -ForegroundColor White
Write-Host "  4. ./deploy_digitalocean.sh" -ForegroundColor White
Write-Host "  5. Login daily at 8:00-8:45 AM (token refresh)" -ForegroundColor White
Write-Host ""
Write-Host "Documentation:" -ForegroundColor Cyan
Write-Host "  • PRODUCTION_READINESS_REPORT.md" -ForegroundColor White
Write-Host "  • docs/DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md" -ForegroundColor White
Write-Host "  • docs/DAILY_CHECKLIST.md" -ForegroundColor White
Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""
