#!/bin/bash
# 🚀 AUTOMATED PRODUCTION DEPLOYMENT VERIFICATION SCRIPT
# ═══════════════════════════════════════════════════════════
# This script DETECTS and REPORTS all hardcoded values before deployment

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   PRODUCTION DEPLOYMENT VERIFICATION SCRIPT                ║"
echo "║   Checking for hardcoded values, test data, and debug code ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISSUES_FOUND=0
WARNINGS_FOUND=0

# Color codes
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_error() {
    echo -e "${RED}❌ ERROR: $1${NC}"
    ((ISSUES_FOUND++))
}

log_warning() {
    echo -e "${YELLOW}⚠️  WARNING: $1${NC}"
    ((WARNINGS_FOUND++))
}

log_success() {
    echo -e "${GREEN}✅ PASS: $1${NC}"
}

log_info() {
    echo -e "${BLUE}ℹ️  INFO: $1${NC}"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 1: Check for Hardcoded Sample Data"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for hardcoded volumes (450000, 380000, 320000, 410000)
if grep -r "450000\|380000\|320000\|410000" "$PROJECT_ROOT/backend" --include="*.py" | grep -v ".pyc" | grep -v "__pycache__"; then
    log_error "Found hardcoded volume values (450000, 380000, 320000, 410000) in backend"
    echo "  Location: Likely in routers/advanced_analysis.py"
    echo "  Action: Replace with error responses (NO_DATA status)"
else
    log_success "No hardcoded volume values found"
fi

# Check for hardcoded SAMPLE data returns
if grep -r "SAMPLE data\|sample data" "$PROJECT_ROOT/backend/routers" --include="*.py" | grep -v ".pyc"; then
    log_error "Found 'SAMPLE data' references in routers"
    echo "  These should return proper error responses in production"
else
    log_success "No SAMPLE data references found"
fi

# Check for hardcoded base prices
if grep -r "base_price = 24500\|base_price = 51000\|base_price = 80000" "$PROJECT_ROOT/backend" --include="*.py"; then
    log_error "Found hardcoded base prices (NIFTY/BANKNIFTY/SENSEX mock values)"
    echo "  Action: Remove or gate behind market session checks"
else
    log_success "No hardcoded base price values found"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 2: Check for Debug Print Statements"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Count print statements in backend
PRINT_COUNT=$(grep -r "print(f\"" "$PROJECT_ROOT/backend/routers" --include="*.py" | wc -l)
if [ "$PRINT_COUNT" -gt 5 ]; then
    log_warning "Found $PRINT_COUNT debug print statements in backend/routers"
    echo "  Action: Remove or wrap in 'if DEBUG:' condition"
    grep -r "print(f\"" "$PROJECT_ROOT/backend/routers" --include="*.py" | head -5
    echo "  ... (showing first 5)"
else
    log_success "Print statements are minimal or well-gated"
fi

# Check frontend console.logs
CONSOLE_LOG_COUNT=$(grep -r "console.log" "$PROJECT_ROOT/frontend/hooks" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l || echo "0")
if [ "$CONSOLE_LOG_COUNT" -gt 10 ]; then
    log_warning "Found $CONSOLE_LOG_COUNT console.log statements in frontend/hooks"
    echo "  Action: Remove or wrap in 'if (DEBUG)' condition"
else
    log_success "Frontend logging is minimal or acceptable"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 3: Check for Test Files"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TEST_FILES=(
    "$PROJECT_ROOT/backend/test_data_flow.py"
    "$PROJECT_ROOT/backend/test_ema_calculation.py"
    "$PROJECT_ROOT/backend/test_ema_pipeline.py"
    "$PROJECT_ROOT/backend/test_fetch.py"
    "$PROJECT_ROOT/backend/test_intraday_filter.py"
    "$PROJECT_ROOT/backend/test_market_structure_fix.py"
    "$PROJECT_ROOT/backend/data/test_data_factory.py"
    "$PROJECT_ROOT/backend/scripts/generate_test_data.py"
    "$PROJECT_ROOT/backend/scripts/validate_pcr_setup.py"
)

FOUND_TEST_FILES=0
for FILE in "${TEST_FILES[@]}"; do
    if [ -f "$FILE" ]; then
        log_error "Test file found: $FILE (should be deleted before production)"
        ((FOUND_TEST_FILES++))
    fi
done

if [ "$FOUND_TEST_FILES" -eq 0 ]; then
    log_success "No test files found (clean)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 4: Check Environment Variables"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

REQUIRED_VARS=("ZERODHA_API_KEY" "ZERODHA_API_SECRET" "JWT_SECRET")

