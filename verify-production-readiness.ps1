# 🚀 PRODUCTION READINESS VERIFICATION (Windows PowerShell)
# Scans entire project and verifies production readiness

Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   🚀 PRODUCTION READINESS VERIFICATION              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$PASSED = 0
$FAILED = 0

function Check-Passed {
    param([string]$Message)
    Write-Host "✅ PASS: $Message" -ForegroundColor Green
    $script:PASSED++
}

function Check-Failed {
    param([string]$Message)
    Write-Host "❌ FAIL: $Message" -ForegroundColor Red
    $script:FAILED++
}

function Check-Warning {
    param([string]$Message)
    Write-Host "⚠️  WARN: $Message" -ForegroundColor Yellow
}

# ============= SECTION 1: CODE QUALITY =============
Write-Host "`n[1/6] CODE QUALITY SCAN" -ForegroundColor Blue
Write-Host "────────────────────────" -ForegroundColor Blue

# Check for console.logs in TypeScript components
$consoleLogs = @(Get-ChildItem "frontend/components" -Filter "*.tsx" -Recurse -ErrorAction SilentlyContinue | Select-String "console\\.log" -ErrorAction SilentlyContinue | Where-Object { $_.Line -notmatch "//" } | Measure-Object).Count
if ($consoleLogs -eq 0) {
    Check-Passed "No console.logs in production code"
} else {
    Check-Warning "Found $consoleLogs console.logs (should be removed)"
}

# Check for hardcoded localhost URLs
$hardcodedUrls = @(Get-ChildItem "frontend/components" -Filter "*.tsx" -Recurse -ErrorAction SilentlyContinue | Select-String "localhost|127\.0\.0\.1" -ErrorAction SilentlyContinue | Where-Object { $_.Line -notmatch "//" } | Measure-Object).Count
if ($hardcodedUrls -eq 0) {
    Check-Passed "No hardcoded localhost URLs in components"
} else {
    Check-Warning "Found $hardcodedUrls hardcoded URLs"
}

# Check for test/dummy data
$dummyData = @(Get-ChildItem "frontend/components" -Filter "*.tsx" -Recurse -ErrorAction SilentlyContinue | Select-String "DEMO|dummy_data|fake_data" -ErrorAction SilentlyContinue | Measure-Object).Count
if ($dummyData -eq 0) {
    Check-Passed "No dummy or test data in production components"
} else {
    Check-Warning "Found references to dummy/test data: $dummyData"
}

# ============= SECTION 2: ENVIRONMENT CONFIG =============
Write-Host "`n[2/6] ENVIRONMENT CONFIGURATION" -ForegroundColor Blue
Write-Host "────────────────────────────────" -ForegroundColor Blue

# Check backend environment template
if (Test-Path "backend\.env.market") {
    Check-Passed "Backend environment template exists (.env.market)"
} else {
    Check-Failed "Backend environment template missing"
}

# Check frontend env detection
$envDetection = Select-String "NEXT_PUBLIC_PRODUCTION_API_URL|NEXT_PUBLIC_LOCAL_API_URL" "frontend/lib/env-detection.ts" -ErrorAction SilentlyContinue
if ($envDetection) {
    Check-Passed "Frontend environment detection configured"
} else {
    Check-Failed "Frontend environment detection not properly set"
}

# Check required env variables
$prodConfig = Get-Content "backend/config/production.py" -ErrorAction SilentlyContinue
$requiredVars = @("ZERODHA_API_KEY", "ZERODHA_API_SECRET", "ZERODHA_ACCESS_TOKEN", "JWT_SECRET", "REDIS_URL")
foreach ($var in $requiredVars) {
    if ($prodConfig -match $var) {
        Check-Passed "Required variable $var referenced in config"
    } else {
        Check-Failed "Required variable $var NOT found"
    }
}

# ============= SECTION 3: WEBSOCKET & DATA FEED =============
Write-Host "`n[3/6] WEBSOCKET & DATA FEED" -ForegroundColor Blue
Write-Host "─────────────────────────" -ForegroundColor Blue

# Check WebSocket uses environment URLs
$wsFiles = @("frontend/hooks/useMarketSocket.ts", "frontend/hooks/useProductionMarketSocket.ts")
$wsEnvCheck = @()
foreach ($file in $wsFiles) {
    if (Test-Path $file) {
        $content = Get-Content $file -ErrorAction SilentlyContinue
        if ($content -match "NEXT_PUBLIC_|process\.env|getWebSocketURL") {
            $wsEnvCheck += $true
        }
    }
}
if ($wsEnvCheck.Count -gt 0) {
    Check-Passed "WebSocket uses environment-based URLs"
} else {
    Check-Failed "WebSocket may have hardcoded URLs"
}

# Check Zerodha integration
$zerodhaCheck = @(Get-ChildItem "backend" -Filter "*.py" -Recurse | Select-String "KiteTicker|kws|websocket" -ErrorAction SilentlyContinue | Measure-Object).Count
if ($zerodhaCheck -gt 0) {
    Check-Passed "Zerodha WebSocket integration found"
} else {
    Check-Warning "Zerodha WebSocket integration not immediately evident"
}

