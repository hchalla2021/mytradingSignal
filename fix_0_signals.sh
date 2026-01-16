#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# fix_0_signals.sh - Comprehensive Diagnostic for "0/8 signals" Issue
# ═══════════════════════════════════════════════════════════════════════════════
# Problem: Overall Market Outlook shows "0/8 signals - Limited data"
# Cause: Backend APIs not returning data to frontend
# Solution: This script diagnoses and fixes all common issues
# ═══════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   🚨 DIAGNOSING: '0/8 signals - Limited data' Issue${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 1: Check Container Status
# ───────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}🔍 STEP 1: Checking Container Status...${NC}"
echo ""

BACKEND_STATUS=$(docker ps --filter "name=trading-backend" --format "{{.Status}}" 2>/dev/null)
REDIS_STATUS=$(docker ps --filter "name=trading-redis" --format "{{.Status}}" 2>/dev/null)
FRONTEND_STATUS=$(docker ps --filter "name=trading-frontend" --format "{{.Status}}" 2>/dev/null)

if [ -n "$BACKEND_STATUS" ]; then
    echo -e "   ${GREEN}✅ Backend:${NC} $BACKEND_STATUS"
else
    echo -e "   ${RED}❌ Backend: NOT RUNNING${NC}"
    echo ""
    echo -e "${YELLOW}→ Fix: Start backend container${NC}"
    echo -e "   ${BLUE}docker-compose -f docker-compose.prod.yml up -d backend${NC}"
fi

if [ -n "$REDIS_STATUS" ]; then
    echo -e "   ${GREEN}✅ Redis:${NC} $REDIS_STATUS"
else
    echo -e "   ${RED}❌ Redis: NOT RUNNING${NC}"
    echo ""
    echo -e "${YELLOW}→ Fix: Start Redis container${NC}"
    echo -e "   ${BLUE}docker-compose -f docker-compose.prod.yml up -d redis${NC}"
fi

if [ -n "$FRONTEND_STATUS" ]; then
    echo -e "   ${GREEN}✅ Frontend:${NC} $FRONTEND_STATUS"
else
    echo -e "   ${RED}❌ Frontend: NOT RUNNING${NC}"
fi

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────────────────────────${NC}"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 2: Test Backend API Endpoints
# ───────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}🔍 STEP 2: Testing Backend API Endpoints...${NC}"
echo ""

