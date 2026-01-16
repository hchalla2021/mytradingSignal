#!/bin/bash
# 🔥 Fix Production Cache Issue - Force Fresh Deployment
# Run this on Digital Ocean to clear all caches and deploy latest code

echo "🔥 Fixing Production Cache Issues..."
echo "═══════════════════════════════════════════════════════════"

cd /root/mytradingSignal

echo "📥 Step 1: Pull latest code from GitHub"
git pull origin main

echo "🛑 Step 2: Stop containers"
docker-compose -f docker-compose.prod.yml down

echo "🧹 Step 3: Remove ALL caches"
# Remove frontend build cache
rm -rf frontend/.next
rm -rf frontend/node_modules/.cache
rm -rf frontend/out

# Remove Docker volumes (if any)
docker volume prune -f

echo "🏗️  Step 4: Rebuild frontend with NO CACHE"
docker-compose -f docker-compose.prod.yml build --no-cache frontend

echo "🏗️  Step 5: Rebuild backend (quick)"
docker-compose -f docker-compose.prod.yml build backend

echo "🚀 Step 6: Start containers"
docker-compose -f docker-compose.prod.yml up -d

echo "⏳ Step 7: Wait for containers to be healthy (30 seconds)..."
sleep 30

echo "📊 Step 8: Check container status"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "✅ Deployment Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "🌐 Now do this on YOUR LAPTOP:"
echo "  1. Open Chrome/Edge"
echo "  2. Go to: https://mydailytradesignals.com"
echo "  3. Press: Ctrl+Shift+Delete (Windows) or Cmd+Shift+Delete (Mac)"
echo "  4. Select: 'Cached images and files'"
echo "  5. Click: 'Clear data'"
echo "  6. Press: Ctrl+F5 to hard refresh"
echo ""
echo "OR simply open in Incognito/Private mode:"
echo "  Chrome: Ctrl+Shift+N"
echo "  Edge: Ctrl+Shift+P"
echo ""
echo "📱 Mobile users: Tell them to:"
echo "  - Close browser app completely"
echo "  - Clear app cache in phone settings"
echo "  - Reopen browser and visit site"
echo ""
echo "🔍 Check logs if still issues:"
echo "  docker logs trading-frontend --tail 50"
echo "  docker logs trading-backend --tail 50"