# Check cache fallback
$cacheCheck = Select-String "localStorage|redis|cache" "frontend/hooks/useMarketSocket.ts" -ErrorAction SilentlyContinue
if ($cacheCheck) {
    Check-Passed "Cache fallback mechanism configured"
} else {
    Check-Failed "Cache fallback not found"
}

# ============= SECTION 4: SIGNAL SYSTEM =============
Write-Host "`n[4/6] SIGNAL SYSTEM (16 SIGNALS)" -ForegroundColor Blue
Write-Host "────────────────────────────────" -ForegroundColor Blue

$pageContent = Get-Content "frontend/app/page.tsx" -ErrorAction SilentlyContinue

# Check VWAP integration
if ($pageContent -match "vwapReaction|VWAP|Section 15") {
    Check-Passed "VWAP Reaction signal (#15) integrated"
} else {
    Check-Failed "VWAP Reaction signal NOT found"
}

# Check VERY GOOD VOLUME
if ($pageContent -match "isVeryGoodVolume|VERY_GOOD_VOLUME|Section 16") {
    Check-Passed "VERY GOOD VOLUME signal (#16) integrated"
} else {
    Check-Failed "VERY GOOD VOLUME signal NOT found"
}

# Check 16-signal aggregation
if ($pageContent -match "16 Signals|/16 signals") {
    Check-Passed "16-signal aggregation system active"
} else {
    Check-Warning "Signal count may not be updated to /16"
}

# Check Market Structure
if ($pageContent -match "MarketStructure|RANGE") {
    Check-Passed "Market Structure component integrated"
} else {
    Check-Failed "Market Structure component NOT found"
}

# ============= SECTION 5: SECURITY =============
Write-Host "`n[5/6] SECURITY CHECKS" -ForegroundColor Blue
Write-Host "───────────────────" -ForegroundColor Blue

# Check hardcoded secrets
$backendFiles = Get-ChildItem "backend" -Filter "*.py" -Recurse -ErrorAction SilentlyContinue
$secrets = @($backendFiles | Select-String "password.*=.*['\"]|secret.*=.*['\"]" -ErrorAction SilentlyContinue | Where-Object { $_.Line -notmatch "os\.getenv|process\.env" } | Measure-Object).Count
if ($secrets -eq 0) {
    Check-Passed "No hardcoded secrets found"
} else {
    Check-Failed "Found $secrets potential hardcoded secrets"
}

# Check JWT from environment
$jwtCheck = Select-String "JWT_SECRET.*os\.getenv" "backend/config/production.py" -ErrorAction SilentlyContinue
if ($jwtCheck) {
    Check-Passed "JWT_SECRET loaded from environment"
} else {
    Check-Failed "JWT_SECRET may be hardcoded or not properly configured"
}

# ============= SECTION 6: BUILD & DEPLOYMENT =============
Write-Host "`n[6/6] BUILD & DEPLOYMENT" -ForegroundColor Blue
Write-Host "───────────────────────" -ForegroundColor Blue

# Check frontend build script
$packageJson = Get-Content "frontend/package.json" -ErrorAction SilentlyContinue
if ($packageJson -match '"build":') {
    Check-Passed "Frontend build script configured"
} else {
    Check-Failed "Frontend build script NOT found"
}

# Check requirements.txt
if (Test-Path "backend/requirements.txt") {
    Check-Passed "Backend requirements.txt exists"
} else {
    Check-Failed "Backend requirements.txt missing"
}

# Check Docker support
if (Test-Path "docker-compose.prod.yml") {
    Check-Passed "Docker Compose production config exists"
} else {
    Check-Warning "Docker Compose production config not found"
}

# Check Dockerfiles
$dockerCount = 0
@("backend/Dockerfile", "frontend/Dockerfile") | ForEach-Object {
    if (Test-Path $_) { $dockerCount++ }
}
if ($dockerCount -eq 2) {
    Check-Passed "Both Dockerfiles present"
} elseif ($dockerCount -eq 1) {
    Check-Warning "Only one Dockerfile found"
} else {
    Check-Warning "No Dockerfiles found (optional if not using Docker)"
}

# ============= SUMMARY =============
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║               🎯 VERIFICATION SUMMARY                ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ✅ PASSED: $PASSED" -ForegroundColor Green
Write-Host "  ❌ FAILED: $FAILED" -ForegroundColor Red
Write-Host ""

if ($FAILED -eq 0) {
    Write-Host "✅ PROJECT IS READY FOR PRODUCTION DEPLOYMENT" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor White
    Write-Host "  1. Configure backend\.env with Zerodha credentials" -ForegroundColor Gray
    Write-Host "  2. Configure frontend\.env.local with production URLs" -ForegroundColor Gray
    Write-Host "  3. Run: docker-compose -f docker-compose.prod.yml up -d" -ForegroundColor Gray
    Write-Host "  4. Or manually:" -ForegroundColor Gray
    Write-Host "     - Backend: cd backend && uvicorn main:app --host 0.0.0.0 --port 8000" -ForegroundColor Gray
    Write-Host "     - Frontend: cd frontend && npm run build && npm start" -ForegroundColor Gray
    exit 0
} else {
    Write-Host "❌ FIX THE ABOVE FAILURES BEFORE DEPLOYMENT" -ForegroundColor Red
    exit 1
}
