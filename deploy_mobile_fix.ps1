#!/usr/bin/env powershell
# 📱 DEPLOY ALL MOBILE BROWSERS FIX
# Deploys the mobile-optimized trading dashboard
# Works on Chrome, Safari, Firefox, Samsung Internet, Opera, Edge

Write-Host "🚀 DEPLOYING MOBILE-OPTIMIZED TRADING DASHBOARD" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# Check current directory
$currentPath = Get-Location
Write-Host "📁 Current directory: $currentPath" -ForegroundColor Yellow

# Ensure we're in the correct directory
if (!(Test-Path "frontend" -PathType Container)) {
    Write-Host "❌ ERROR: frontend directory not found!" -ForegroundColor Red
    Write-Host "   Please run this script from the project root directory." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Frontend directory found" -ForegroundColor Green

# Navigate to frontend
Write-Host ""
Write-Host "📂 Entering frontend directory..." -ForegroundColor Yellow
Set-Location "frontend"

# Check for package.json
if (!(Test-Path "package.json")) {
    Write-Host "❌ ERROR: package.json not found in frontend!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Package.json found" -ForegroundColor Green

# Install dependencies
Write-Host ""
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ERROR: npm install failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Dependencies installed successfully" -ForegroundColor Green

# Clean build cache  
Write-Host ""
Write-Host "🧹 Cleaning build cache..." -ForegroundColor Yellow
if (Test-Path ".next") {
    Remove-Item ".next" -Recurse -Force
    Write-Host "✅ Build cache cleaned" -ForegroundColor Green
} else {
    Write-Host "ℹ️  No build cache to clean" -ForegroundColor Gray
}

# Build the mobile-optimized version
Write-Host ""
Write-Host "🔨 Building mobile-optimized version..." -ForegroundColor Yellow
Write-Host "   This includes optimizations for:" -ForegroundColor Gray
Write-Host "   • Chrome Mobile (Android/iOS)" -ForegroundColor Gray  
Write-Host "   • Safari Mobile (iPhone/iPad)" -ForegroundColor Gray
Write-Host "   • Firefox Mobile (Android)" -ForegroundColor Gray
Write-Host "   • Samsung Internet (Android)" -ForegroundColor Gray
Write-Host "   • Opera Mobile (All platforms)" -ForegroundColor Gray
Write-Host "   • Edge Mobile (All platforms)" -ForegroundColor Gray
Write-Host ""

npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ERROR: Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build completed successfully!" -ForegroundColor Green

# Display summary
Write-Host ""
Write-Host "🎉 MOBILE DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "📱 Mobile Browser Support:" -ForegroundColor Cyan
Write-Host "  ✅ Chrome Mobile (Android/iOS)" -ForegroundColor Green
Write-Host "  ✅ Safari Mobile (iPhone/iPad)" -ForegroundColor Green  
Write-Host "  ✅ Firefox Mobile (Android)" -ForegroundColor Green
Write-Host "  ✅ Samsung Internet (Android)" -ForegroundColor Green
Write-Host "  ✅ Opera Mobile (All platforms)" -ForegroundColor Green
Write-Host "  ✅ Edge Mobile (All platforms)" -ForegroundColor Green
Write-Host ""

Write-Host "🔧 Key Improvements:" -ForegroundColor Cyan
Write-Host "  • Fixed SSR/hydration issues for mobile browsers" -ForegroundColor White
Write-Host "  • Extended WebSocket timeouts for mobile networks" -ForegroundColor White
Write-Host "  • Mobile-optimized error handling and recovery" -ForegroundColor White
Write-Host "  • Touch-optimized interface for all mobile devices" -ForegroundColor White
Write-Host "  • Mobile viewport optimization for all browsers" -ForegroundColor White
Write-Host ""

Write-Host "🚀 Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Start the application: npm start" -ForegroundColor White
Write-Host "  2. Test on mobile devices: Open on phone/tablet" -ForegroundColor White
Write-Host "  3. Verify no 'Application error' on any mobile browser" -ForegroundColor White
Write-Host ""

Write-Host "🌐 Start commands:" -ForegroundColor Cyan
Write-Host "  Production: npm start" -ForegroundColor Yellow
Write-Host "  Development: npm run dev" -ForegroundColor Yellow
Write-Host ""

Write-Host "📖 Documentation: docs/MOBILE_BROWSER_FIX_COMPLETE.md" -ForegroundColor Blue
Write-Host ""

# Ask if user wants to start the application
$startApp = Read-Host "Would you like to start the application now? (y/N)"

if ($startApp -eq "y" -or $startApp -eq "Y" -or $startApp -eq "yes" -or $startApp -eq "Yes") {
    Write-Host ""
    Write-Host "🚀 Starting mobile-optimized trading dashboard..." -ForegroundColor Green
    Write-Host "   Press Ctrl+C to stop the application" -ForegroundColor Yellow
    Write-Host ""
    npm start
} else {
    Write-Host ""
    Write-Host "ℹ️  To start the application later, run: npm start" -ForegroundColor Blue
    Write-Host "   Or for development: npm run dev" -ForegroundColor Blue
    Write-Host ""
    Write-Host "Happy trading! 📈📱" -ForegroundColor Green
}

# Return to original directory
Set-Location $currentPath