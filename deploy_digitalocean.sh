#!/usr/bin/env bash
# ==============================================================================
# Quick Deploy to Digital Ocean - Uses .env.digitalocean files
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

# Use Digital Ocean configs
echo "⚙️  Configuring for Digital Ocean..."
cp backend/.env.digitalocean backend/.env
cp frontend/.env.digitalocean frontend/.env.local

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
