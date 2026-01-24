#!/bin/bash
# ==============================================================================
# MyTradingSignal - Deploy to Digital Ocean
# ==============================================================================
# This script deploys the latest code to your Digital Ocean server
# and ensures the market feed auto-starts at 9 AM IST
# ==============================================================================

set -e

echo "=============================================="
echo "🚀 MyTradingSignal - Production Deployment"
echo "=============================================="
echo ""

# Configuration
REMOTE_HOST=${REMOTE_HOST:-"your-server-ip"}
REMOTE_USER=${REMOTE_USER:-"root"}
REMOTE_PATH=${REMOTE_PATH:-"/opt/mytradingsignal"}

echo "📍 Deploying to: $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH"
echo ""

# Sync code to server
echo "📦 Syncing code to server..."
rsync -avz --exclude '.git' \
           --exclude 'node_modules' \
           --exclude '.venv' \
           --exclude '__pycache__' \
           --exclude '.env' \
           --exclude '*.pyc' \
           ./ $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/

echo "✅ Code synced"
echo ""

# SSH into server and restart services
echo "🔄 Restarting Docker containers..."
ssh $REMOTE_USER@$REMOTE_HOST << 'ENDSSH'
    cd /opt/mytradingsignal
    
    echo "📋 Current container status:"
    docker-compose -f docker-compose.prod.yml ps
    
    echo ""
    echo "🔄 Rebuilding and restarting..."
    docker-compose -f docker-compose.prod.yml down
    docker-compose -f docker-compose.prod.yml build --no-cache backend
    docker-compose -f docker-compose.prod.yml up -d
    
    echo ""
    echo "📋 New container status:"
    docker-compose -f docker-compose.prod.yml ps
    
    echo ""
    echo "📝 Backend logs (last 20 lines):"
    sleep 5
    docker logs trading-backend --tail 20
    
    echo ""
    echo "✅ Deployment complete!"
ENDSSH

echo ""
echo "=============================================="
echo "🎉 DEPLOYMENT SUCCESSFUL!"
echo "=============================================="
echo ""
echo "📊 Your trading dashboard is now live at:"
echo "   https://mydailytradesignals.com"
echo ""
echo "⏰ AUTOMATIC MARKET HOURS:"
echo "   • 8:55 AM - System auto-starts feed"
echo "   • 9:00 AM - Pre-open data flows"
echo "   • 9:15 AM - Live trading data"
echo "   • 3:35 PM - System auto-stops"
echo ""
echo "🔐 If token is expired, login via UI"
echo "=============================================="
