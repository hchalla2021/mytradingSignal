#!/bin/bash

# 🚀 Complete Production Deployment Script for Digital Ocean
# Deploys both backend and frontend with all latest changes

set -e  # Exit on any error

echo "🚀 Starting Production Deployment to Digital Ocean..."
echo "═══════════════════════════════════════════════════════════"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
DROPLET_IP="your-droplet-ip"  # Replace with your Digital Ocean droplet IP
DEPLOY_USER="root"
PROJECT_PATH="/root/mytradingSignal"

echo -e "${YELLOW}📋 Pre-deployment Checklist:${NC}"
echo "  1. Backend running locally? Check localhost:8000/api/health"
echo "  2. Frontend running locally? Check localhost:3000"
echo "  3. All changes committed to git?"
echo "  4. Have Zerodha API credentials ready?"
echo ""
read -p "Continue with deployment? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    exit 1
fi

echo ""
echo -e "${GREEN}Step 1: Push latest changes to repository${NC}"
git add .
git status
read -p "Commit message: " commit_msg
git commit -m "$commit_msg" || echo "No changes to commit"
git push origin main

echo ""
echo -e "${GREEN}Step 2: SSH into Digital Ocean and pull latest code${NC}"
ssh ${DEPLOY_USER}@${DROPLET_IP} << 'ENDSSH'
    cd /root/mytradingSignal
    
    echo "📥 Pulling latest code..."
    git pull origin main
    
    echo "🛑 Stopping containers..."
    docker-compose -f docker-compose.prod.yml down
    
    echo "🧹 Cleaning old builds..."
    cd frontend
    rm -rf .next node_modules/.cache
    cd ..
    
    echo "🏗️  Building fresh containers..."
    docker-compose -f docker-compose.prod.yml build --no-cache
    
    echo "🚀 Starting containers..."
    docker-compose -f docker-compose.prod.yml up -d
    
    echo "⏳ Waiting for containers to be healthy..."
    sleep 10
    
    echo "📊 Container status:"
    docker-compose -f docker-compose.prod.yml ps
    
    echo ""
    echo "🔍 Backend logs (last 20 lines):"
    docker logs trading-backend --tail 20
    
    echo ""
    echo "🔍 Frontend logs (last 20 lines):"
    docker logs trading-frontend --tail 20
ENDSSH

echo ""
echo -e "${GREEN}Step 3: Health check${NC}"
echo "Testing backend..."
curl -f https://mydailytradesignals.com/api/health || echo -e "${RED}❌ Backend health check failed${NC}"

echo ""
echo "Testing frontend..."
curl -f https://mydailytradesignals.com || echo -e "${RED}❌ Frontend not accessible${NC}"

echo ""
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}📝 Post-Deployment Steps:${NC}"
echo "  1. Open: https://mydailytradesignals.com"
echo "  2. Check if data is loading"
echo "  3. If showing 'Token expired', run:"
echo "     ssh root@${DROPLET_IP}"
echo "     cd /root/mytradingSignal"
echo "     docker-compose -f docker-compose.prod.yml exec backend python generate_token_manual.py"
echo ""
echo -e "${YELLOW}🔧 Troubleshooting Commands:${NC}"
echo "  Check logs:"
echo "    docker logs trading-backend -f"
echo "    docker logs trading-frontend -f"
echo ""
echo "  Restart containers:"
echo "    docker-compose -f docker-compose.prod.yml restart"
echo ""
echo "  Check token status:"
echo "    curl https://mydailytradesignals.com/api/token-status"
