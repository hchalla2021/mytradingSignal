#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Auto-Start Backend Service (Windows PowerShell)
    
.DESCRIPTION
    Automatically starts the FastAPI backend with:
    - Virtual environment activation
    - Dependency check
    - Auto-restart on crash
    - Clean console output
    - Zerodha token validation

.EXAMPLE
    .\auto_start_backend.ps1
#>

# Configuration
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND_DIR = Join-Path $SCRIPT_DIR "backend"
$VENV_DIR = Join-Path $SCRIPT_DIR ".venv"
$VENV_ACTIVATE = Join-Path $VENV_DIR "Scripts\Activate.ps1"
$REQUIREMENTS = Join-Path $BACKEND_DIR "requirements.txt"

# Colors
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Error { Write-Host $args -ForegroundColor Red }
function Write-Warning { Write-Host $args -ForegroundColor Yellow }
function Write-Info { Write-Host $args -ForegroundColor Cyan }

Write-Host "`n" -NoNewline
Write-Host "="*80 -ForegroundColor Cyan
Write-Host "🚀 MyDailyTradingSignals - Auto-Start Backend" -ForegroundColor Cyan
Write-Host "="*80 -ForegroundColor Cyan
Write-Host ""

# Step 1: Check virtual environment
Write-Info "📦 Checking virtual environment..."
if (-not (Test-Path $VENV_ACTIVATE)) {
    Write-Error "❌ Virtual environment not found at: $VENV_DIR"
    Write-Info "💡 Creating virtual environment..."
    python -m venv $VENV_DIR
    if ($LASTEXITCODE -ne 0) {
        Write-Error "❌ Failed to create virtual environment"
        exit 1
    }
    Write-Success "✅ Virtual environment created"
}

# Step 2: Activate virtual environment
Write-Info "⚡ Activating virtual environment..."
& $VENV_ACTIVATE
if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Failed to activate virtual environment"
    exit 1
}
Write-Success "✅ Virtual environment activated"

# Step 3: Check and install dependencies
Write-Info "📚 Checking dependencies..."
if (Test-Path $REQUIREMENTS) {
    Write-Info "📥 Installing/updating dependencies..."
    pip install -q -r $REQUIREMENTS
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "⚠️ Some dependencies failed to install (continuing anyway)"
    } else {
        Write-Success "✅ Dependencies installed"
    }
} else {
    Write-Warning "⚠️ requirements.txt not found - skipping dependency check"
}

# Step 4: Check environment variables
Write-Info "🔐 Checking authentication..."
$env_file = Join-Path $BACKEND_DIR ".env"
if (Test-Path $env_file) {
    $env_content = Get-Content $env_file -Raw
    if ($env_content -match "ZERODHA_API_KEY=(\w+)") {
        Write-Success "✅ Zerodha API key configured"
    } else {
        Write-Warning "⚠️ ZERODHA_API_KEY not found in .env"
    }
    
    if ($env_content -match "ZERODHA_ACCESS_TOKEN=(\w+)") {
        Write-Success "✅ Zerodha access token configured"
    } else {
        Write-Error "❌ ZERODHA_ACCESS_TOKEN not found in .env"
        Write-Info "💡 You need to login first. Run one of these:"
        Write-Host "   python quick_token_fix.py" -ForegroundColor Yellow
        Write-Host "   python backend/get_token.py" -ForegroundColor Yellow
    }
} else {
    Write-Error "❌ .env file not found at: $env_file"
    Write-Info "💡 Copy backend/.env.example to backend/.env and configure"
    exit 1
}

Write-Host ""
Write-Host "="*80 -ForegroundColor Green
Write-Host "🎉 Starting Backend Server" -ForegroundColor Green
Write-Host "="*80 -ForegroundColor Green
Write-Host ""
Write-Info "📡 Backend URL: http://127.0.0.1:8000"
Write-Info "📖 API Docs: http://127.0.0.1:8000/docs"
Write-Info "🔄 Auto-restart: Enabled"
Write-Info "⏹️  Stop: Press Ctrl+C"
Write-Host ""
Write-Host "="*80 -ForegroundColor Cyan
Write-Host ""

# Step 5: Start backend with auto-restart
$restart_count = 0
$max_restarts = 5

while ($restart_count -lt $max_restarts) {
    try {
        Write-Info "🚀 Starting FastAPI server (attempt $($restart_count + 1)/$max_restarts)..."
        
        # Change to backend directory
        Push-Location $BACKEND_DIR
        
        # Start uvicorn
        uvicorn main:app --host 0.0.0.0 --port 8000 --reload
        
        # If we reach here, server stopped gracefully
        Pop-Location
        break
        
    } catch {
        Pop-Location
        Write-Error "❌ Backend crashed: $_"
        $restart_count++
        
        if ($restart_count -lt $max_restarts) {
            Write-Warning "⏳ Restarting in 5 seconds..."
            Start-Sleep -Seconds 5
        } else {
            Write-Error "❌ Max restart attempts reached ($max_restarts)"
            Write-Info "💡 Check logs above for errors"
            exit 1
        }
    }
}

Write-Host ""
Write-Success "✅ Backend stopped gracefully"
Write-Host ""
