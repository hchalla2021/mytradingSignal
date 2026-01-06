#!/bin/bash
# ========================================
# Quick Deploy Script - Auto-Start Fix
# Run this on your Digital Ocean server
# ========================================

echo ""
echo "════════════════════════════════════════════════════════"
echo "  🚀 DEPLOYING AUTO-START LIVE FEED FIX"
echo "════════════════════════════════════════════════════════"
echo ""

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Error: docker-compose.yml not found"
    echo "   Please run this script from /opt/mytradingsignal"
    exit 1
fi

# Pull latest code
echo "📥 Step 1/4: Pulling latest code from GitHub..."
git pull origin main

if [ $? -ne 0 ]; then
    echo "❌ Git pull failed. Please check your repository."
    exit 1
fi

echo "✅ Code updated"
echo ""

# Check if backend is running
echo "🔍 Step 2/4: Checking backend status..."
BACKEND_RUNNING=$(docker-compose ps | grep trading-backend | grep Up)

if [ -z "$BACKEND_RUNNING" ]; then
    echo "⚠️  Backend not running. Starting fresh..."
    docker-compose up -d backend
else
    echo "✅ Backend running. Restarting..."
    docker-compose restart backend
fi

echo ""

# Wait for backend to start
echo "⏳ Step 3/4: Waiting for backend to initialize (10 seconds)..."
sleep 10
echo "✅ Backend should be ready"
echo ""

# Check logs
echo "📊 Step 4/4: Checking logs for scheduler..."
echo "════════════════════════════════════════════════════════"
echo ""

docker-compose logs --tail=30 backend | grep -A 3 "Market Hours Scheduler"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  ✅ DEPLOYMENT COMPLETE!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "📅 Market Hours Scheduler Status:"
SCHEDULER_FOUND=$(docker-compose logs backend | grep "Market Hours Scheduler started")

if [ -n "$SCHEDULER_FOUND" ]; then
    echo "   ✅ Scheduler is ACTIVE"
    echo ""
    echo "🎯 What happens next:"
    echo "   • 8:55 AM IST → Token validation"
    echo "   • 9:00 AM IST → Auto-reconnect WebSocket"
    echo "   • 9:15 AM IST → Verify live data flowing"
    echo ""
    echo "✅ No manual restart needed tomorrow!"
else
    echo "   ⚠️  Scheduler not detected in logs"
    echo "   Try: docker-compose logs -f backend"
fi

echo ""
echo "════════════════════════════════════════════════════════"
echo "📖 Documentation: docs/AUTO_START_LIVE_FEED_FIX.md"
echo "════════════════════════════════════════════════════════"
echo ""