for VAR in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!VAR}" ]; then
        log_warning "Environment variable not set: $VAR (required for production)"
    else
        if [ "$VAR" = "JWT_SECRET" ] && [ ${#!VAR} -lt 32 ]; then
            log_warning "JWT_SECRET is too short (should be >32 chars, is ${#!VAR})"
        else
            log_success "Environment variable $VAR is set"
        fi
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 5: Check for Mock/Test Mode Indicators"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for test mode enablement in code (should be False in production)
if grep -r "TEST_DATA_ENABLED\s*=\s*True" "$PROJECT_ROOT/backend" --include="*.py" 2>/dev/null; then
    log_error "Found TEST_DATA_ENABLED=True in backend (should be False)"
else
    log_success "TEST_DATA_ENABLED is not set to True"
fi

if grep -r "MOCK_DATA_ENABLED\s*=\s*True" "$PROJECT_ROOT/backend" --include="*.py" 2>/dev/null; then
    log_error "Found MOCK_DATA_ENABLED=True in backend (should be False)"
else
    log_success "MOCK_DATA_ENABLED is not set to True"
fi

# Check DEBUG flag
if grep -r "DEBUG\s*=\s*True" "$PROJECT_ROOT/backend" --include="*.py" 2>/dev/null | grep -v ".pyc"; then
    log_warning "Found DEBUG=True in backend (should be False for production)"
else
    log_success "DEBUG is not set to True"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 6: Check Authentication & Secrets"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for hardcoded API keys in source code
if grep -r "zerodha_api_key\s*=\s*['\"]" "$PROJECT_ROOT/backend" --include="*.py" 2>/dev/null | grep -v ".pyc" | grep -v "os.getenv\|os.environ"; then
    log_error "Found hardcoded API key in backend source code"
    echo "  Action: Use environment variables only"
else
    log_success "No hardcoded API keys found in source"
fi

if grep -r "zerodha_api_secret\s*=\s*['\"]" "$PROJECT_ROOT/backend" --include="*.py" 2>/dev/null | grep -v ".pyc" | grep -v "os.getenv\|os.environ"; then
    log_error "Found hardcoded API secret in backend source code"
else
    log_success "No hardcoded API secrets found in source"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 7: Check for Common Security Issues"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for exposed tokens in code
if grep -r "access_token\s*=\s*['\"]" "$PROJECT_ROOT/backend" --include="*.py" 2>/dev/null | grep -v ".pyc" | grep -v "request\|response\|headers"; then
    log_warning "Found potential hardcoded token assignment"
else
    log_success "No obviously hardcoded tokens found"
fi

# Check for subprocess with hardcoded commands
if grep -r "subprocess\.\(run\|Popen\)" "$PROJECT_ROOT/backend" --include="*.py" 2>/dev/null | grep -v "json\|encode\|decode"; then
    log_warning "Found subprocess calls (ensure they're properly validated)"
else
    log_success "No unsafe subprocess calls found"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "PHASE 8: Code Quality Checks"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for TODO comments
TODO_COUNT=$(grep -r "TODO\|FIXME\|XXX\|HACK" "$PROJECT_ROOT/backend" --include="*.py" 2>/dev/null | wc -l)
if [ "$TODO_COUNT" -gt 0 ]; then
    log_warning "Found $TODO_COUNT TODO/FIXME comments (review before production)"
else
    log_success "No TODO/FIXME comments found"
fi

# Check for commented code blocks
COMMENT_COUNT=$(grep -r "^[[:space:]]*#.*=" "$PROJECT_ROOT/backend" --include="*.py" 2>/dev/null | wc -l)
if [ "$COMMENT_COUNT" -gt 50 ]; then
    log_warning "Found many commented lines ($COMMENT_COUNT) - clean up"
else
    log_success "Commented code is minimal"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 FINAL REPORT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "ERRORS FOUND:   $ISSUES_FOUND"
echo "WARNINGS FOUND: $WARNINGS_FOUND"
echo ""

if [ "$ISSUES_FOUND" -eq 0 ] && [ "$WARNINGS_FOUND" -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          🎉 PRODUCTION READY - NO ISSUES FOUND 🎉          ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    exit 0
elif [ "$ISSUES_FOUND" -eq 0 ]; then
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║       ⚠️  PRODUCTION READY (with minor warnings) ⚠️         ║${NC}"
    echo -e "${YELLOW}║              Review warnings before deploying              ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║         ❌ PRODUCTION ISSUES DETECTED - CANNOT DEPLOY ❌    ║${NC}"
    echo -e "${RED}║              Fix all errors before proceeding              ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi
