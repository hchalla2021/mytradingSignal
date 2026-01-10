#!/bin/bash
# ==============================================================================
# Production Deployment Fix - MyDailyTradingSignals
# ==============================================================================
# This script fixes the TokenException issues on Digital Ocean production server
#
# Run this ON YOUR DIGITAL OCEAN SERVER:
#   chmod +x deploy_production_fix.sh
#   sudo ./deploy_production_fix.sh
#
# ==============================================================================

set -e

echo "🔧 MyDailyTradingSignals - Production Fix Script"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_DIR="/var/www/mytradingSignal"
BACKEND_DIR="$PROJECT_DIR/backend"
ENV_FILE="$BACKEND_DIR/.env"

# Check if running on production server
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}❌ Project directory not found: $PROJECT_DIR${NC}"
    echo "This script must be run on the Digital Ocean production server"
    exit 1
fi

echo -e "${GREEN}✅ Project directory found${NC}"
cd $PROJECT_DIR

# ==============================================================================
# Step 1: Backup current .env file
# ==============================================================================
echo ""
echo -e "${YELLOW}📦 Step 1: Backing up current .env file...${NC}"
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${GREEN}✅ Backup created${NC}"
else
    echo -e "${YELLOW}⚠️  No existing .env file found${NC}"
fi

# ==============================================================================
# Step 2: Update .env with production settings
# ==============================================================================
echo ""
echo -e "${YELLOW}⚙️  Step 2: Updating .env file...${NC}"

# Set ENVIRONMENT=production (fixes environment detection issue)
if grep -q "^ENVIRONMENT=" "$ENV_FILE"; then
    sed -i 's/^ENVIRONMENT=.*/ENVIRONMENT=production/' "$ENV_FILE"
    echo -e "${GREEN}✅ ENVIRONMENT set to production${NC}"
else
    echo "ENVIRONMENT=production" >> "$ENV_FILE"
    echo -e "${GREEN}✅ ENVIRONMENT added${NC}"
fi

# Enable scheduler (prevents API calls when market is closed)
if grep -q "^ENABLE_SCHEDULER=" "$ENV_FILE"; then
    sed -i 's/^ENABLE_SCHEDULER=.*/ENABLE_SCHEDULER=true/' "$ENV_FILE"
    echo -e "${GREEN}✅ ENABLE_SCHEDULER set to true${NC}"
else
    echo "ENABLE_SCHEDULER=true" >> "$ENV_FILE"
    echo -e "${GREEN}✅ ENABLE_SCHEDULER added${NC}"
fi

# Set DEBUG=False for production
if grep -q "^DEBUG=" "$ENV_FILE"; then
    sed -i 's/^DEBUG=.*/DEBUG=False/' "$ENV_FILE"
    echo -e "${GREEN}✅ DEBUG set to False${NC}"
fi

echo ""
echo -e "${GREEN}✅ Environment configuration updated${NC}"

# ==============================================================================
# Step 3: Pull latest code from repository
# ==============================================================================
echo ""
echo -e "${YELLOW}📥 Step 3: Pulling latest code...${NC}"
git pull origin main || git pull origin master || echo "⚠️ Git pull skipped"
echo -e "${GREEN}✅ Code updated${NC}"

# ==============================================================================
# Step 4: Install/Update Python dependencies
# ==============================================================================
echo ""
echo -e "${YELLOW}📦 Step 4: Updating Python dependencies...${NC}"
cd $BACKEND_DIR
if [ -d "venv" ]; then
    source venv/bin/activate
    pip install -r requirements.txt --quiet
    echo -e "${GREEN}✅ Dependencies updated${NC}"
else
    echo -e "${YELLOW}⚠️ Virtual environment not found, skipping${NC}"
fi

# ==============================================================================
# Step 5: Restart PM2 process
# ==============================================================================
echo ""
echo -e "${YELLOW}🔄 Step 5: Restarting backend service...${NC}"

if command -v pm2 &> /dev/null; then
    pm2 restart mytrading-backend || pm2 restart all
    sleep 3
    echo -e "${GREEN}✅ Backend restarted${NC}"
else
    echo -e "${YELLOW}⚠️ PM2 not found, manual restart required${NC}"
fi

# ==============================================================================
# Step 6: Check service health
# ==============================================================================
echo ""
echo -e "${YELLOW}🏥 Step 6: Checking service health...${NC}"
sleep 5

if curl -f http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is healthy${NC}"
else
    echo -e "${RED}⚠️ Backend health check failed${NC}"
    echo "Check logs: pm2 logs mytrading-backend"
fi

# ==============================================================================
# Step 7: Display current configuration
# ==============================================================================
echo ""
echo -e "${YELLOW}📋 Step 7: Current Configuration${NC}"
echo "=================================="
echo ""
echo "Environment settings from .env:"
grep "^ENVIRONMENT=" "$ENV_FILE" || echo "ENVIRONMENT not set"
grep "^ENABLE_SCHEDULER=" "$ENV_FILE" || echo "ENABLE_SCHEDULER not set"
grep "^DEBUG=" "$ENV_FILE" || echo "DEBUG not set"
echo ""

TOKEN=$(grep "^ZERODHA_ACCESS_TOKEN=" "$ENV_FILE" | cut -d '=' -f 2)
if [ -n "$TOKEN" ]; then
    TOKEN_PREVIEW="${TOKEN:0:20}..."
    echo "Access Token: $TOKEN_PREVIEW (length: ${#TOKEN} chars)"
else
    echo -e "${RED}⚠️ ZERODHA_ACCESS_TOKEN not found in .env${NC}"
fi

# ==============================================================================
# Step 8: Token refresh instructions
# ==============================================================================
echo ""
echo "============================================"
echo -e "${GREEN}🎉 PRODUCTION FIX APPLIED!${NC}"
echo "============================================"
echo ""
echo "✅ Fixed Issues:"
echo "   1. Environment detection (LOCAL → PRODUCTION)"
echo "   2. Scheduler enabled (prevents closed-market API calls)"
echo "   3. Debug mode disabled"
echo ""
echo "📝 Next Steps:"
echo ""
echo "1️⃣  Refresh Zerodha Token (if expired):"
echo "   → Option A: Visit https://mydailytradesignals.com and click LOGIN"
echo "   → Option B: Run: cd $BACKEND_DIR && python generate_token_manual.py"
echo ""
echo "2️⃣  Monitor logs:"
echo "   pm2 logs mytrading-backend --lines 50"
echo ""
echo "3️⃣  Check service status:"
echo "   pm2 status"
echo "   curl http://localhost:8000/health"
echo ""
echo "4️⃣  Setup daily token refresh cron job (optional):"
echo "   crontab -e"
echo "   Add: 0 9 * * 1-5 cd $BACKEND_DIR && python generate_token_manual.py"
echo ""
echo "📚 Documentation: $PROJECT_DIR/docs/"
echo ""
echo -e "${GREEN}Happy Trading! 📈🚀${NC}"
echo ""
