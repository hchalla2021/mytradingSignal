#!/bin/bash
# 🚀 PRE-PRODUCTION VERIFICATION SCRIPT
# Scans entire project and verifies production readiness

echo "╔══════════════════════════════════════════════════════╗"
echo "║   🚀 PRODUCTION READINESS VERIFICATION              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

# Helper functions
check_passed() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    ((PASSED++))
}

check_failed() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    ((FAILED++))
}

check_warning() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
}

# ============= SECTION 1: CODE QUALITY =============
echo -e "\n${BLUE}[1/6] CODE QUALITY SCAN${NC}"
echo "────────────────────────"

# Check for console.logs in production components
CONSOLE_LOGS=$(grep -r "console\\.log" frontend/components/*.tsx backend/**/*.py 2>/dev/null | grep -v test | wc -l)
if [ "$CONSOLE_LOGS" -eq 0 ]; then
    check_passed "No console.logs in production code"
else
    check_warning "Found $CONSOLE_LOGS console.logs (should be removed before deployment)"
fi

# Check for hardcoded URLs (other than comments)
HARDCODED_URLS=$(grep -r "http://localhost\|http://127\|https://test" frontend/components/*.tsx --include="*.tsx" 2>/dev/null | grep -v "\/\/" | wc -l)
if [ "$HARDCODED_URLS" -eq 0 ]; then
    check_passed "No hardcoded localhost URLs in components"
else
    check_warning "Found $HARDCODED_URLS hardcoded URLs"
fi

# Check for test/dummy data in main code
DUMMY_DATA=$(grep -r "DEMO\|dummy\|fake_data\|test_data" frontend/components/*.tsx backend/routers/*.py 2>/dev/null | grep -v "test_" | grep -v ".bak" | wc -l)
if [ "$DUMMY_DATA" -eq 0 ]; then
    check_passed "No dummy or test data in production components"
else
    check_warning "Found references to dummy/test data: $DUMMY_DATA"
fi

# ============= SECTION 2: ENVIRONMENT CONFIG =============
echo -e "\n${BLUE}[2/6] ENVIRONMENT CONFIGURATION${NC}"
echo "────────────────────────────────"

# Check if .env template exists
if [ -f "backend/.env.market" ]; then
    check_passed "Backend environment template exists (.env.market)"
else
    check_failed "Backend environment template missing"
fi

# Check if frontend env detection is properly configured
if grep -q "NEXT_PUBLIC_PRODUCTION_API_URL\|NEXT_PUBLIC_LOCAL_API_URL" frontend/lib/env-detection.ts; then
    check_passed "Frontend environment detection configured"
else
    check_failed "Frontend environment detection not properly set"
fi

# Check for required env variables in code
REQUIRED_VARS=("ZERODHA_API_KEY" "ZERODHA_API_SECRET" "ZERODHA_ACCESS_TOKEN" "JWT_SECRET" "REDIS_URL")
for var in "${REQUIRED_VARS[@]}"; do
    if grep -q "$var" backend/config/production.py; then
        check_passed "Required variable $var referenced in config"
    else
        check_failed "Required variable $var NOT found in config"
    fi
done

# ============= SECTION 3: WEBSOCKET & DATA FEED =============
echo -e "\n${BLUE}[3/6] WEBSOCKET & DATA FEED${NC}"
echo "─────────────────────────"

# Check WebSocket implementation uses environment URLs
if grep -q "NEXT_PUBLIC_\|process.env\|getWebSocketURL" frontend/hooks/useMarketSocket.ts frontend/hooks/useProductionMarketSocket.ts 2>/dev/null; then
    check_passed "WebSocket uses environment-based URLs"
else
    check_failed "WebSocket may have hardcoded URLs"
fi

# Check for Zerodha API integration
if grep -q "KiteTicker\|kws\|websocket" backend/services/*.py backend/main.py 2>/dev/null; then
    check_passed "Zerodha WebSocket integration found"
else
    check_warning "Zerodha WebSocket integration not found (check if installed)"
fi

# Check for cache fallback mechanism
if grep -q "localStorage\|redis\|cache" frontend/hooks/useMarketSocket.ts 2>/dev/null; then
    check_passed "Cache fallback mechanism configured"
else
    check_failed "Cache fallback not found"
fi

# ============= SECTION 4: SIGNAL SYSTEM =============
echo -e "\n${BLUE}[4/6] SIGNAL SYSTEM (16 SIGNALS)${NC}"
echo "────────────────────────────────"

# Check for VWAP integration
if grep -q "vwapReaction\|VWAP\|Section 15" frontend/app/page.tsx; then
    check_passed "VWAP Reaction signal (#15) integrated"
else
    check_failed "VWAP Reaction signal NOT found"
fi

# Check for VERY GOOD VOLUME integration
if grep -q "isVeryGoodVolume\|VERY_GOOD_VOLUME\|Section 16" frontend/app/page.tsx; then
    check_passed "VERY GOOD VOLUME signal (#16) integrated"
else
    check_failed "VERY GOOD VOLUME signal NOT found"
fi

# Check 16-signal aggregation
if grep -q "16 Signals\|/16 signals" frontend/app/page.tsx; then
    check_passed "16-signal aggregation system active"
else
    check_warning "Signal count may not be updated to /16"
fi

# Check for market structure integration
if grep -q "MarketStructure\|RANGE" frontend/app/page.tsx; then
    check_passed "Market Structure component integrated"
else
    check_failed "Market Structure component NOT found"
fi

# ============= SECTION 5: SECURITY =============
echo -e "\n${BLUE}[5/6] SECURITY CHECKS${NC}"
echo "───────────────────"

# Check for hardcoded secrets
SECRETS=$(grep -r "password.*=.*['\"]" backend/**/*.py frontend/**/*.tsx 2>/dev/null | grep -v "os.getenv\|process.env" | wc -l)
if [ "$SECRETS" -eq 0 ]; then
    check_passed "No hardcoded secrets found"
