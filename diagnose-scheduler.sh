#!/bin/bash

# ============================================================
# Auto-Start System Troubleshooting Script
# ============================================================
#
# Diagnoses common issues with market scheduler
# Run this to get detailed information about system status
#
# Usage: bash diagnose-scheduler.sh
# ============================================================

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ISSUES=0
WARNINGS=0

# Function to check and report
check() {
    local name=$1
    local cmd=$2
    local expected=$3
    
    echo -n "Checking: $name... "
    
    if eval "$cmd" &> /dev/null; then
        echo -e "${GREEN}✅ PASS${NC}"
        return 0
    else
        if [ "$expected" = "warn" ]; then
            echo -e "${YELLOW}⚠️  WARNING${NC}"
            ((WARNINGS++))
        else
            echo -e "${RED}❌ FAIL${NC}"
            ((ISSUES++))
        fi
        return 1
    fi
}

echo ""
echo "=========================================="
echo "🔍 Market Scheduler Diagnostics"
echo "=========================================="
echo ""

# ============ SYSTEM CHECKS ============
echo -e "${BLUE}[System Checks]${NC}"
echo ""

check "Node.js Installed" "command -v node"
check "PM2 Global" "command -v pm2"
check "npm" "command -v npm"

echo ""

# ============ PROJECT STRUCTURE checks ============
echo -e "${BLUE}[Project Structure]${NC}"
echo ""

check "Project Directory" "test -d /var/www/mytradingSignal"
check "Backend Directory" "test -d /var/www/mytradingSignal/backend"
check "Frontend Directory" "test -d /var/www/mytradingSignal/frontend"
check "Scheduler Script" "test -f /var/www/mytradingSignal/market-auto-start.js"

echo ""

# ============ DEPENDENCIES ============
echo -e "${BLUE}[Dependencies]${NC}"
echo ""

cd /var/www/mytradingSignal 2>/dev/null

if [ -d "node_modules/node-cron" ]; then
    echo -e "${GREEN}✅${NC} node-cron installed"
else
    echo -e "${RED}❌${NC} node-cron NOT installed"
    echo "   Fix: cd /var/www/mytradingSignal && npm install node-cron"
    ((ISSUES++))
fi

echo ""

# ============ LOG DIRECTORY ============
echo -e "${BLUE}[Log Directory]${NC}"
echo ""

if [ -d "/var/log/mytradingSignal" ]; then
    echo -e "${GREEN}✅${NC} Log directory exists: /var/log/mytradingSignal"
    
    # Check permissions
    if [ -w "/var/log/mytradingSignal" ]; then
        echo -e "${GREEN}✅${NC} Log directory is writable"
    else
        echo -e "${RED}❌${NC} Log directory is NOT writable"
        echo "   Fix: sudo chmod 755 /var/log/mytradingSignal"
        ((ISSUES++))
    fi
    
    # Check log files
    echo ""
    echo "Log files:"
    ls -lh /var/log/mytradingSignal/ 2>/dev/null | tail -n +2 | while read line; do
        echo "   $line"
    done
else
    echo -e "${RED}❌${NC} Log directory does NOT exist"
    echo "   Fix: mkdir -p /var/log/mytradingSignal && chmod 755 /var/log/mytradingSignal"
    ((ISSUES++))
fi

echo ""

# ============ PM2 STATUS ============
echo -e "${BLUE}[PM2 Status]${NC}"
echo ""

if pm2 list | grep -q "market-scheduler"; then
    echo -e "${GREEN}✅${NC} Scheduler is registered in PM2"
    
    # Check if it's running
    if pm2 list | grep "market-scheduler" | grep -q "online"; then
        echo -e "${GREEN}✅${NC} Scheduler is RUNNING"
    else
        STATUS=$(pm2 list | grep "market-scheduler" | awk '{print $NF}')
        echo -e "${YELLOW}⚠️ Scheduler is $STATUS (not running)${NC}"
        ((WARNINGS++))
    fi
else
    echo -e "${RED}❌${NC} Scheduler NOT found in PM2"
    echo "   Fix: pm2 start /var/www/mytradingSignal/market-auto-start.js --name market-scheduler"
    ((ISSUES++))
fi

echo ""

# ============ BACKEND STATUS ============
echo -e "${BLUE}[Backend Status]${NC}"
echo ""

