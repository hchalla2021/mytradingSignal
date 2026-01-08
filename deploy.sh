#!/bin/bash
# Quick Deployment Script for Digital Ocean
# Run this script from your local machine to deploy to production

set -e  # Exit on error

echo "======================================================================"
echo "🚀 MyDailyTradingSignals - Quick Deployment to Digital Ocean"
echo "======================================================================"
echo ""

# Configuration
DROPLET_IP="${DROPLET_IP:-your-droplet-ip}"  # Set this or pass as environment variable
DROPLET_USER="${DROPLET_USER:-root}"
APP_DIR="/var/www/mytradingSignal"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if DROPLET_IP is set
if [ "$DROPLET_IP" == "your-droplet-ip" ]; then
    echo -e "${RED}❌ Error: DROPLET_IP not set${NC}"
    echo ""
    echo "Usage:"
    echo "  export DROPLET_IP=your.droplet.ip.address"
    echo "  ./deploy.sh"
    echo ""
    echo "Or:"
    echo "  DROPLET_IP=your.droplet.ip.address ./deploy.sh"
    exit 1
fi

echo "📋 Deployment Configuration:"
echo "   Droplet IP: $DROPLET_IP"
echo "   User: $DROPLET_USER"
echo "   App Directory: $APP_DIR"
echo ""

# Step 1: Push code to Git
echo -e "${YELLOW}📤 Step 1: Pushing code to Git...${NC}"
git add .
git status
read -p "Commit message (or press Enter for default): " COMMIT_MSG
COMMIT_MSG=${COMMIT_MSG:-"Deploy: $(date +"%Y-%m-%d %H:%M:%S")"}
git commit -m "$COMMIT_MSG" || echo "No changes to commit"
git push origin main
echo -e "${GREEN}✅ Code pushed to Git${NC}"
echo ""

# Step 2: Deploy to Digital Ocean
echo -e "${YELLOW}📡 Step 2: Deploying to Digital Ocean...${NC}"

ssh $DROPLET_USER@$DROPLET_IP << 'ENDSSH'
set -e

echo ""
echo "🔄 Pulling latest code..."
cd /var/www/mytradingSignal
git pull origin main

echo ""
echo "🐍 Updating backend dependencies..."
cd backend
source venv/bin/activate
pip install -r requirements.txt --quiet

echo ""
echo "📦 Updating frontend dependencies..."
cd ../frontend
npm install --silent

echo ""
echo "🏗️ Building frontend..."
npm run build

echo ""
echo "🔄 Restarting services..."
sudo systemctl restart mytrading-backend
sudo systemctl restart mytrading-frontend

echo ""
echo "⏳ Waiting for services to start..."
sleep 5

echo ""
echo "📊 Service status:"
sudo systemctl status mytrading-backend --no-pager | head -n 10
sudo systemctl status mytrading-frontend --no-pager | head -n 10

echo ""
echo "✅ Deployment complete!"
ENDSSH

echo ""
echo -e "${GREEN}======================================================================"
echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "======================================================================${NC}"
echo ""
echo "🌐 Your app is live at: https://mydailytradesignals.com"
echo ""
echo "📋 Next steps:"
echo "   1. Check logs: ssh $DROPLET_USER@$DROPLET_IP 'journalctl -u mytrading-backend -n 50'"
echo "   2. Verify frontend: https://mydailytradesignals.com"
echo "   3. Test WebSocket: Open browser DevTools -> Network -> WS"
echo ""
echo "🔧 Troubleshooting:"
echo "   - Backend logs: journalctl -u mytrading-backend -f"
echo "   - Frontend logs: journalctl -u mytrading-frontend -f"
echo "   - Nginx logs: tail -f /var/log/nginx/error.log"
echo ""
