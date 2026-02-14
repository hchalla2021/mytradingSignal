#!/usr/bin/env bash
# ==============================================================================
# Quick Deploy to Digital Ocean - Uses standard .env files
# Backend: backend/.env
# Frontend: frontend/.env.local
# ==============================================================================

set -e  # Exit on error

echo "=============================================="
echo "🚀 Quick Deploy to Digital Ocean"
echo "=============================================="
echo ""

# Navigate to project
cd /root/mytradingSignal

# Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# NOTE: Using existing .env files (no copying needed)
# Backend: backend/.env (committed or set manually)
# Frontend: frontend/.env.local (committed or set manually)
echo "⚙️  Using existing configuration files..."
if [ ! -f backend/.env ]; then
    echo "❌ ERROR: backend/.env not found!"
    echo "   Create backend/.env with production settings"
    exit 1
fi
if [ ! -f frontend/.env.local ]; then
    echo "❌ ERROR: frontend/.env.local not found!"
    echo "   Create frontend/.env.local with production settings"
    exit 1
fi

# Stop containers
echo "🛑 Stopping containers..."
docker-compose -f docker-compose.prod.yml down

# Clear caches
echo "🧹 Clearing caches..."
docker rmi trading-frontend trading-backend 2>/dev/null || true
rm -rf frontend/.next
docker builder prune -f

# Rebuild
echo "🔨 Building (5-10 minutes)..."
docker-compose -f docker-compose.prod.yml build --no-cache

# Start
echo "🚀 Starting services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait and check
echo "⏳ Waiting for services..."
sleep 15

docker-compose -f docker-compose.prod.yml ps

# Test
echo ""
echo "🧪 Testing backend..."
curl -s http://localhost:8000/health | jq . || echo "Backend not ready yet"

echo ""
echo "=============================================="
echo "✅ DEPLOYMENT COMPLETE"
echo "=============================================="
echo ""
echo "📱 Test on:"
echo "  https://mydailytradesignals.com"
echo ""
echo "🧹 Clear browser cache or use Incognito mode"
echo ""
echo "📋 View logs:"
echo "  docker-compose -f docker-compose.prod.yml logs -f"
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
