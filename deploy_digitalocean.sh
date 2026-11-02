#!/usr/bin/env bash
# ==============================================================================
# Quick Deploy to Digital Ocean - Uses runtime backend settings
# Backend: backend/.env
# Frontend: same-origin API/WebSocket through the production reverse proxy
# ==============================================================================

set -eu  # Exit on error

echo "=============================================="
echo "🚀 Quick Deploy to Digital Ocean"
echo "=============================================="
echo ""

# Navigate to project
cd /root/mytradingSignal
export BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-backend/.env}"

# Pull latest code
echo "📥 Pulling latest code..."
git pull --ff-only origin main
source scripts/ensure-docker-compose.sh

# Backend secrets must be provisioned on the host, not committed.
echo "⚙️  Checking server-only configuration..."
bash scripts/check-production-env.sh "$BACKEND_ENV_FILE"
# Docker would create a directory for a missing bind-mounted token file.
touch backend/access_token.txt
"${COMPOSE[@]}" -f docker-compose.prod.yml config --quiet

# Rebuild
echo "🔨 Building (5-10 minutes)..."
"${COMPOSE[@]}" -f docker-compose.prod.yml build

# Start
echo "🚀 Starting services..."
"${COMPOSE[@]}" -f docker-compose.prod.yml up -d

# Wait and check
echo "⏳ Waiting for services..."
sleep 15

"${COMPOSE[@]}" -f docker-compose.prod.yml ps

# Test
echo ""
echo "🧪 Testing backend..."
curl --fail --show-error --connect-timeout 5 --max-time 15 http://localhost:8000/health

echo ""
echo "=============================================="
echo "Container startup completed; verify all services are healthy."
echo "=============================================="
echo ""
echo "📱 Test on:"
echo "  https://mydailytradesignals.com"
echo ""
echo "🧹 Clear browser cache or use Incognito mode"
echo ""
echo "📋 View logs:"
echo "  ${COMPOSE[*]} -f docker-compose.prod.yml logs -f"
echo ""
echo "=============================================="
echo "🔐 IMPORTANT: TOKEN AUTHENTICATION"
echo "=============================================="
echo ""
echo "⚠️  Zerodha tokens expire every 24 hours!"
echo ""
echo "🕐 DAILY ROUTINE (Weekdays):"
echo "  1. Login between 8:00-8:45 AM"
echo "  2. Visit: https://mydailytradesignals.com"
echo "  3. Click LOGIN button"
echo "  4. Complete Zerodha authentication"
echo ""
echo "✅ System will:"
echo "  - Check token at 8:50 AM"
echo "  - Connect at 8:55 AM (if token valid)"
echo "  - Start data flow at 9:00 AM"
echo ""
echo "🔴 If token expires:"
echo "  - System shows 'LOGIN REQUIRED'"
echo "  - NO reconnection loop spam"
echo "  - Just login to fix instantly"
echo ""
echo "📚 See: DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md"
echo "=============================================="
