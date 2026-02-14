#!/bin/bash
# ========================================
# PRE-DEPLOYMENT CHECKLIST
# Run this before deploying to production
# ========================================

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   📋 PRE-DEPLOYMENT CHECKLIST                             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CHECKS_PASSED=0
CHECKS_FAILED=0
WARNINGS=0

function check_pass() {
    echo -e "${GREEN}✅ $1${NC}"
    ((CHECKS_PASSED++))
}

function check_fail() {
    echo -e "${RED}❌ $1${NC}"
    ((CHECKS_FAILED++))
}

function check_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    ((WARNINGS++))
}

function check_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. BACKEND ENVIRONMENT CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "backend/.env" ]; then
    check_fail "backend/.env file not found!"
else
    check_pass "backend/.env file exists"
    
    # Check critical variables
    source backend/.env 2>/dev/null
    
    # Zerodha credentials
    if [ -z "$ZERODHA_API_KEY" ] || [ "$ZERODHA_API_KEY" == "g5tyrnn1mlckrb6f" ]; then
        check_warn "ZERODHA_API_KEY not set or using default"
    else
        check_pass "ZERODHA_API_KEY is set"
    fi
    
    if [ -z "$ZERODHA_API_SECRET" ] || [ "$ZERODHA_API_SECRET" == "6cusjkixpyv7pii7c2rtei61ewcoxj3l" ]; then
        check_warn "ZERODHA_API_SECRET not set or using default"
    else
        check_pass "ZERODHA_API_SECRET is set"
    fi
    
    # JWT Secret
    if [ -z "$JWT_SECRET" ]; then
        check_fail "JWT_SECRET is not set!"
    elif [ ${#JWT_SECRET} -lt 32 ]; then
        check_warn "JWT_SECRET is too short (should be 32+ chars)"
    else
        check_pass "JWT_SECRET is properly set"
    fi
    
    # Production URLs
    if [[ "$REDIRECT_URL" == *"localhost"* ]]; then
        check_warn "REDIRECT_URL still points to localhost"
    elif [[ "$REDIRECT_URL" == *"mydailytradesignals.com"* ]]; then
        check_pass "REDIRECT_URL is set for production"
    else
        check_info "REDIRECT_URL: $REDIRECT_URL"
    fi
    
    if [[ "$FRONTEND_URL" == *"localhost"* ]]; then
        check_warn "FRONTEND_URL still points to localhost"
    elif [[ "$FRONTEND_URL" == *"mydailytradesignals.com"* ]]; then
        check_pass "FRONTEND_URL is set for production"
    else
        check_info "FRONTEND_URL: $FRONTEND_URL"
    fi
    
    # CORS
    if [[ "$CORS_ORIGINS" == *"localhost"* ]]; then
        check_warn "CORS_ORIGINS includes localhost (should be production domain only)"
    elif [[ "$CORS_ORIGINS" == *"mydailytradesignals.com"* ]]; then
        check_pass "CORS_ORIGINS is set for production"
    else
        check_info "CORS_ORIGINS: $CORS_ORIGINS"
    fi
    
    # Scheduler
    if [ "$ENABLE_SCHEDULER" == "true" ]; then
        check_pass "Market Hours Scheduler is ENABLED"
    else
        check_fail "Market Hours Scheduler is DISABLED (should be true for production)"
    fi
    
    # Debug mode
    if [ "$DEBUG" == "False" ] || [ "$DEBUG" == "false" ]; then
        check_pass "DEBUG mode is OFF (production ready)"
    else
        check_warn "DEBUG mode is ON (should be False for production)"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. FRONTEND ENVIRONMENT CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "frontend/.env.local" ]; then
    check_warn "frontend/.env.local file not found (OK if deploying to Vercel)"
else
    check_pass "frontend/.env.local file exists"
    
    source frontend/.env.local 2>/dev/null
    
    if [[ "$NEXT_PUBLIC_API_URL" == *"localhost"* ]]; then
        check_warn "NEXT_PUBLIC_API_URL points to localhost"
    elif [[ "$NEXT_PUBLIC_API_URL" == *"mydailytradesignals.com"* ]]; then
        check_pass "NEXT_PUBLIC_API_URL is set for production"
    else
        check_info "NEXT_PUBLIC_API_URL: $NEXT_PUBLIC_API_URL"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. DOCKER CONFIGURATION CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "docker-compose.prod.yml" ]; then
    check_fail "docker-compose.prod.yml not found!"
else
    check_pass "docker-compose.prod.yml exists"
    
    # Check restart policies
    restart_count=$(grep -c "restart: unless-stopped" docker-compose.prod.yml || true)
    if [ "$restart_count" -ge 2 ]; then
        check_pass "Restart policies configured ($restart_count services)"
    else
        check_warn "Some services may not have restart policies"
    fi
fi

if [ ! -f "backend/Dockerfile" ]; then
    check_fail "backend/Dockerfile not found!"
else
    check_pass "backend/Dockerfile exists"
fi

if [ ! -f "frontend/Dockerfile" ]; then
    check_warn "frontend/Dockerfile not found (OK if using Vercel)"
else
    check_pass "frontend/Dockerfile exists"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. DEPLOYMENT SCRIPTS CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "quick_production_fix.sh" ]; then
    check_warn "quick_production_fix.sh not found"
else
    check_pass "quick_production_fix.sh exists"
    if [ -x "quick_production_fix.sh" ]; then
        check_pass "quick_production_fix.sh is executable"
    else
        check_warn "quick_production_fix.sh is not executable (chmod +x needed)"
    fi
fi

if [ ! -f "scripts/enable-docker-autostart.sh" ]; then
    check_warn "scripts/enable-docker-autostart.sh not found"
else
    check_pass "scripts/enable-docker-autostart.sh exists"
fi

if [ ! -f "scripts/setup-production-service.sh" ]; then
    check_warn "scripts/setup-production-service.sh not found"
else
    check_pass "scripts/setup-production-service.sh exists"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5. DOCUMENTATION CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "PRODUCTION_AUTOSTART_FIX.md" ]; then
    check_warn "PRODUCTION_AUTOSTART_FIX.md not found"
else
    check_pass "PRODUCTION_AUTOSTART_FIX.md exists"
fi

if [ ! -f "URGENT_AUTOSTART_FIX.md" ]; then
    check_warn "URGENT_AUTOSTART_FIX.md not found"
else
    check_pass "URGENT_AUTOSTART_FIX.md exists"
fi

if [ ! -f "README.md" ]; then
    check_warn "README.md not found"
else
    check_pass "README.md exists"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}✅ Passed:  $CHECKS_PASSED${NC}"
echo -e "${YELLOW}⚠️  Warnings: $WARNINGS${NC}"
echo -e "${RED}❌ Failed:  $CHECKS_FAILED${NC}"
echo ""

if [ $CHECKS_FAILED -gt 0 ]; then
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ DEPLOYMENT BLOCKED - Fix critical issues first!${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
elif [ $WARNINGS -gt 3 ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠️  REVIEW WARNINGS - Some settings may need attention${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "You can proceed, but review the warnings above."
    exit 0
else
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ ALL CHECKS PASSED - Ready for deployment!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Push to GitHub: git push origin main"
    echo "   2. SSH to server: ssh root@your_droplet_ip"
    echo "   3. Run fix: sudo bash quick_production_fix.sh"
    echo ""
    exit 0
fi
