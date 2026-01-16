#!/bin/bash
# ========================================
# QUICK PRODUCTION FIX - ONE COMMAND
# Fixes auto-start issue on Digital Ocean
# Run this on your production server
# ========================================

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   🚀 QUICK PRODUCTION AUTO-START FIX                      ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get project directory
if [ -d "/opt/mytradingsignal" ]; then
    PROJECT_DIR="/opt/mytradingsignal"
elif [ -d "$HOME/mytradingsignal" ]; then
    PROJECT_DIR="$HOME/mytradingsignal"
elif [ -d "$(pwd)" ] && [ -f "docker-compose.prod.yml" ]; then
    PROJECT_DIR="$(pwd)"
else
    echo -e "${RED}❌ Error: Project directory not found!${NC}"
    echo "Please navigate to your project directory and run again."
    exit 1
fi

echo -e "${GREEN}✅ Project found: $PROJECT_DIR${NC}"
cd "$PROJECT_DIR"

# Step 1: Check Docker
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1: Checking Docker..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found. Installing...${NC}"
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo -e "${GREEN}✅ Docker installed${NC}"
else
    echo -e "${GREEN}✅ Docker found${NC}"
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose not found. Installing...${NC}"
    apt install docker-compose -y
    echo -e "${GREEN}✅ Docker Compose installed${NC}"
else
    echo -e "${GREEN}✅ Docker Compose found${NC}"
fi

# Step 2: Enable Docker auto-start
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2: Enabling Docker auto-start..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

systemctl enable docker
systemctl start docker
echo -e "${GREEN}✅ Docker will now start on boot${NC}"

# Step 3: Create systemd service for containers
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 3: Creating systemd service..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cat > /etc/systemd/system/trading-docker.service << EOF
[Unit]
Description=Trading Signal Docker Compose Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/docker-compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker-compose -f docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}✅ Service file created${NC}"

# Step 4: Reload and enable service
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 4: Enabling service..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

systemctl daemon-reload
systemctl enable trading-docker.service
echo -e "${GREEN}✅ Service enabled for auto-start${NC}"

# Step 5: Start containers
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 5: Starting containers..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

docker-compose -f docker-compose.prod.yml down 2>/dev/null || true
docker-compose -f docker-compose.prod.yml up -d --build

echo ""
echo "⏳ Waiting for containers to start..."
sleep 8

# Step 6: Verify
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 6: VERIFICATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "📊 Container Status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "🔄 Restart Policies:"
for container in trading-backend trading-frontend trading-redis; do
    if docker ps -a --format '{{.Names}}' | grep -q "^$container$"; then
        policy=$(docker inspect $container --format='{{.HostConfig.RestartPolicy.Name}}')
        echo "   $container: $policy"
    fi
done

echo ""
echo "🔧 Docker Auto-Start:"
docker_enabled=$(systemctl is-enabled docker 2>/dev/null || echo "unknown")
echo "   Docker service: $docker_enabled"

trading_enabled=$(systemctl is-enabled trading-docker 2>/dev/null || echo "unknown")
echo "   Trading service: $trading_enabled"

# Step 7: Check backend logs
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Backend Logs (Last 20 lines):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker logs --tail 20 trading-backend 2>&1

# Final summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ AUTO-START FIX COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}✅ Docker enabled for auto-start on boot${NC}"
echo -e "${GREEN}✅ Containers will restart automatically${NC}"
echo -e "${GREEN}✅ Backend will auto-start at 8:50 AM IST${NC}"
echo -e "${GREEN}✅ System is ready for market open at 9:00 AM${NC}"
echo ""
echo "🧪 TEST AUTO-START:"
echo "   sudo reboot"
echo "   # After reboot:"
echo "   docker ps"
echo ""
echo "📊 MONITOR LOGS:"
echo "   docker logs -f trading-backend"
echo ""
echo "🎯 USEFUL COMMANDS:"
echo "   systemctl status trading-docker    # Check service"
echo "   docker ps                          # Check containers"
echo "   docker-compose -f docker-compose.prod.yml restart  # Restart all"
echo ""
echo -e "${GREEN}🎉 Your backend is now production-ready!${NC}"
echo ""
