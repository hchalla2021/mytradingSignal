# 🚀 AUTOMATED PRODUCTION DEPLOYMENT VERIFICATION SCRIPT (Windows PowerShell)
# ═══════════════════════════════════════════════════════════════════════════════
# This script DETECTS and REPORTS all hardcoded values before deployment

param(
    [switch]$Verbose = $false
)

$ErrorActionPreference = "Stop"
$issuesFound = 0
$warningsFound = 0

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   PRODUCTION DEPLOYMENT VERIFICATION SCRIPT (Windows)      ║" -ForegroundColor Cyan
Write-Host "║   Checking for hardcoded values, test data, and debug code ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Log-Error {
    param([string]$Message)
    Write-Host "❌ ERROR: $Message" -ForegroundColor Red
    $global:issuesFound++
}

function Log-Warning {
    param([string]$Message)
    Write-Host "⚠️  WARNING: $Message" -ForegroundColor Yellow
    $global:warningsFound++
}

function Log-Success {
    param([string]$Message)
    Write-Host "✅ PASS: $Message" -ForegroundColor Green
}

function Log-Info {
    param([string]$Message)
    Write-Host "ℹ️  INFO: $Message" -ForegroundColor Cyan
}

# ═══════════════════════════════════════════════════════════════════════════════
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "PHASE 1: Check for Hardcoded Sample Data" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

# Check for hardcoded volumes
$volumePattern = "450000|380000|320000|410000"
$volumeMatches = Get-ChildItem -Path "$projectRoot\backend" -Filter "*.py" -Recurse | 
    Select-String -Pattern $volumePattern | 
    Where-Object { $_.Path -notmatch "__pycache__|\.pyc" }

if ($volumeMatches) {
    Log-Error "Found hardcoded volume values (450000, 380000, 320000, 410000) in backend"
    Write-Host "  Location: Likely in routers/advanced_analysis.py"
    Write-Host "  Action: Replace with error responses (NO_DATA status)"
    if ($Verbose) {
        $volumeMatches | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    }
} else {
    Log-Success "No hardcoded volume values found"
}

# Check for SAMPLE data
$sampleMatches = Get-ChildItem -Path "$projectRoot\backend\routers" -Filter "*.py" -Recurse | 
    Select-String -Pattern "SAMPLE data|sample data" 2>$null

if ($sampleMatches) {
    Log-Error "Found 'SAMPLE data' references in routers"
    Write-Host "  These should return proper error responses in production"
} else {
    Log-Success "No SAMPLE data references found"
}

# Check for hardcoded base prices
$priceMatches = Get-ChildItem -Path "$projectRoot\backend" -Filter "*.py" -Recurse | 
    Select-String -Pattern "base_price = 24500|base_price = 51000|base_price = 80000" 2>$null

