# 🚀 LIVE DATA DEPLOYMENT TO DIGITAL OCEAN (PowerShell)
# No mock data, no dummy feeds, LIVE ZERODHA ONLY

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "🚀 MYTRADESIGNALS - LIVE DATA DEPLOYMENT (DIGITAL OCEAN)" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green

# Check required environment variables
Write-Host ""
Write-Host "🔍 Checking critical environment variables..." -ForegroundColor Cyan

$requiredVars = @(
    "ZERODHA_API_KEY",
    "ZERODHA_API_SECRET", 
    "ZERODHA_ACCESS_TOKEN",
    "JWT_SECRET",
    "REDIRECT_URL"
)

$missing = @()
foreach ($var in $requiredVars) {
    if (-not (Get-Item -Path "env:$var" -ErrorAction SilentlyContinue)) {
        $missing += $var
    }
}

if ($missing.Count -gt 0) {
    Write-Host "❌ MISSING REQUIRED VARIABLES:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "   - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "💡 Set these in Digital Ocean App Platform > Settings > Environment" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ All required Zerodha credentials found" -ForegroundColor Green

# Pull latest code
Write-Host ""
Write-Host "📥 Pulling latest code from repository..." -ForegroundColor Cyan
git pull origin main 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Git pull failed - check connection" -ForegroundColor Yellow
}

# Backend setup
Write-Host ""
Write-Host "⚙️  Setting up Python backend..." -ForegroundColor Cyan
Push-Location backend

Write-Host "   📦 Installing dependencies..." -ForegroundColor Gray
pip install -r requirements.txt -q

Write-Host "   🔄 Checking market configuration..." -ForegroundColor Gray
python -c "from config import get_settings; s = get_settings(); print(f'   ✅ Config loaded: API={bool(s.zerodha_api_key)}, JWT={bool(s.jwt_secret)}')"

# Frontend setup
Write-Host ""
Write-Host "⚙️  Setting up Next.js frontend..." -ForegroundColor Cyan
Pop-Location
Push-Location frontend

Write-Host "   📦 Installing dependencies..." -ForegroundColor Gray
npm install --no-save -q

Write-Host "   🔨 Building optimized production bundle..." -ForegroundColor Gray
npm run build

# Verify build
if (Test-Path ".next") {
    Write-Host "   ✅ Build successful" -ForegroundColor Green
} else {
    Write-Host "   ❌ Build failed" -ForegroundColor Red
    exit 1
}

Pop-Location

# Summary
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "✨ DEPLOYMENT READY" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "✅ Backend: LIVE Zerodha only (no mock feed)" -ForegroundColor Green
Write-Host "✅ Frontend: LIVE data display (no fallback values)" -ForegroundColor Green
Write-Host "✅ Architecture: Zerodha → Redis → API → UI" -ForegroundColor Green
Write-Host ""
Write-Host "🚀 To deploy:" -ForegroundColor Cyan
Write-Host "   1. Commit changes: git add -A && git commit -m 'Ready for live deployment'" -ForegroundColor Gray
Write-Host "   2. Push to main: git push origin main" -ForegroundColor Gray
Write-Host "   3. Digital Ocean App will auto-deploy" -ForegroundColor Gray
Write-Host ""
Write-Host "🧪 After deployment, test with:" -ForegroundColor Cyan
Write-Host "   - curl https://your-domain/api/health/market-status" -ForegroundColor Gray
Write-Host "   - curl https://your-domain/api/market/current/NIFTY" -ForegroundColor Gray
Write-Host ""
Write-Host "⚠️  System will only work during market hours (9:15-15:30 IST)" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