# Test aggregated endpoint
echo -e "   ${BLUE}Testing /api/advanced/all-analysis/NIFTY...${NC}"
ALL_ANALYSIS=$(curl -s -w "\n%{http_code}" http://localhost:8000/api/advanced/all-analysis/NIFTY 2>/dev/null)
HTTP_CODE=$(echo "$ALL_ANALYSIS" | tail -n 1)
RESPONSE=$(echo "$ALL_ANALYSIS" | sed '$d')

if [ "$HTTP_CODE" == "200" ]; then
    STATUS=$(echo "$RESPONSE" | jq -r '.status' 2>/dev/null)
    echo -e "   ${GREEN}✅ Status: $HTTP_CODE - $STATUS${NC}"
    
    # Check which sections are present
    HAS_VOLUME=$(echo "$RESPONSE" | jq -r '.volume_pulse.signal' 2>/dev/null)
    HAS_TREND=$(echo "$RESPONSE" | jq -r '.trend_base.signal' 2>/dev/null)
    HAS_ZONE=$(echo "$RESPONSE" | jq -r '.zone_control.signal' 2>/dev/null)
    HAS_CANDLE=$(echo "$RESPONSE" | jq -r '.candle_intent.signal' 2>/dev/null)
    HAS_WARNING=$(echo "$RESPONSE" | jq -r '.early_warning.signal' 2>/dev/null)
    
    SECTIONS=0
    [ "$HAS_VOLUME" != "null" ] && ((SECTIONS++))
    [ "$HAS_TREND" != "null" ] && ((SECTIONS++))
    [ "$HAS_ZONE" != "null" ] && ((SECTIONS++))
    [ "$HAS_CANDLE" != "null" ] && ((SECTIONS++))
    [ "$HAS_WARNING" != "null" ] && ((SECTIONS++))
    
    echo -e "   ${GREEN}   → $SECTIONS/5 analysis sections available${NC}"
else
    echo -e "   ${RED}❌ Status: $HTTP_CODE${NC}"
    echo -e "   ${RED}   Response: $(echo "$RESPONSE" | head -c 200)${NC}"
fi

echo ""

# Test technical analysis endpoint
echo -e "   ${BLUE}Testing /api/analysis/analyze/NIFTY...${NC}"
TECH_ANALYSIS=$(curl -s -w "\n%{http_code}" http://localhost:8000/api/analysis/analyze/NIFTY 2>/dev/null)
HTTP_CODE=$(echo "$TECH_ANALYSIS" | tail -n 1)
RESPONSE=$(echo "$TECH_ANALYSIS" | sed '$d')

if [ "$HTTP_CODE" == "200" ]; then
    SIGNAL=$(echo "$RESPONSE" | jq -r '.signal' 2>/dev/null)
    CONFIDENCE=$(echo "$RESPONSE" | jq -r '.confidence' 2>/dev/null)
    echo -e "   ${GREEN}✅ Status: $HTTP_CODE - Signal: $SIGNAL (Confidence: $(echo "$CONFIDENCE * 100" | bc -l | xargs printf "%.0f")%)${NC}"
else
    echo -e "   ${RED}❌ Status: $HTTP_CODE${NC}"
    if [ "$HTTP_CODE" == "401" ]; then
        echo -e "   ${RED}   → Unauthorized: Zerodha token expired!${NC}"
        echo -e "   ${YELLOW}   Fix: Generate new token${NC}"
        echo -e "   ${BLUE}   docker exec -it trading-backend python get_token.py${NC}"
    fi
fi

echo ""

# Test market data cache
echo -e "   ${BLUE}Testing /ws/cache/NIFTY...${NC}"
CACHE_DATA=$(curl -s -w "\n%{http_code}" http://localhost:8000/ws/cache/NIFTY 2>/dev/null)
HTTP_CODE=$(echo "$CACHE_DATA" | tail -n 1)
RESPONSE=$(echo "$CACHE_DATA" | sed '$d')

if [ "$HTTP_CODE" == "200" ]; then
    PRICE=$(echo "$RESPONSE" | jq -r '.data.last_price' 2>/dev/null)
    PCR=$(echo "$RESPONSE" | jq -r '.data.pcr' 2>/dev/null)
    echo -e "   ${GREEN}✅ Status: $HTTP_CODE - Price: ₹$PRICE, PCR: $PCR${NC}"
else
    echo -e "   ${RED}❌ Status: $HTTP_CODE${NC}"
    echo -e "   ${YELLOW}   → Market data not cached (WebSocket feed not running?)${NC}"
fi

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────────────────────────${NC}"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 3: Check Redis Status
# ───────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}🔍 STEP 3: Checking Redis Status...${NC}"
echo ""

REDIS_PING=$(docker exec trading-redis redis-cli ping 2>/dev/null)
if [ "$REDIS_PING" == "PONG" ]; then
    echo -e "   ${GREEN}✅ Redis: Connected${NC}"
    
    # Check if market data is cached
    CACHED_KEYS=$(docker exec trading-redis redis-cli KEYS "market_data:*" 2>/dev/null | wc -l)
    if [ "$CACHED_KEYS" -gt 0 ]; then
        echo -e "   ${GREEN}   → $CACHED_KEYS market data keys found${NC}"
    else
        echo -e "   ${YELLOW}   → No market data cached (WebSocket not feeding data?)${NC}"
    fi
else
    echo -e "   ${RED}❌ Redis: Not responding${NC}"
    echo -e "   ${YELLOW}→ Fix: Restart Redis container${NC}"
    echo -e "   ${BLUE}docker-compose -f docker-compose.prod.yml restart redis${NC}"
fi

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────────────────────────${NC}"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 4: Check Zerodha Token
# ───────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}🔍 STEP 4: Checking Zerodha Token...${NC}"
echo ""

TOKEN_LENGTH=$(docker exec trading-backend python3 -c "from config import get_settings; s=get_settings(); print(len(s.zerodha_access_token) if s.zerodha_access_token else 0)" 2>/dev/null)

if [ "$TOKEN_LENGTH" -gt 20 ]; then
    echo -e "   ${GREEN}✅ Token: Present (length: $TOKEN_LENGTH)${NC}"
else
    echo -e "   ${RED}❌ Token: Missing or invalid (length: $TOKEN_LENGTH)${NC}"
    echo -e "   ${YELLOW}→ Fix: Generate new token${NC}"
    echo -e "   ${BLUE}docker exec -it trading-backend python get_token.py${NC}"
fi

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────────────────────────${NC}"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 5: Check Backend Logs for Errors
# ───────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}🔍 STEP 5: Checking Backend Logs (last 30 lines)...${NC}"
echo ""

ERROR_COUNT=$(docker logs trading-backend --tail 100 2>&1 | grep -iE "error|exception|failed|traceback" | wc -l)

if [ "$ERROR_COUNT" -gt 0 ]; then
    echo -e "   ${RED}⚠️  Found $ERROR_COUNT error/exception messages${NC}"
    echo ""
    echo -e "   ${YELLOW}Recent errors:${NC}"
    docker logs trading-backend --tail 100 2>&1 | grep -iE "error|exception|failed" | tail -n 10 | sed 's/^/   /'
else
    echo -e "   ${GREEN}✅ No errors found in recent logs${NC}"
fi

echo ""
echo -e "${BLUE}───────────────────────────────────────────────────────────────────────────────${NC}"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 6: Summary & Next Steps
# ───────────────────────────────────────────────────────────────────────────────
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   📊 DIAGNOSTIC SUMMARY${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Count successful checks
CHECKS_PASSED=0
TOTAL_CHECKS=6

[ -n "$BACKEND_STATUS" ] && ((CHECKS_PASSED++))
[ -n "$REDIS_STATUS" ] && ((CHECKS_PASSED++))
[ "$HTTP_CODE" == "200" ] && ((CHECKS_PASSED++))
[ "$REDIS_PING" == "PONG" ] && ((CHECKS_PASSED++))
[ "$TOKEN_LENGTH" -gt 20 ] && ((CHECKS_PASSED++))
[ "$ERROR_COUNT" -eq 0 ] && ((CHECKS_PASSED++))

if [ "$CHECKS_PASSED" -eq "$TOTAL_CHECKS" ]; then
    echo -e "${GREEN}✅ All checks passed! ($CHECKS_PASSED/$TOTAL_CHECKS)${NC}"
    echo ""
    echo -e "${GREEN}System is healthy. If you still see '0/8 signals', try:${NC}"
    echo -e "   ${BLUE}1. Clear browser cache (Ctrl+Shift+R)${NC}"
    echo -e "   ${BLUE}2. Check browser DevTools console for frontend errors${NC}"
    echo -e "   ${BLUE}3. Verify frontend env: docker exec trading-frontend env | grep NEXT_PUBLIC${NC}"
else
    echo -e "${YELLOW}⚠️  $CHECKS_PASSED/$TOTAL_CHECKS checks passed${NC}"
    echo ""
    echo -e "${YELLOW}💡 NEXT STEPS:${NC}"
    echo ""
    
    if [ -z "$BACKEND_STATUS" ]; then
        echo -e "   ${RED}1. Start backend:${NC}"
        echo -e "      ${BLUE}docker-compose -f docker-compose.prod.yml up -d backend${NC}"
        echo ""
    fi
    
    if [ "$TOKEN_LENGTH" -lt 20 ]; then
        echo -e "   ${RED}2. Generate Zerodha token:${NC}"
        echo -e "      ${BLUE}docker exec -it trading-backend python get_token.py${NC}"
        echo ""
    fi
    
    if [ -z "$REDIS_STATUS" ]; then
        echo -e "   ${RED}3. Start Redis:${NC}"
        echo -e "      ${BLUE}docker-compose -f docker-compose.prod.yml up -d redis${NC}"
        echo ""
    fi
    
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo -e "   ${YELLOW}4. View full backend logs:${NC}"
        echo -e "      ${BLUE}docker logs trading-backend --tail 200${NC}"
        echo ""
    fi
    
    echo -e "   ${YELLOW}5. After fixing, restart backend:${NC}"
    echo -e "      ${BLUE}docker-compose -f docker-compose.prod.yml restart backend${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
echo ""
