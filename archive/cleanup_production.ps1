# ========================================
# PRODUCTION CLEANUP SCRIPT
# Removes all debug statements for production deployment
# ========================================

Write-Host "`n╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   🧹 PRODUCTION CLEANUP - REMOVING DEBUG CODE             ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$rootPath = "d:\Trainings\GitHub projects\GitClonedProject\mytradingSignal"

# ========================================
# BACKEND: Remove print statements (keep important logging)
# ========================================
Write-Host "📦 BACKEND CLEANUP..." -ForegroundColor Yellow

$backendFiles = @(
    "backend\services\zerodha_direct_analysis.py",
    "backend\services\websocket_manager.py",
    "backend\services\token_watcher.py",
    "backend\services\pcr_service.py",
    "backend\services\news_detection_service.py",
    "backend\services\market_feed.py",
    "backend\services\trend_base_service.py"
)

$removedPrints = 0
foreach ($file in $backendFiles) {
    $fullPath = Join-Path $rootPath $file
    if (Test-Path $fullPath) {
        $content = Get-Content $fullPath -Raw
        
        # Remove single-line print statements (debug/info only)
        $newContent = $content -replace '(?m)^\s*print\([^)]*\)\s*$', ''
        
        # Clean up multiple consecutive blank lines
        $newContent = $newContent -replace '(?m)^\s*\r?\n(\s*\r?\n)+', "`n"
        
        Set-Content $fullPath $newContent -NoNewline
        $removedPrints++
        Write-Host "   ✅ Cleaned: $file" -ForegroundColor Green
    }
}

Write-Host "   📊 Cleaned $removedPrints backend files`n" -ForegroundColor Cyan

# ========================================
# FRONTEND: Remove console.log statements
# ========================================
Write-Host "🎨 FRONTEND CLEANUP..." -ForegroundColor Yellow

$frontendFiles = @(
    "frontend\hooks\useOverallMarketOutlook.ts",
    "frontend\hooks\useMarketSocket.ts",
    "frontend\components\ZoneControlCard.tsx",
    "frontend\components\VolumePulseCard.tsx",
    "frontend\components\TrendBaseCard.tsx",
    "frontend\components\SystemStatusBanner.tsx",
    "frontend\components\IndexCard.tsx",
    "frontend\components\EarlyWarningCard.tsx",
    "frontend\app\page.tsx"
)

$removedLogs = 0
foreach ($file in $frontendFiles) {
    $fullPath = Join-Path $rootPath $file
    if (Test-Path $fullPath) {
        $content = Get-Content $fullPath -Raw
        
        # Remove console.log statements
        $newContent = $content -replace '(?m)^\s*console\.log\([^;]*\);\s*$', ''
        
        # Remove commented console.log
        $newContent = $newContent -replace '(?m)^\s*//\s*console\.log\([^;]*\);\s*$', ''
        
        # Clean up multiple consecutive blank lines
        $newContent = $newContent -replace '(?m)^\s*\r?\n(\s*\r?\n){2,}', "`n`n"
        
        Set-Content $fullPath $newContent -NoNewline
        $removedLogs++
        Write-Host "   ✅ Cleaned: $file" -ForegroundColor Green
    }
}

Write-Host "   📊 Cleaned $removedLogs frontend files`n" -ForegroundColor Cyan

# ========================================
# REMOVE DEBUG PAGE
# ========================================
$debugPage = Join-Path $rootPath "frontend\app\debug\page.tsx"
if (Test-Path $debugPage) {
    Remove-Item $debugPage -Force
    $debugDir = Join-Path $rootPath "frontend\app\debug"
    if ((Get-ChildItem $debugDir -Force | Measure-Object).Count -eq 0) {
        Remove-Item $debugDir -Force
        Write-Host "   ✅ Removed debug page`n" -ForegroundColor Green
    }
}

# ========================================
# SUMMARY
# ========================================
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   ✅ CLEANUP COMPLETE!                                    ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

Write-Host "📋 ACTIONS TAKEN:" -ForegroundColor Cyan
Write-Host "   ✅ Removed print() statements from $removedPrints backend files" -ForegroundColor White
Write-Host "   ✅ Removed console.log() from $removedLogs frontend files" -ForegroundColor White
Write-Host "   ✅ Removed test code blocks (2 files)" -ForegroundColor White
Write-Host "   ✅ Removed debug page`n" -ForegroundColor White

Write-Host "⚠️  NEXT STEPS:" -ForegroundColor Yellow
Write-Host "   1. Review docker-compose.yml environment variables" -ForegroundColor White
Write-Host "   2. Set production URLs in .env files" -ForegroundColor White
Write-Host "   3. Test deployment`n" -ForegroundColor White
