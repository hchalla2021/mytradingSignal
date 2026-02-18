#!/bin/bash

# ════════════════════════════════════════════════════════════════════════════
# 🚀 PRODUCTION DEPLOYMENT VERIFICATION SCRIPT
# For: MyDailyTradingSignals v1.0 (14 Signals • Live Data Only)
# ════════════════════════════════════════════════════════════════════════════

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║         🚀 PRODUCTION DEPLOYMENT VERIFICATION SCRIPT                       ║"
echo "║           MyDailyTradingSignals v1.0 - DigitalOcean Deployment             ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0

# ════════════════════════════════════════════════════════════════════════════
# Helper Functions
# ════════════════════════════════════════════════════════════════════════════

check_command() {
    local cmd=$1
    local name=$2
    echo -n "Checking $name... "
    if command -v $cmd &> /dev/null; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((FAILED++))
    fi
}

check_file() {
    local file=$1
    local name=$2
    echo -n "Checking $name... "
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL (File not found: $file)${NC}"
        ((FAILED++))
    fi
}

check_dir() {
    local dir=$1
    local name=$2
    echo -n "Checking $name... "
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL (Directory not found: $dir)${NC}"
        ((FAILED++))
    fi
}

check_service() {
    local service=$1
    local name=$2
    echo -n "Checking $name... "
    if systemctl is-active --quiet $service; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL (Service not running)${NC}"
        ((FAILED++))
    fi
}

check_port() {
    local port=$1
    local name=$2
    echo -n "Checking $name... "
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL (Port $port not listening)${NC}"
        ((FAILED++))
    fi
}

check_url() {
    local url=$1
    local name=$2
    echo -n "Checking $name... "
    if curl -s -f -o /dev/null -w "%{http_code}" "$url" | grep -q "200\|301"; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL (URL unreachable or error)${NC}"
        ((FAILED++))
    fi
}

check_env_var() {
    local var=$1
    local name=$2
    echo -n "Checking $name... "
    if [ ! -z "${!var}" ]; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL (Variable not set)${NC}"
        ((FAILED++))
    fi
}

# ════════════════════════════════════════════════════════════════════════════
# PART 1: System Requirements
# ════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}[1/8] SYSTEM REQUIREMENTS${NC}"
echo "─────────────────────────────────────────────────────────────────────────────"
check_command "python3" "Python 3"
check_command "pip3" "pip3"
check_command "node" "Node.js"
check_command "npm" "npm"
check_command "redis-cli" "Redis CLI"
check_command "nginx" "Nginx"
check_command "git" "Git"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# PART 2: Services Status
# ════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}[2/8] SERVICES STATUS${NC}"
echo "─────────────────────────────────────────────────────────────────────────────"
check_service "redis-server" "Redis Server"
check_service "nginx" "Nginx Web Server"
check_service "supervisor" "Supervisor Process Manager"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# PART 3: Ports & Connectivity
# ════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}[3/8] PORTS & CONNECTIVITY${NC}"
echo "─────────────────────────────────────────────────────────────────────────────"
check_port "6379" "Redis (6379)"
check_port "80" "HTTP (80)"
check_port "443" "HTTPS (443)"
check_port "8000" "Backend API (8000)"
echo -n "Checking Redis Connection... "
if redis-cli ping | grep -q "PONG"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL (Redis not responding)${NC}"
    ((FAILED++))
fi
echo ""

# ════════════════════════════════════════════════════════════════════════════
# PART 4: Project Structure
# ════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}[4/8] PROJECT STRUCTURE${NC}"
echo "─────────────────────────────────────────────────────────────────────────────"
check_dir "/var/www/mytradingSignal" "Project Root"
check_dir "/var/www/mytradingSignal/backend" "Backend Directory"
check_dir "/var/www/mytradingSignal/frontend" "Frontend Directory"
check_file "/var/www/mytradingSignal/backend/main.py" "Backend main.py"
check_file "/var/www/mytradingSignal/backend/requirements.txt" "Backend requirements.txt"
check_file "/var/www/mytradingSignal/frontend/package.json" "Frontend package.json"
check_file "/var/www/mytradingSignal/backend/.env" "Backend .env"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# PART 5: Backend Configuration
# ════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}[5/8] BACKEND CONFIGURATION${NC}"
echo "─────────────────────────────────────────────────────────────────────────────"

# Check .env file exists and has required variables
if [ -f "/var/www/mytradingSignal/backend/.env" ]; then
    source /var/www/mytradingSignal/backend/.env
    echo -n "Checking ZERODHA_API_KEY... "
    if [ ! -z "$ZERODHA_API_KEY" ]; then
        echo -e "${GREEN}✓ SET${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ NOT SET${NC}"
        ((FAILED++))
    fi
    
    echo -n "Checking ZERODHA_API_SECRET... "
    if [ ! -z "$ZERODHA_API_SECRET" ]; then
        echo -e "${GREEN}✓ SET${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ NOT SET${NC}"
        ((FAILED++))
    fi
    
    echo -n "Checking ZERODHA_ACCESS_TOKEN... "
    if [ ! -z "$ZERODHA_ACCESS_TOKEN" ]; then
        echo -e "${GREEN}✓ SET${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ NOT SET (Token needed for live data!)${NC}"
        ((FAILED++))
    fi
    
    echo -n "Checking REDIS_URL... "
    if [ ! -z "$REDIS_URL" ]; then
        echo -e "${GREEN}✓ SET${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ NOT SET${NC}"
        ((FAILED++))
    fi
    
    echo -n "Checking JWT_SECRET... "
    if [ ! -z "$JWT_SECRET" ]; then
        echo -e "${GREEN}✓ SET${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ NOT SET${NC}"
        ((FAILED++))
    fi