if ($priceMatches) {
    Log-Error "Found hardcoded base prices (mock values)"
    Write-Host "  Action: Remove or gate behind market session checks"
} else {
    Log-Success "No hardcoded base price values found"
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "PHASE 2: Check for Debug Print Statements" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

# Count print statements
$printMatches = Get-ChildItem -Path "$projectRoot\backend\routers" -Filter "*.py" | 
    Select-String -Pattern 'print\(f"' 2>$null

if ($printMatches.Count -gt 5) {
    Log-Warning "Found $($printMatches.Count) debug print statements in backend/routers"
    Write-Host "  Action: Remove or wrap in 'if DEBUG:' condition"
    if ($Verbose) {
        $printMatches | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    }
} else {
    Log-Success "Print statements are minimal or well-gated"
}

# Check frontend console logs
$consoleMatches = Get-ChildItem -Path "$projectRoot\frontend\hooks" -Include "*.ts", "*.tsx" -Recurse 2>$null | 
    Select-String -Pattern "console\.log" 2>$null

if ($consoleMatches.Count -gt 10) {
    Log-Warning "Found $($consoleMatches.Count) console.log statements in frontend/hooks"
    Write-Host "  Action: Remove or wrap in 'if (DEBUG)' condition"
} else {
    Log-Success "Frontend logging is minimal or acceptable"
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "PHASE 3: Check for Test Files" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

$testFiles = @(
    "$projectRoot\backend\test_data_flow.py",
    "$projectRoot\backend\test_ema_calculation.py",
    "$projectRoot\backend\test_ema_pipeline.py",
    "$projectRoot\backend\test_fetch.py",
    "$projectRoot\backend\test_intraday_filter.py",
    "$projectRoot\backend\test_market_structure_fix.py",
    "$projectRoot\backend\data\test_data_factory.py",
    "$projectRoot\backend\scripts\generate_test_data.py",
    "$projectRoot\backend\scripts\validate_pcr_setup.py"
)

$foundTestFiles = 0
foreach ($file in $testFiles) {
    if (Test-Path $file) {
        Log-Error "Test file found: $file (should be deleted before production)"
        $foundTestFiles++
    }
}

if ($foundTestFiles -eq 0) {
    Log-Success "No test files found (clean)"
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "PHASE 4: Check Environment Variables" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

$requiredVars = @("ZERODHA_API_KEY", "ZERODHA_API_SECRET", "JWT_SECRET")

foreach ($var in $requiredVars) {
    $value = [System.Environment]::GetEnvironmentVariable($var)
    if ([string]::IsNullOrEmpty($value)) {
        Log-Warning "Environment variable not set: $var (required for production)"
    } else {
        if ($var -eq "JWT_SECRET" -and $value.Length -lt 32) {
            Log-Warning "JWT_SECRET is too short (should be >32 chars, is $($value.Length))"
        } else {
            Log-Success "Environment variable $var is set"
        }
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "PHASE 5: Check for Mock/Test Mode Indicators" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

# Check TEST_DATA_ENABLED
$testDataMatches = Get-ChildItem -Path "$projectRoot\backend" -Filter "*.py" -Recurse | 
    Select-String -Pattern "TEST_DATA_ENABLED\s*=\s*True" 2>$null

if ($testDataMatches) {
    Log-Error "Found TEST_DATA_ENABLED=True in backend (should be False)"
} else {
    Log-Success "TEST_DATA_ENABLED is not set to True"
}

# Check MOCK_DATA_ENABLED
$mockDataMatches = Get-ChildItem -Path "$projectRoot\backend" -Filter "*.py" -Recurse | 
    Select-String -Pattern "MOCK_DATA_ENABLED\s*=\s*True" 2>$null

if ($mockDataMatches) {
    Log-Error "Found MOCK_DATA_ENABLED=True in backend (should be False)"
} else {
    Log-Success "MOCK_DATA_ENABLED is not set to True"
}

# Check DEBUG flag
$debugMatches = Get-ChildItem -Path "$projectRoot\backend" -Filter "*.py" -Recurse | 
    Select-String -Pattern "DEBUG\s*=\s*True" 2>$null

if ($debugMatches) {
    Log-Warning "Found DEBUG=True in backend (should be False for production)"
} else {
    Log-Success "DEBUG is not set to True"
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "PHASE 6: Check Authentication and Secrets" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

# Check for hardcoded API keys
$hardcodedKeyMatches = Get-ChildItem -Path "$projectRoot\backend" -Filter "*.py" -Recurse | 
    Select-String -Pattern 'zerodha_api_key\s*=\s*[''"]' 2>$null | 
    Where-Object { $_.Line -notmatch "os\.getenv|os\.environ" }

if ($hardcodedKeyMatches) {
    Log-Error "Found hardcoded API key in backend source code"
    Write-Host "  Action: Use environment variables only"
} else {
    Log-Success "No hardcoded API keys found in source"
}

# Check for hardcoded secrets
$hardcodedSecretMatches = Get-ChildItem -Path "$projectRoot\backend" -Filter "*.py" -Recurse | 
    Select-String -Pattern 'zerodha_api_secret\s*=\s*[''"]' 2>$null | 
    Where-Object { $_.Line -notmatch "os\.getenv|os\.environ" }

if ($hardcodedSecretMatches) {
    Log-Error "Found hardcoded API secret in backend source code"
} else {
    Log-Success "No hardcoded API secrets found in source"
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "PHASE 7: Code Quality Checks" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

# Check for TODO comments
$todoMatches = Get-ChildItem -Path "$projectRoot\backend" -Filter "*.py" -Recurse | 
    Select-String -Pattern "TODO|FIXME|XXX|HACK" 2>$null

if ($todoMatches) {
    Log-Warning "Found $($todoMatches.Count) TODO/FIXME comments (review before production)"
} else {
    Log-Success "No TODO/FIXME comments found"
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "📊 FINAL REPORT" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

$totalIssues = $issuesFound + $warningsFound
Write-Host "ERRORS FOUND:   $issuesFound" -ForegroundColor $(if($issuesFound -gt 0) { "Red" } else { "Green" })
Write-Host "WARNINGS FOUND: $warningsFound" -ForegroundColor $(if($warningsFound -gt 0) { "Yellow" } else { "Green" })
Write-Host ""

if ($issuesFound -eq 0 -and $warningsFound -eq 0) {
    Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║          🎉 PRODUCTION READY - NO ISSUES FOUND 🎉          ║" -ForegroundColor Green
    Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
    exit 0
} elseif ($issuesFound -eq 0) {
    Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
    Write-Host "║       ⚠️  PRODUCTION READY (with minor warnings) ⚠️         ║" -ForegroundColor Yellow
    Write-Host "║              Review warnings before deploying              ║" -ForegroundColor Yellow
    Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "║         ❌ PRODUCTION ISSUES DETECTED - CANNOT DEPLOY ❌    ║" -ForegroundColor Red
    Write-Host "║              Fix all errors before proceeding              ║" -ForegroundColor Red
    Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Red
    exit 1
}
