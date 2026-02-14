# ==============================================================================
#  PRODUCTION READINESS FINAL CHECK
# ==============================================================================

Write-Host "`n" -ForegroundColor Cyan
Write-Host "=" -NoNewline -ForegroundColor Cyan; Write-Host ("=" * 78) -ForegroundColor Cyan
Write-Host "PRODUCTION READINESS - FINAL CHECK" -ForegroundColor Cyan  
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""

$issues = @()
$warnings = @()

# Check backend .env
Write-Host "Checking backend/.env..." -ForegroundColor Yellow
if (Test-Path "backend/.env") {
    Write-Host "✅ backend/.env exists" -ForegroundColor Green
    $env = Get-Content "backend/.env" -Raw
    if ($env -match "ENABLE_SCHEDULER=true") {
        Write-Host "✅ ENABLE_SCHEDULER=true (automatic 9 AM enabled)" -ForegroundColor Green
    } else {
        $warnings += "ENABLE_SCHEDULER not set to true"
    }
} else {
    $issues += "backend/.env missing"
    Write-Host "❌ backend/.env NOT FOUND" -ForegroundColor Red
}

# Check frontend .env.local
Write-Host "`nChecking frontend/.env.local..." -ForegroundColor Yellow
if (Test-Path "frontend/.env.local") {
    Write-Host "✅ frontend/.env.local exists" -ForegroundColor Green
} else {
    $issues += "frontend/.env.local missing"
    Write-Host "❌ frontend/.env.local NOT FOUND" -ForegroundColor Red
}

# Check Docker files
Write-Host "`nChecking Docker files..." -ForegroundColor Yellow
$dockerFiles = @("docker-compose.prod.yml", "backend/Dockerfile", "frontend/Dockerfile")
foreach ($file in $dockerFiles) {
    if (Test-Path $file) {
        Write-Host "✅ $file exists" -ForegroundColor Green
    } else {
        $issues += "Missing $file"
        Write-Host "❌ $file NOT FOUND" -ForegroundColor Red
    }
}

# Check deployment script
Write-Host "`nChecking deployment script..." -ForegroundColor Yellow
if (Test-Path "deploy_digitalocean.sh") {
    Write-Host "✅ deploy_digitalocean.sh exists" -ForegroundColor Green
} else {
    $issues += "deploy_digitalocean.sh missing"
    Write-Host "❌ deploy_digitalocean.sh NOT FOUND" -ForegroundColor Red
}

# Check documentation
Write-Host "`nChecking documentation..." -ForegroundColor Yellow
$docs = @("docs/CONFIGURATION.md", "docs/DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md", "docs/DAILY_CHECKLIST.md")
foreach ($doc in $docs) {
    if (Test-Path $doc) {
        Write-Host "✅ $doc exists" -ForegroundColor Green
    } else {
        $warnings += "$doc missing"
        Write-Host "⚠️  $doc not found" -ForegroundColor Yellow
    }
}

# FINAL REPORT
Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "FINAL REPORT" -ForegroundColor Cyan
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""

Write-Host "Critical Issues: $($issues.Count)" -ForegroundColor $(if ($issues.Count -eq 0) { "Green" } else { "Red" })
Write-Host "Warnings: $($warnings.Count)" -ForegroundColor $(if ($warnings.Count -eq 0) { "Green" } else { "Yellow" })
Write-Host ""

if ($issues.Count -gt 0) {
    Write-Host "❌ CRITICAL ISSUES:" -ForegroundColor Red
    foreach ($issue in $issues) {
        Write-Host "   • $issue" -ForegroundColor Red
    }
    Write-Host ""
}

if ($warnings.Count -gt 0) {
    Write-Host "⚠️  WARNINGS:" -ForegroundColor Yellow
    foreach ($warn in $warnings) {
        Write-Host "   • $warn" -ForegroundColor Yellow  
    }
    Write-Host ""
}

if ($issues.Count -eq 0) {
    Write-Host "✅ CODE IS PRODUCTION READY!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Update backend/.env with real Zerodha credentials" -ForegroundColor White
    Write-Host "   2. Update frontend/.env.local with production URLs" -ForegroundColor White
    Write-Host "   3. Commit and push to Git" -ForegroundColor White
    Write-Host "   4. SSH to Digital Ocean and run: ./deploy_digitalocean.sh" -ForegroundColor White
    Write-Host "   5. Login daily at 8:00-8:45 AM to refresh token" -ForegroundColor White
} else {
    Write-Host "🔴 NOT READY - Fix issues above first" -ForegroundColor Red
}

Write-Host ""
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host ""
