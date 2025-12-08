# Professional Frontend Startup Script
# This script ensures the frontend starts with correct environment

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Trading Signals Frontend Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Navigate to frontend directory
Set-Location -Path "$PSScriptRoot\frontend"
Write-Host "✓ Changed to frontend directory" -ForegroundColor Green

# Check if node_modules exists
if (!(Test-Path "node_modules")) {
    Write-Host "⚠ node_modules not found. Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✓ node_modules found" -ForegroundColor Green
}

# Display environment configuration
Write-Host ""
Write-Host "Environment Configuration:" -ForegroundColor Cyan
if (Test-Path ".env.local") {
    $envContent = Get-Content ".env.local" | Where-Object { $_ -match "NEXT_PUBLIC_API_URL" }
    Write-Host "  $envContent" -ForegroundColor Yellow
} else {
    Write-Host "  ⚠ .env.local not found" -ForegroundColor Yellow
}

# Check if port 3000 is available
$portCheck = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($portCheck) {
    Write-Host ""
    Write-Host "⚠ Port 3000 is already in use!" -ForegroundColor Yellow
    Write-Host "Frontend may already be running at http://localhost:3000" -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Stop existing process and restart? (y/n)"
    if ($response -eq 'y') {
        $processId = $portCheck.OwningProcess | Select-Object -First 1
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Write-Host "✓ Port 3000 is now available" -ForegroundColor Green
    } else {
        Write-Host "Exiting..." -ForegroundColor Gray
        exit 0
    }
}

# Start the frontend server
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Starting Frontend Server..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Frontend URL: http://localhost:3000" -ForegroundColor Green
Write-Host "For mobile access: http://192.168.1.13:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Start Next.js dev server
npm run dev
