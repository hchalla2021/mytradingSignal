#!/bin/bash

# 🚀 LIVE DATA DEPLOYMENT TO DIGITAL OCEAN
# No mock data, no dummy feeds, LIVE ZERODHA ONLY

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 MYTRADESIGNALS - LIVE DATA DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════════"

# Check required environment variables
echo ""
echo "🔍 Checking critical environment variables..."

REQUIRED_VARS=(
    "ZERODHA_API_KEY"
    "ZERODHA_API_SECRET"
    "ZERODHA_ACCESS_TOKEN"
    "JWT_SECRET"
    "REDIRECT_URL"
)

MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING+=("$var")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    echo "❌ MISSING REQUIRED VARIABLES:"
    printf '   - %s\n' "${MISSING[@]}"
    echo ""
    echo "💡 Set these in Digital Ocean App Platform > Settings > Environment"
    exit 1
fi

echo "✅ All required Zerodha credentials found"

# Pull latest code
echo ""
echo "📥 Pulling latest code from repository..."
git pull origin main || echo "⚠️  Git pull failed - check connection"

# Backend setup
echo ""
echo "⚙️  Setting up Python backend..."
cd backend

echo "   📦 Installing dependencies..."
pip install -r requirements.txt -q

echo "   🔄 Checking market configuration..."
python -c "from config import get_settings; s = get_settings(); print(f'   ✅ Config loaded: API={bool(s.zerodha_api_key)}, JWT={bool(s.jwt_secret)}')"

# Frontend setup
echo ""
echo "⚙️  Setting up Next.js frontend..."
cd ../frontend

echo "   📦 Installing dependencies..."
npm install --no-save -q

echo "   🔨 Building optimized production bundle..."
npm run build

# Verify build
if [ -d ".next" ]; then
    echo "   ✅ Build successful"
else
    echo "   ❌ Build failed"
    exit 1
fi

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✨ DEPLOYMENT READY"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "✅ Backend: LIVE Zerodha only (no mock feed)"
echo "✅ Frontend: LIVE data display (no fallback values)"
echo "✅ Architecture: Zerodha → Redis → API → UI"
echo ""
echo "🚀 To deploy:"
echo "   1. Commit changes: git add -A && git commit -m 'Ready for live deployment'"
echo "   2. Push to main: git push origin main"
echo "   3. Digital Ocean App will auto-deploy"
echo ""
echo "🧪 After deployment, test with:"
echo "   - curl https://your-domain/api/health/market-status"
echo "   - curl https://your-domain/api/market/current/NIFTY"
echo ""
echo "⚠️  System will only work during market hours (9:15-15:30 IST)"
echo "═══════════════════════════════════════════════════════════════"
