#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Auto-Start Complete System (Backend + Frontend)
    
.DESCRIPTION
    Starts both backend and frontend in parallel with:
    - Automatic dependency installation
    - Health checks
    - Clean console output
    - One-command setup

.EXAMPLE
    .\auto_start_system.ps1
#>

$ErrorActionPreference = "Stop"

# Colors
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Error { Write-Host $args -ForegroundColor Red }
function Write-Warning { Write-Host $args -ForegroundColor Yellow }
function Write-Info { Write-Host $args -ForegroundColor Cyan }

Write-Host "`n"
Write-Host "="*80 -ForegroundColor Magenta
Write-Host "🚀 MyDailyTradingSignals - Auto-Start Complete System" -ForegroundColor Magenta
Write-Host "="*80 -ForegroundColor Magenta
Write-Host ""

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND_DIR = Join-Path $SCRIPT_DIR "backend"
$FRONTEND_DIR = Join-Path $SCRIPT_DIR "frontend"

# Check if backend and frontend directories exist
if (-not (Test-Path $BACKEND_DIR)) {
    Write-Error "❌ Backend directory not found: $BACKEND_DIR"
    exit 1
}

if (-not (Test-Path $FRONTEND_DIR)) {
    Write-Error "❌ Frontend directory not found: $FRONTEND_DIR"
    exit 1
}

Write-Success "✅ Project directories found"
Write-Host ""

# Function to start backend in new terminal
function Start-Backend {
    Write-Info "🔧 Starting Backend Server..."
    
    $backend_script = Join-Path $SCRIPT_DIR "auto_start_backend.ps1"
    
    if (-not (Test-Path $backend_script)) {
        Write-Warning "⚠️ Backend auto-start script not found, using manual start..."
        Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$BACKEND_DIR'; & '..\start_backend.ps1'"
    } else {
        Start-Process pwsh -ArgumentList "-NoExit", "-File", $backend_script
    }
    
    Write-Success "✅ Backend starting in new terminal"
    
    # Wait for backend to be ready
    Write-Info "⏳ Waiting for backend to be ready (checking http://127.0.0.1:8000/health)..."
    $max_attempts = 30
    $attempt = 0
    
    while ($attempt -lt $max_attempts) {
        Start-Sleep -Seconds 2
        $attempt++
        
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -Method GET -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Success "✅ Backend is ready!"
                return $true
            }
        } catch {
            Write-Host "." -NoNewline
        }
    }
    
    Write-Warning "`n⚠️ Backend health check timed out (continuing anyway)"
    return $false
}

# Function to start frontend in new terminal
function Start-Frontend {
    Write-Info "🎨 Starting Frontend Server..."
    
    # Check if node_modules exists
    $node_modules = Join-Path $FRONTEND_DIR "node_modules"
    if (-not (Test-Path $node_modules)) {
        Write-Warning "⚠️ node_modules not found, running npm install first..."
        Write-Info "📦 Installing frontend dependencies (this may take a few minutes)..."
        
        Push-Location $FRONTEND_DIR
        npm install
        Pop-Location
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error "❌ npm install failed"
            return $false
        }
        Write-Success "✅ Frontend dependencies installed"
    }
    
    # Start frontend
    Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$FRONTEND_DIR'; npm run dev"
    
    Write-Success "✅ Frontend starting in new terminal"
    
    # Wait for frontend to be ready
    Write-Info "⏳ Waiting for frontend to be ready (checking http://localhost:3000)..."
    $max_attempts = 20
    $attempt = 0
    
    while ($attempt -lt $max_attempts) {
        Start-Sleep -Seconds 2
        $attempt++
        
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000" -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Success "✅ Frontend is ready!"
                return $true
            }
        } catch {
            Write-Host "." -NoNewline
        }
    }
    
    Write-Warning "`n⚠️ Frontend health check timed out (continuing anyway)"
    return $false
}

# Start services
Write-Host ""
Write-Host "="*80 -ForegroundColor Yellow
Write-Host "🎬 Starting Services..." -ForegroundColor Yellow
Write-Host "="*80 -ForegroundColor Yellow
Write-Host ""

$backend_ok = Start-Backend
Write-Host ""

$frontend_ok = Start-Frontend
Write-Host ""

# Summary
Write-Host ""
Write-Host "="*80 -ForegroundColor Green
Write-Host "🎉 System Started!" -ForegroundColor Green
Write-Host "="*80 -ForegroundColor Green
Write-Host ""

if ($backend_ok) {
    Write-Success "✅ Backend:  http://127.0.0.1:8000"
    Write-Info "   API Docs: http://127.0.0.1:8000/docs"
} else {
    Write-Warning "⚠️ Backend:  Check backend terminal for status"
}

if ($frontend_ok) {
    Write-Success "✅ Frontend: http://localhost:3000"
} else {
    Write-Warning "⚠️ Frontend: Check frontend terminal for status"
}

Write-Host ""
Write-Info "💡 To stop services: Close the terminal windows or press Ctrl+C in each"
Write-Host ""

# Open browser
Write-Info "🌐 Opening browser..."
Start-Sleep -Seconds 3
Start-Process "http://localhost:3000"

Write-Host ""
Write-Success "🎊 All done! Happy trading!"
Write-Host ""
