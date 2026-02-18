#!/bin/bash

# ============================================================
# QUICK START: Market Auto-Start System
# ============================================================
#
# This script sets up automatic backend startup at 9 AM
# Run this once on your DigitalOcean server
#
# Usage: bash setup-auto-start.sh
# ============================================================

echo "🚀 Setting up Market Auto-Start System..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
PROJECT_PATH="/var/www/mytradingSignal"
LOG_DIR="/var/log/mytradingSignal"

# ============================================================
# STEP 1: Check prerequisites
# ============================================================
echo -e "${BLUE}[Step 1]${NC} Checking prerequisites..."

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 not found. Installing...${NC}"
    npm install -g pm2
else
    echo -e "${GREEN}✅ PM2 found${NC}"
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js first.${NC}"
    exit 1
else
    echo -e "${GREEN}✅ Node.js found${NC}"
fi

# Check if project exists
if [ ! -d "$PROJECT_PATH" ]; then
    echo -e "${RED}❌ Project directory not found: $PROJECT_PATH${NC}"
    exit 1
else
    echo -e "${GREEN}✅ Project directory found${NC}"
fi

echo ""

# ============================================================
# STEP 2: Install dependencies
# ============================================================
echo -e "${BLUE}[Step 2]${NC} Installing required npm packages..."

cd "$PROJECT_PATH"

# Check if node-cron is installed
if ! npm list node-cron &> /dev/null; then
    echo "Installing node-cron..."
    npm install node-cron --save
    echo -e "${GREEN}✅ node-cron installed${NC}"
else
    echo -e "${GREEN}✅ node-cron already installed${NC}"
fi

echo ""

# ============================================================
# STEP 3: Create log directory
# ============================================================
echo -e "${BLUE}[Step 3]${NC} Creating log directory..."

if [ ! -d "$LOG_DIR" ]; then
    mkdir -p "$LOG_DIR"
    chmod 755 "$LOG_DIR"
    echo -e "${GREEN}✅ Log directory created: $LOG_DIR${NC}"
else
    echo -e "${GREEN}✅ Log directory already exists${NC}"
fi

echo ""

# ============================================================
# STEP 4: Deploy scheduler script
# ============================================================
echo -e "${BLUE}[Step 4]${NC} Verifying scheduler script..."

if [ ! -f "$PROJECT_PATH/market-auto-start.js" ]; then
    echo -e "${RED}❌ market-auto-start.js not found${NC}"
    echo "Make sure market-auto-start.js is in: $PROJECT_PATH"
    exit 1
else
    echo -e "${GREEN}✅ market-auto-start.js found${NC}"
fi

echo ""

# ============================================================
# STEP 5: Start scheduler with PM2
# ============================================================
echo -e "${BLUE}[Step 5]${NC} Starting scheduler with PM2..."

# Stop if already running
pm2 delete market-scheduler 2>/dev/null

# Start the scheduler
cd "$PROJECT_PATH"
pm2 start market-auto-start.js --name "market-scheduler"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Scheduler started successfully${NC}"
else
    echo -e "${RED}❌ Failed to start scheduler${NC}"
    exit 1
fi

echo ""

# ============================================================
# STEP 6: Save PM2 config for startup
# ============================================================
echo -e "${BLUE}[Step 6]${NC} Saving PM2 configuration..."

pm2 save

# Setup PM2 startup
sudo pm2 startup -u root --hp /root
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ PM2 startup configured${NC}"
else
    echo -e "${RED}⚠️  Could not configure PM2 startup (may need sudo)${NC}"
    echo "Run manually: sudo pm2 startup -u root --hp /root"
fi

echo ""

# ============================================================
# STEP 7: Verification
# ============================================================
echo -e "${BLUE}[Step 7]${NC} Verifying installation..."

echo ""
echo "PM2 Status:"
pm2 list

echo ""
echo "Scheduler Logs (last 10 lines):"
pm2 logs market-scheduler --lines 10

echo ""

# ============================================================
# COMPLETION
# ============================================================
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo ""
echo "📋 Summary:"
echo "  • Scheduler: market-scheduler (PM2)"
echo "  • Script: $PROJECT_PATH/market-auto-start.js"
echo "  • Log: $LOG_DIR/market-scheduler.log"
echo "  • Status: View with 'pm2 logs market-scheduler'"
echo ""
echo "🕐 Daily Timeline:"
echo "  📻 9:00 AM - Market opens (pre-open, values frozen)"
echo "  📈 9:15 AM - Live trading starts (values streaming)"
echo "  🔴 3:30 PM - Market closes"
echo ""
echo "🔧 Common Commands:"
echo "  • View logs: pm2 logs market-scheduler"
echo "  • Restart: pm2 restart market-scheduler"
echo "  • Status: pm2 status"
echo "  • Stop: pm2 stop market-scheduler"
echo ""
echo "✨ Scheduler will automatically start backend every market day at 9 AM!"
echo ""