if pm2 list | grep -q "backend"; then
    echo -e "${GREEN}✅${NC} Backend is registered in PM2"
    
    # Check if it's running
    if pm2 list | grep "backend" | grep -q "online"; then
        echo -e "${GREEN}✅${NC} Backend is RUNNING"
    else
        STATUS=$(pm2 list | grep "backend" | awk '{print $NF}')
        echo -e "${YELLOW}⚠️ Backend is $STATUS${NC}"
        ((WARNINGS++))
    fi
else
    echo -e "${YELLOW}⚠️ Backend NOT found in PM2 (not started yet)${NC}"
fi

# Check if backend is listening
echo -n "Testing backend endpoint... "
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Responding${NC}"
else
    echo -e "${YELLOW}⚠️ Not responding (may be offline)${NC}"
    ((WARNINGS++))
fi

echo ""

# ============ TIMEZONE CHECK ============
echo -e "${BLUE}[Timezone Configuration]${NC}"
echo ""

TIMEZONE=$(timedatectl | grep "Time zone" | awk '{print $3}')
echo "Current timezone: $TIMEZONE"

if [[ "$TIMEZONE" == "Asia/Kolkata" ]]; then
    echo -e "${GREEN}✅${NC} Timezone is correct (Asia/Kolkata)"
else
    echo -e "${RED}❌${NC} Timezone is WRONG (expected Asia/Kolkata)"
    echo "   Fix: sudo timedatectl set-timezone Asia/Kolkata"
    ((ISSUES++))
fi

echo ""

# ============ CRON SCHEDULE CHECK ============
echo -e "${BLUE}[Scheduled Jobs (from code)]${NC}"
echo ""

if grep -q "MARKET_OPEN_HOUR" /var/www/mytradingSignal/market-auto-start.js; then
    MARKET_HOUR=$(grep "MARKET_OPEN_HOUR:" /var/www/mytradingSignal/market-auto-start.js | awk '{print $2}' | sed 's/,//')
    MARKET_MIN=$(grep "MARKET_OPEN_MINUTE:" /var/www/mytradingSignal/market-auto-start.js | awk '{print $2}' | sed 's/,//')
    
    echo "Market opens at: ${MARKET_HOUR}:${MARKET_MIN} IST"
    echo -e "${GREEN}✅${NC} Scheduler configured to start at market open time"
else
    echo -e "${YELLOW}⚠️ Could not verify market open time in config${NC}"
fi

echo ""

# ============ RECENT LOGS ============
echo -e "${BLUE}[Recent Activity (Last 20 lines)]${NC}"
echo ""

if [ -f "/var/log/mytradingSignal/market-scheduler.log" ]; then
    echo "Latest from market-scheduler.log:"
    tail -20 /var/log/mytradingSignal/market-scheduler.log | sed 's/^/  /'
else
    echo -e "${YELLOW}⚠️ market-scheduler.log not found${NC}"
fi

echo ""

# ============ PM2 STARTUP CONFIG ============
echo -e "${BLUE}[PM2 Startup Configuration]${NC}"
echo ""

if pm2 startup | grep -q "command to run on boot"; then
    echo -e "${GREEN}✅${NC} PM2 startup configured"
else
    echo -e "${YELLOW}⚠️ PM2 startup may not be configured${NC}"
    echo "   Fix: pm2 startup && pm2 save"
    ((WARNINGS++))
fi

echo ""

# ============ PM2 LIST ============
echo -e "${BLUE}[Current PM2 Process List]${NC}"
echo ""

pm2 list

echo ""

# ============ SUMMARY ============
echo "=========================================="
echo -e "${BLUE}[Summary]${NC}"
echo "=========================================="
echo ""

TOTAL=$((ISSUES + WARNINGS))

if [ $TOTAL -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed! System is healthy.${NC}"
    echo ""
    echo "Status: READY FOR MARKET OPEN"
    echo ""
    echo "Next steps:"
    echo "  • System will auto-start backend at 9:00 AM on trading days"
    echo "  • Monitor logs: tail -f /var/log/mytradingSignal/market-scheduler.log"
    echo "  • Check status: pm2 logs market-scheduler"
else
    echo -e "${RED}Issues found: $ISSUES${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
    fi
    
    echo ""
    echo "Fix the issues above before 9 AM market open"
    echo ""
    
    if [ $ISSUES -gt 0 ]; then
        echo -e "${RED}CRITICAL ISSUES (must fix):${NC}"
        echo "  See above for fix instructions"
    fi
    
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}WARNINGS (recommended to fix):${NC}"
        echo "  See above for details"
    fi
fi

echo ""
echo "=========================================="
echo ""

# Exit with appropriate code
exit $ISSUES
