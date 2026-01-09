#!/bin/bash
# Quick Deploy to Digital Ocean - MyDailyTradingSignals
# Run this script on your Digital Ocean droplet after initial setup

set -e  # Exit on any error

echo "🚀 MyDailyTradingSignals - Production Deployment Script"
echo "========================================================"
echo ""

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ Please run as root (sudo ./deploy_to_digital_ocean.sh)${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Running as root${NC}"
echo ""

# Step 1: Update system
echo -e "${YELLOW}📦 Step 1: Updating system packages...${NC}"
apt-get update
apt-get upgrade -y
echo -e "${GREEN}✅ System updated${NC}"
echo ""

# Step 2: Install Docker
echo -e "${YELLOW}🐳 Step 2: Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo -e "${GREEN}✅ Docker installed${NC}"
else
    echo -e "${GREEN}✅ Docker already installed${NC}"
fi
echo ""

# Step 3: Install Docker Compose
echo -e "${YELLOW}🐳 Step 3: Installing Docker Compose...${NC}"
if ! command -v docker-compose &> /dev/null; then
    apt-get install docker-compose -y
    echo -e "${GREEN}✅ Docker Compose installed${NC}"
else
    echo -e "${GREEN}✅ Docker Compose already installed${NC}"
fi
echo ""

# Step 4: Install Nginx
echo -e "${YELLOW}🌐 Step 4: Installing Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    apt-get install nginx -y
    echo -e "${GREEN}✅ Nginx installed${NC}"
else
    echo -e "${GREEN}✅ Nginx already installed${NC}"
fi
echo ""

# Step 5: Install Certbot for SSL
echo -e "${YELLOW}🔒 Step 5: Installing Certbot...${NC}"
if ! command -v certbot &> /dev/null; then
    apt-get install certbot python3-certbot-nginx -y
    echo -e "${GREEN}✅ Certbot installed${NC}"
else
    echo -e "${GREEN}✅ Certbot already installed${NC}"
fi
echo ""

# Step 6: Clone repository
echo -e "${YELLOW}📥 Step 6: Setting up project directory...${NC}"
PROJECT_DIR="/var/www/mytradingsignal"

if [ ! -d "$PROJECT_DIR" ]; then
    mkdir -p $PROJECT_DIR
    echo -e "${GREEN}✅ Project directory created: $PROJECT_DIR${NC}"
else
    echo -e "${GREEN}✅ Project directory exists${NC}"
fi
echo ""

# Step 7: Environment variables setup
echo -e "${YELLOW}⚙️  Step 7: Environment Variables Setup${NC}"
echo ""
echo -e "${RED}IMPORTANT: You need to create .env file manually!${NC}"
echo ""
echo "Copy the .env.production.template file and fill in:"
echo "  1. ZERODHA_API_KEY"
echo "  2. ZERODHA_API_SECRET"
echo "  3. JWT_SECRET (generate with: openssl rand -base64 32)"
echo "  4. Update domain names in CORS_ORIGINS"
echo "  5. Update NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL"
echo ""
read -p "Press Enter after you've created the .env file..."
echo ""

# Step 8: Check if .env exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Please create $PROJECT_DIR/.env file with your configuration"
    exit 1
fi
echo -e "${GREEN}✅ .env file found${NC}"
echo ""

# Step 9: Build and start Docker containers
echo -e "${YELLOW}🐳 Step 8: Building Docker containers...${NC}"
cd $PROJECT_DIR
docker-compose -f docker-compose.prod.yml up -d --build
echo -e "${GREEN}✅ Docker containers started${NC}"
echo ""

# Step 10: Wait for services to be ready
echo -e "${YELLOW}⏳ Step 9: Waiting for services to start (30 seconds)...${NC}"
sleep 30
echo -e "${GREEN}✅ Services should be ready${NC}"
echo ""

# Step 11: Check service health
echo -e "${YELLOW}🏥 Step 10: Checking service health...${NC}"
echo ""

# Check backend
if curl -f http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is healthy${NC}"
else
    echo -e "${RED}❌ Backend health check failed${NC}"
    echo "Check logs: docker-compose logs backend"
fi

# Check frontend
if curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend is healthy${NC}"
else
    echo -e "${RED}❌ Frontend health check failed${NC}"
    echo "Check logs: docker-compose logs frontend"
fi
echo ""

# Step 12: Nginx configuration
echo -e "${YELLOW}🌐 Step 11: Nginx Configuration${NC}"
echo ""
echo -e "${YELLOW}You need to:${NC}"
echo "  1. Create Nginx config: /etc/nginx/sites-available/mytradingsignal"
echo "  2. Enable site: ln -s /etc/nginx/sites-available/mytradingsignal /etc/nginx/sites-enabled/"
echo "  3. Test config: nginx -t"
echo "  4. Reload Nginx: systemctl reload nginx"
echo ""
echo "See PRODUCTION_READY_CHECKLIST.md for Nginx configuration template"
echo ""

# Step 13: SSL Certificate
echo -e "${YELLOW}🔒 Step 12: SSL Certificate Setup${NC}"
echo ""
echo "Run Certbot to get SSL certificates:"
echo "  certbot --nginx -d your-domain.com -d www.your-domain.com"
echo "  certbot --nginx -d api.your-domain.com"
echo ""

# Step 14: Firewall setup
echo -e "${YELLOW}🔥 Step 13: Setting up firewall...${NC}"
if command -v ufw &> /dev/null; then
    ufw allow 22    # SSH
    ufw allow 80    # HTTP
    ufw allow 443   # HTTPS
    ufw --force enable
    echo -e "${GREEN}✅ Firewall configured${NC}"
else
    echo -e "${YELLOW}⚠️  UFW not available, skipping firewall setup${NC}"
fi
echo ""

# Step 15: Token refresh cron job
echo -e "${YELLOW}⏰ Step 14: Daily Token Refresh Setup${NC}"
echo ""
echo "Create token refresh script:"
echo "  1. nano /root/scripts/refresh_token.sh"
echo "  2. Add cron job: crontab -e"
echo "  3. Add line: 0 9 * * 1-5 /root/scripts/refresh_token.sh"
echo ""
echo "See PRODUCTION_READY_CHECKLIST.md for complete script"
echo ""

# Final Summary
echo ""
echo "============================================"
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETE!${NC}"
echo "============================================"
echo ""
echo "Next Steps:"
echo "  1. Configure Nginx reverse proxy"
echo "  2. Setup SSL certificates with Certbot"
echo "  3. Create daily token refresh cron job"
echo "  4. Generate Zerodha access token: cd $PROJECT_DIR/backend && docker-compose exec backend python get_token.py"
echo ""
echo "View logs:"
echo "  docker-compose logs -f"
echo ""
echo "Check health:"
echo "  curl http://localhost:8000/health"
echo "  curl http://localhost:3000"
echo ""
echo "📚 Full documentation: $PROJECT_DIR/PRODUCTION_READY_CHECKLIST.md"
echo ""
echo -e "${GREEN}Happy Trading! 📈🚀${NC}"
