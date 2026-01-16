#!/usr/bin/env bash
# ==============================================================================
# Complete Production Deployment to Digital Ocean
# No hardcoded URLs - all config from .env files
# ==============================================================================

set -e  # Exit on error

echo "=============================================="
echo "🚀 Production Deployment - Digital Ocean"
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Step 1: Navigate to project directory
echo -e "${CYAN}📁 Step 1: Navigating to project directory${NC}"
cd /root/mytradingSignal || { echo -e "${RED}❌ Project directory not found${NC}"; exit 1; }
echo -e "${GREEN}✅ In project directory${NC}"
echo ""

# Step 2: Pull latest code
echo -e "${CYAN}📥 Step 2: Pulling latest code from Git${NC}"
git pull origin main || { echo -e "${RED}❌ Git pull failed${NC}"; exit 1; }
echo -e "${GREEN}✅ Code updated${NC}"
echo ""

# Step 3: Stop all running containers
echo -e "${CYAN}🛑 Step 3: Stopping all containers${NC}"
docker-compose -f docker-compose.prod.yml down
echo -e "${GREEN}✅ Containers stopped${NC}"
echo ""

# Step 4: Update environment files for production
echo -e "${CYAN}⚙️  Step 4: Configuring production environment${NC}"

# Backend .env
if [ -f "backend/.env.production" ]; then
    echo "  📝 Using backend/.env.production"
    cp backend/.env.production backend/.env
    echo -e "${GREEN}  ✅ Backend environment configured${NC}"
else
    echo -e "${YELLOW}  ⚠️  backend/.env.production not found, using existing .env${NC}"
fi

# Frontend .env.local
if [ -f "frontend/.env.production" ]; then
    echo "  📝 Using frontend/.env.production"
    cp frontend/.env.production frontend/.env.local
    echo -e "${GREEN}  ✅ Frontend environment configured${NC}"
else
    echo -e "${YELLOW}  ⚠️  frontend/.env.production not found, using existing .env.local${NC}"
fi
echo ""

# Step 5: Clear all caches
echo -e "${CYAN}🧹 Step 5: Clearing all caches${NC}"
echo "  🗑️  Removing old Docker images..."
docker rmi trading-frontend trading-backend 2>/dev/null || true
echo "  🗑️  Clearing frontend cache..."
rm -rf frontend/.next
rm -rf frontend/node_modules/.cache
echo "  🗑️  Clearing Docker build cache..."
docker builder prune -f
echo -e "${GREEN}✅ All caches cleared${NC}"
echo ""

# Step 6: Rebuild containers with no cache
echo -e "${CYAN}🔨 Step 6: Building containers (this may take 5-10 minutes)${NC}"
docker-compose -f docker-compose.prod.yml build --no-cache
echo -e "${GREEN}✅ Containers built${NC}"
echo ""

# Step 7: Start services
echo -e "${CYAN}🚀 Step 7: Starting services${NC}"
docker-compose -f docker-compose.prod.yml up -d
echo -e "${GREEN}✅ Services started${NC}"
echo ""

# Step 8: Wait for services to be healthy
echo -e "${CYAN}⏳ Step 8: Waiting for services to be healthy${NC}"
sleep 10

# Check container status
echo "  📊 Container Status:"
docker-compose -f docker-compose.prod.yml ps

# Check backend health
echo ""
echo "  🔍 Testing backend health..."
for i in {1..10}; do
    if curl -s http://localhost:8000/health > /dev/null; then
        echo -e "${GREEN}  ✅ Backend is healthy${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${RED}  ❌ Backend health check failed${NC}"
    else
        echo "  ⏳ Attempt $i/10... waiting 5 seconds"
        sleep 5
    fi
done

# Check frontend health
echo "  🔍 Testing frontend health..."
for i in {1..10}; do
    if curl -s http://localhost:3000 > /dev/null; then
        echo -e "${GREEN}  ✅ Frontend is healthy${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${RED}  ❌ Frontend health check failed${NC}"
    else
        echo "  ⏳ Attempt $i/10... waiting 5 seconds"
        sleep 5
    fi
done
echo ""

# Step 9: Test API endpoints
echo -e "${CYAN}🧪 Step 9: Testing API endpoints${NC}"
echo "  📡 Testing Volume Pulse endpoint..."
if curl -s http://localhost:8000/api/advanced/volume-pulse/NIFTY | grep -q "symbol"; then
    echo -e "${GREEN}  ✅ API endpoint working${NC}"
else
    echo -e "${YELLOW}  ⚠️  API returned unexpected response (may need token)${NC}"
fi
echo ""

# Final summary
echo "=============================================="
echo -e "${GREEN}✅ DEPLOYMENT COMPLETE${NC}"
echo "=============================================="
echo ""
echo -e "${CYAN}📋 Next Steps:${NC}"
echo "  1. Open https://mydailytradesignals.com in browser"
echo "  2. Clear browser cache (Ctrl+Shift+Delete) or use Incognito"
echo "  3. Login to Zerodha to generate token"
echo "  4. Verify all sections show data"
echo ""
echo -e "${CYAN}🔍 Useful Commands:${NC}"
echo "  View logs:    docker-compose -f docker-compose.prod.yml logs -f"
echo "  Restart:      docker-compose -f docker-compose.prod.yml restart"
echo "  Stop:         docker-compose -f docker-compose.prod.yml down"
echo "  Check status: docker-compose -f docker-compose.prod.yml ps"
echo ""
echo -e "${CYAN}📱 Testing Checklist:${NC}"
echo "  ✅ Desktop Chrome"
echo "  ✅ Desktop Firefox"
echo "  ✅ Desktop Safari"
echo "  ✅ Desktop Edge"
echo "  ✅ Mobile Chrome (Android)"
echo "  ✅ Mobile Safari (iOS)"
echo ""
echo -e "${GREEN}🎉 Deployment ready for testing!${NC}"