else
    check_failed "Found $SECRETS potential hardcoded secrets"
fi

# Check JWT uses environment variable
if grep -q "JWT_SECRET.*os.getenv\|JWT_SECRET.*process.env" backend/config/production.py; then
    check_passed "JWT_SECRET loaded from environment"
else
    check_failed "JWT_SECRET may be hardcoded"
fi

# Check CORS is environment-based
if grep -q "CORS_ORIGINS.*os.getenv" backend/main.py backend/config/production.py 2>/dev/null; then
    check_passed "CORS configuration is environment-based"
else
    check_warning "CORS configuration source unclear"
fi

# ============= SECTION 6: BUILD & DEPLOYMENT =============
echo -e "\n${BLUE}[6/6] BUILD & DEPLOYMENT${NC}"
echo "───────────────────────"

# Check package.json exists and has build script
if grep -q "\"build\":" frontend/package.json; then
    check_passed "Frontend build script configured"
else
    check_failed "Frontend build script NOT found"
fi

# Check requirements.txt exists
if [ -f "backend/requirements.txt" ]; then
    check_passed "Backend requirements.txt exists"
else
    check_failed "Backend requirements.txt missing"
fi

# Check for Docker support
if [ -f "docker-compose.prod.yml" ]; then
    check_passed "Docker Compose production config exists"
else
    check_warning "Docker Compose production config not found"
fi

# Check Dockerfile exists
if [ -f "backend/Dockerfile" ] && [ -f "frontend/Dockerfile" ]; then
    check_passed "Both Dockerfiles present"
else
    check_warning "Dockerfile(s) missing (optional if not using Docker)"
fi

# ============= SUMMARY =============
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║               🎯 VERIFICATION SUMMARY                ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo -e "  ${GREEN}✅ PASSED: $PASSED${NC}"
echo -e "  ${RED}❌ FAILED: $FAILED${NC}"
echo ""

if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}✅ PROJECT IS READY FOR PRODUCTION DEPLOYMENT${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Configure backend/.env with Zerodha credentials"
    echo "  2. Configure frontend/.env.local with production URLs"
    echo "  3. Run: docker-compose -f docker-compose.prod.yml up -d"
    echo "  4. Or manually:"
    echo "     - Backend: cd backend && uvicorn main:app --host 0.0.0.0 --port 8000"
    echo "     - Frontend: cd frontend && npm run build && npm start"
    exit 0
else
    echo -e "${RED}❌ FIX THE ABOVE FAILURES BEFORE DEPLOYMENT${NC}"
    exit 1
fi
