#!/usr/bin/env pwsh
# ==============================================================================
# PRODUCTION READINESS FINAL CHECK & CLEANUP
# Validates and prepares code for Digital Ocean deployment
# ==============================================================================

$ErrorActionPreference = "Stop"

function Write-Header {
    param($Text)
    Write-Host "`n$('='*80)" -ForegroundColor Cyan
    Write-Host $Text -ForegroundColor Cyan
    Write-Host $('='*80)`n" -ForegroundColor Cyan
}

function Write-Success {
    param($Text)
    Write-Host "✅ $Text" -ForegroundColor Green
}

function Write-Warning {
    param($Text)
    Write-Host "⚠️  $Text" -ForegroundColor Yellow
}

function Write-Error-Custom {
    param($Text)
    Write-Host "❌ $Text" -ForegroundColor Red
}

function Write-Info {
    param($Text)
    Write-Host "ℹ️  $Text" -ForegroundColor Blue
}

$projectRoot = $PSScriptRoot
$backendPath = Join-Path $projectRoot "backend"
$frontendPath = Join-Path $projectRoot "frontend"

Write-Header "🚀 PRODUCTION READINESS - FINAL CHECK"

$issues = @()
$warnings = @()
$fixed = @()

# ==============================================================================
# 1. CHECK ENVIRONMENT FILES
# ==============================================================================
Write-Header "📁 Environment Files Check"

# Backend .env
$backendEnv = Join-Path $backendPath ".env"
if (Test-Path $backendEnv) {
    Write-Success "backend/.env exists"
    
    $envContent = Get-Content $backendEnv -Raw
    
    # Check for dummy values
    if ($envContent -match "your_api_key|your_secret|change.*this") {
        Write-Warning "backend/.env contains placeholder values - MUST UPDATE before deployment"
        $warnings += "backend/.env has placeholder values"
    } else {
        Write-Success "backend/.env has no placeholder values"
    }
    
    # Check critical settings
    $criticalVars = @("ZERODHA_API_KEY", "ZERODHA_API_SECRET", "JWT_SECRET", "ENABLE_SCHEDULER", "REDIS_URL")
    foreach ($var in $criticalVars) {
        if ($envContent -match "$var=\S+") {
            Write-Success "$var is set"
        } else {
            Write-Error-Custom "$var is NOT set"
            $issues += "Missing $var in backend/.env"
        }
    }
    
    # Check scheduler is enabled
    if ($envContent -match "ENABLE_SCHEDULER=true") {
        Write-Success "ENABLE_SCHEDULER=true (automatic 9 AM connection enabled)"
    } else {
        Write-Warning "ENABLE_SCHEDULER not set to true"
        $warnings += "ENABLE_SCHEDULER should be 'true' for production"
    }
} else {
    Write-Error-Custom "backend/.env NOT FOUND"
    $issues += "backend/.env missing - create from CONFIGURATION.md"
}

# Frontend .env.local
$frontendEnv = Join-Path $frontendPath ".env.local"
if (Test-Path $frontendEnv) {
    Write-Success "frontend/.env.local exists"
    
    $envContent = Get-Content $frontendEnv -Raw
    
    # Check for production URLs
    if ($envContent -match "NEXT_PUBLIC_API_URL=https://") {
        Write-Success "Production API URL (HTTPS)"
    } else {
        Write-Warning "API URL not using HTTPS (may be development mode)"
    }
    
    if ($envContent -match "NEXT_PUBLIC_WS_URL=wss://") {
        Write-Success "Production WebSocket URL (WSS)"
    } else {
        Write-Warning "WebSocket URL not using WSS (may be development mode)"
    }
} else {
    Write-Error-Custom "frontend/.env.local NOT FOUND"
    $issues += "frontend/.env.local missing - create from CONFIGURATION.md"
}

# ==============================================================================
# 2. CHECK FOR TEST FILES IN BUILD
# ==============================================================================
Write-Header "🧪 Test Files Check"

$testFiles = Get-ChildItem -Path $backendPath -Filter "test_*.py" -Recurse | 
    Where-Object { $_.FullName -notmatch "\\__pycache__\\" }

if ($testFiles.Count -gt 0) {
    Write-Info "Found $($testFiles.Count) test files (normal for development)"
    Write-Info "Test files won't be included in Docker build"
    foreach ($file in $testFiles | Select-Object -First 5) {
        Write-Host "   📄 $($file.Name)" -ForegroundColor Gray
    }
} else {
    Write-Success "No test files found in backend"
}

# ==============================================================================
# 3. CHECK FOR DEBUG CODE
# ==============================================================================
Write-Header "🐛 Debug Code Check"

$debugPatterns = @("print\(.*debug", "print\(.*DEBUG", "console\.log\(", "console\.debug\(")
$debugFiles = @()

# Check Python files
foreach ($pattern in @("print\(.*debug", "print\(.*DEBUG")) {
    $matches = Get-ChildItem -Path $backendPath -Filter "*.py" -Recurse | 
        Where-Object { $_.FullName -notmatch "\\test_|\\__pycache__|\\examples\\" } |
        Select-String -Pattern $pattern
    
    foreach ($match in $matches) {
        if ($match.Line -notmatch "^\s*#") {  # Ignore commented lines
            $debugFiles += "$($match.Filename):$($match.LineNumber) - $($match.Line.Trim())"
        }
    }
}

# Check TypeScript/React files  
$consoleMatches = Get-ChildItem -Path $frontendPath -Filter "*.tsx" -Recurse |
    Where-Object { $_.FullName -notmatch "\\node_modules\\" } |
    Select-String -Pattern "console\.log\(|console\.debug\(" |
    Where-Object { $_.Line -notmatch "^\s*//|commented" }

foreach ($match in $consoleMatches) {
    $debugFiles += "$($match.Filename):$($match.LineNumber) - $($match.Line.Trim())"
}

if ($debugFiles.Count -gt 0) {
    Write-Warning "Found $($debugFiles.Count) debug statements"
    Write-Info "First 10 debug statements:"
    $debugFiles | Select-Object -First 10 | ForEach-Object {
        Write-Host "   $_" -ForegroundColor Gray
    }
    $warnings += "$($debugFiles.Count) debug statements found (review if critical)"
} else {
    Write-Success "No debug code found"
}

# ==============================================================================
# 4. CHECK FOR TODOS
# ==============================================================================
Write-Header "📝 TODO/FIXME Check"

$todoPatterns = "TODO|FIXME|XXX|HACK"
$todoMatches = Get-ChildItem -Path $backendPath -Filter "*.py" -Recurse |
    Where-Object { $_.FullName -notmatch "\\test_|\\__pycache__|\\examples\\" } |
    Select-String -Pattern $todoPatterns

if ($todoMatches.Count -gt 0) {
    Write-Info "Found $($todoMatches.Count) TODO/FIXME comments"
    $todoMatches | Select-Object -First 5 | ForEach-Object {
        Write-Host "   $($_.Filename):$($_.LineNumber) - $($_.Line.Trim())" -ForegroundColor Gray
    }
    Write-Info "Review these before production (low priority)"
} else {
    Write-Success "No TODO/FIXME comments found"
}

# ==============================================================================
# 5. CHECK DOCKER FILES
# ==============================================================================
Write-Header "🐳 Docker Configuration Check"

$dockerFiles = @(
    "docker-compose.prod.yml",
    "backend/Dockerfile",
    "frontend/Dockerfile"
)

foreach ($file in $dockerFiles) {
    $filePath = Join-Path $projectRoot $file
    if (Test-Path $filePath) {
        Write-Success "$file exists"
    } else {
        Write-Error-Custom "$file NOT FOUND"
        $issues += "Missing $file"
    }
}

# ==============================================================================
# 6. CHECK DEPLOYMENT SCRIPT
# ==============================================================================
Write-Header "📜 Deployment Script Check"

$deployScript = Join-Path $projectRoot "deploy_digitalocean.sh"
if (Test-Path $deployScript) {
    Write-Success "deploy_digitalocean.sh exists"
    
    $scriptContent = Get-Content $deployScript -Raw
    if ($scriptContent -match "backend/\.env" -and $scriptContent -match "frontend/\.env\.local") {
        Write-Success "Deployment script uses standard .env files"
    } else {
        Write-Warning "Deployment script may need updates"
    }
} else {
    Write-Error-Custom "deploy_digitalocean.sh NOT FOUND"
    $issues += "Missing deploy_digitalocean.sh"
}

# ==============================================================================
# 7. CHECK GITIGNORE
# ==============================================================================
Write-Header "🔒 Security Check (.gitignore)"

$gitignore = Join-Path $projectRoot ".gitignore"
if (Test-Path $gitignore) {
    $gitignoreContent = Get-Content $gitignore -Raw
    
    $requiredPatterns = @(".env", ".env.local", "*.log", "__pycache__")
    $allFound = $true
    
    foreach ($pattern in $requiredPatterns) {
        if ($gitignoreContent -match [regex]::Escape($pattern) -or $gitignoreContent -match $pattern) {
            Write-Success "$pattern is in .gitignore"
        } else {
            Write-Warning "$pattern NOT in .gitignore"
            $warnings += "$pattern should be in .gitignore"
            $allFound = $false
        }
    }
    
    if ($allFound) {
        Write-Success "All critical files are gitignored"
    }
} else {
    Write-Warning ".gitignore not found"
}

# ==============================================================================
# 8. SYNTAX VALIDATION
# ==============================================================================
Write-Header "✅ Syntax Validation"

Write-Info "Running Python syntax check..."
try {
    $pythonFiles = Get-ChildItem -Path $backendPath -Filter "*.py" -Recurse |
        Where-Object { $_.FullName -notmatch "\\__pycache__|\\venv\\" } |
        Select-Object -First 10
    
    $syntaxErrors = 0
    foreach ($file in $pythonFiles) {
        $result = python -m py_compile $file.FullName 2>&1
        if ($LASTEXITCODE -ne 0) {
            $syntaxErrors++
            Write-Error-Custom "Syntax error in $($file.Name)"
        }
    }
    
    if ($syntaxErrors -eq 0) {
        Write-Success "No Python syntax errors found"
    } else {
        $issues += "$syntaxErrors Python syntax errors"
    }
} catch {
    Write-Warning "Could not validate Python syntax (Python not found?)"
}

# ==============================================================================
# 9. DOCUMENTATION CHECK
# ==============================================================================
Write-Header "📚 Documentation Check"

$requiredDocs = @(
    "CONFIGURATION.md",
    "DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md",
    "DAILY_CHECKLIST.md",
    "docs/TOKEN_MANAGEMENT.md"
)

foreach ($doc in $requiredDocs) {
    $docPath = Join-Path $projectRoot $doc
    if (Test-Path $docPath) {
        Write-Success "$doc exists"
    } else {
        Write-Warning "$doc not found"
    }
}

# ==============================================================================
# FINAL REPORT
# ==============================================================================
Write-Header "📊 FINAL PRODUCTION READINESS REPORT"

Write-Host "`nCritical Issues: $($issues.Count)" -ForegroundColor $(if ($issues.Count -eq 0) { "Green" } else { "Red" })
Write-Host "Warnings: $($warnings.Count)" -ForegroundColor $(if ($warnings.Count -eq 0) { "Green" } else { "Yellow" })

if ($issues.Count -gt 0) {
    Write-Host "`n❌ CRITICAL ISSUES FOUND (MUST FIX BEFORE DEPLOYMENT):`n" -ForegroundColor Red
    $issues | ForEach-Object { Write-Host "   • $_" -ForegroundColor Red }
    Write-Host ""
}

if ($warnings.Count -gt 0) {
    Write-Host "`n⚠️  WARNINGS (REVIEW BEFORE DEPLOYMENT):`n" -ForegroundColor Yellow
    $warnings | ForEach-Object { Write-Host "   • $_" -ForegroundColor Yellow }
    Write-Host ""
}

if ($issues.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host "`n✅ CODE IS PRODUCTION READY!" -ForegroundColor Green
    Write-Host "`n📋 Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Commit and push to Git" -ForegroundColor White
    Write-Host "   2. SSH to Digital Ocean droplet" -ForegroundColor White
    Write-Host "   3. Run: ./deploy_digitalocean.sh" -ForegroundColor White
    Write-Host "   4. Login between 8:00-8:45 AM daily (see DAILY_CHECKLIST.md)" -ForegroundColor White
    Write-Host ""
} elseif ($issues.Count -eq 0) {
    Write-Host "`n⚠️  CODE IS MOSTLY READY (WARNINGS ONLY)" -ForegroundColor Yellow
    Write-Host "   Review warnings above, then can deploy if acceptable" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "`n🔴 CODE IS NOT READY FOR PRODUCTION" -ForegroundColor Red
    Write-Host "   Fix critical issues above before deploying" -ForegroundColor White
    Write-Host ""
}

# ==============================================================================
# SAVE REPORT
# ==============================================================================
$reportFile = Join-Path $projectRoot "PRODUCTION_READINESS_REPORT.txt"
$reportContent = @"
PRODUCTION READINESS REPORT
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
=================================================================

CRITICAL ISSUES: $($issues.Count)
$(if ($issues.Count -gt 0) { ($issues | ForEach-Object { "  • $_" }) -join "`n" } else { "  None" })

WARNINGS: $($warnings.Count)
$(if ($warnings.Count -gt 0) { ($warnings | ForEach-Object { "  • $_" }) -join "`n" } else { "  None" })

STATUS: $(if ($issues.Count -eq 0 -and $warnings.Count -eq 0) { "✅ PRODUCTION READY" } elseif ($issues.Count -eq 0) { "⚠️ MOSTLY READY (WARNINGS ONLY)" } else { "❌ NOT READY" })

=================================================================
"@

$reportContent | Out-File -FilePath $reportFile -Encoding UTF8
Write-Info "Report saved to: PRODUCTION_READINESS_REPORT.txt"

$separator = "=" * 80
Write-Host ""
Write-Host $separator -ForegroundColor Cyan
Write-Host ""

if ($issues.Count -eq 0) {
    exit 0
} else {
    exit 1
}