else
    echo -e "${RED}✗ FAIL (.env file not found)${NC}"
    ((FAILED++))
fi

echo -n "Checking Backend Process... "
if ps aux | grep -i "uvicorn.*main:app" | grep -v grep > /dev/null; then
    echo -e "${GREEN}✓ RUNNING${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ NOT RUNNING${NC}"
    ((FAILED++))
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# PART 6: Frontend Configuration
# ════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}[6/8] FRONTEND CONFIGURATION${NC}"
echo "─────────────────────────────────────────────────────────────────────────────"

if [ -f "/var/www/mytradingSignal/frontend/.env.local" ]; then
    source /var/www/mytradingSignal/frontend/.env.local
    
    echo -n "Checking NEXT_PUBLIC_API_URL... "
    if [ ! -z "$NEXT_PUBLIC_API_URL" ]; then
        echo -e "${GREEN}✓ SET${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ NOT SET${NC}"
        ((FAILED++))
    fi
    
    echo -n "Checking NEXT_PUBLIC_WS_URL... "
    if [ ! -z "$NEXT_PUBLIC_WS_URL" ]; then
        echo -e "${GREEN}✓ SET${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ NOT SET${NC}"
        ((FAILED++))
    fi
    
    echo -n "Checking NEXT_PUBLIC_MARKET_SYMBOLS... "
    if [ ! -z "$NEXT_PUBLIC_MARKET_SYMBOLS" ]; then
        echo -e "${GREEN}✓ SET${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ NOT SET${NC}"
        ((FAILED++))
    fi
else
    echo -e "${YELLOW}ℹ Info: .env.local file not found (might be build-time env)${NC}"
fi

echo -n "Checking frontend Next.js build... "
if [ -d "/var/www/mytradingSignal/frontend/.next" ]; then
    echo -e "${GREEN}✓ BUILD EXISTS${NC}"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠ WARNING: .next directory not found (run: npm run build)${NC}"
fi

echo -n "Checking Frontend Process (PM2)... "
if pm2 list | grep -q "trading-frontend"; then
    echo -e "${GREEN}✓ RUNNING${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ NOT RUNNING${NC}"
    ((FAILED++))
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# PART 7: API Endpoints Health Check
# ════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}[7/8] API ENDPOINTS HEALTH CHECK${NC}"
echo "─────────────────────────────────────────────────────────────────────────────"

echo -n "Checking Backend Health Endpoint... "
HEALTH_RESPONSE=$(curl -s http://127.0.0.1:8000/api/health)
if echo "$HEALTH_RESPONSE" | grep -q "status.*healthy"; then
    echo -e "${GREEN}✓ HEALTHY${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ UNHEALTHY${NC}"
    ((FAILED++))
fi

echo -n "Checking Market Analysis Endpoint... "
ANALYSIS_RESPONSE=$(curl -s http://127.0.0.1:8000/api/analysis/analyze/NIFTY)
if echo "$ANALYSIS_RESPONSE" | grep -q "signal\|price"; then
    echo -e "${GREEN}✓ RESPONDING${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ NOT RESPONDING${NC}"
    ((FAILED++))
fi

echo -n "Checking WebSocket Cache... "
WS_CACHE=$(curl -s http://127.0.0.1:8000/ws/cache/NIFTY)
if echo "$WS_CACHE" | grep -q "data\|price"; then
    echo -e "${GREEN}✓ WORKING${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ NOT WORKING${NC}"
    ((FAILED++))
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# PART 8: SSL & Security
# ════════════════════════════════════════════════════════════════════════════

echo -e "${BLUE}[8/8] SSL & SECURITY${NC}"
echo "─────────────────────────────────────────────────────────────────────────────"

echo -n "Checking SSL Certificate... "
if [ -f "/etc/letsencrypt/live" ]; then
    echo -e "${GREEN}✓ PRESENT${NC}"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠ WARNING: No SSL certificate found${NC}"
fi

echo -n "Checking Nginx Config... "
if nginx -t 2>/dev/null | grep -q "successful"; then
    echo -e "${GREEN}✓ VALID${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ INVALID${NC}"
    ((FAILED++))
fi

echo ""

# ════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════════════════════════

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                         DEPLOYMENT SUMMARY                                 ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "✓ Passed: ${GREEN}${PASSED}${NC}"
echo -e "✗ Failed: ${RED}${FAILED}${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL CHECKS PASSED! Deployment is ready.${NC}"
    echo ""
    echo "🚀 Next Steps:"
    echo "   1. Verify market data flowing: curl http://127.0.0.1:8000/api/analysis/analyze/NIFTY"
    echo "   2. Check frontend: https://your-domain.com"
    echo "   3. Monitor logs: tail -f /var/log/trading-backend.out.log"
    echo "   4. Set up daily token refresh: Update ZERODHA_ACCESS_TOKEN at 9:00 AM IST"
    echo ""
    exit 0
else
    echo -e "${RED}❌ ${FAILED} CHECKS FAILED!${NC}"
    echo ""
    echo "⚠️  Issues to fix:"
    echo "   • Check .env files are properly configured"
    echo "   • Verify Zerodha credentials and token are valid"
    echo "   • Ensure all services are running: systemctl status"
    echo "   • Review logs for errors: tail -f /var/log/*.log"
    echo ""
    exit 1
fi
