# Quick Reference: No Hardcoding Guide

## For Developers: How to Use Configuration Instead of Hardcoding

### ❌ NEVER DO THIS (Hardcoding)
```python
# Backend
API_URL = "http://localhost:8000"  # ❌ Hardcoded!
MARKET_OPEN = time(9, 15)  # ❌ Hardcoded!
test_price = 20150.0  # ❌ Hardcoded test data!

# Frontend
const API_URL = "http://localhost:8000";  // ❌ Hardcoded!
```

### ✅ DO THIS INSTEAD (Configuration & Dynamic)

#### Backend - URLs
```python
# ✅ Use environment variable
from config import get_settings
settings = get_settings()
api_key = settings.zerodha_api_key

# Or directly load from environment
import os
redirect_url = os.getenv("REDIRECT_URL")
```

#### Backend - Market Hours
```python
# ✅ Use configuration object
from config.market_session import get_market_session
market_config = get_market_session()
market_open = market_config.MARKET_OPEN
```

#### Backend - Holidays
```python
# ✅ Check centralized holiday configuration
from config.nse_holidays import is_holiday, get_all_holidays
if is_holiday("2025-01-26"):
    print("Market is closed")

# Get all holidays for 2025
holidays_2025 = get_all_holidays(2025)
```

#### Backend - Test Data
```python
# ✅ Generate test data instead of hardcoding
from data.test_data_factory import TestDataFactory

# Generate realistic test data
tick = TestDataFactory.generate_tick("NIFTY", price_variance=0.02)
all_ticks = TestDataFactory.generate_all_symbols()
tick_with_analysis = TestDataFactory.generate_complete_tick_with_analysis("NIFTY")
```

#### Frontend - URLs
```typescript
// ✅ Use API configuration
import { API_CONFIG } from '@/lib/api-config';

// Gets URL from environment (NEXT_PUBLIC_API_URL)
const apiUrl = API_CONFIG.baseUrl;  // http://localhost:8000
const wsUrl = API_CONFIG.wsUrl;     // ws://localhost:8000/ws/market

// Build endpoints
const analyzeUrl = API_CONFIG.endpoint('/api/analysis/analyze/all');
```

---

## Configuration Checklist

Before running the application:

- [ ] Backend: Copy `backend/.env.example` to `backend/.env`
- [ ] Backend: Set `ZERODHA_API_KEY` and `ZERODHA_API_SECRET`
- [ ] Backend: Set `JWT_SECRET` to a random strong string
- [ ] Backend: Set `REDIRECT_URL` and `FRONTEND_URL` for your environment
- [ ] Frontend: Copy `frontend/.env.example` to `frontend/.env.local`
- [ ] Frontend: Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`
- [ ] Verify no `.env` files are committed to git

---

## Common Commands

### Generate Test Data
```bash
# Single snapshot
python backend/scripts/generate_test_data.py

# Multiple snapshots (live simulation)
python backend/scripts/generate_test_data.py --snapshots 50

# With custom variance
python backend/scripts/generate_test_data.py --variance 0.05 --snapshots 20
```

### View Configuration
```bash
# Backend
echo "API Key: $ZERODHA_API_KEY"
echo "Redirect URL: $REDIRECT_URL"

# Frontend
echo $NEXT_PUBLIC_API_URL
```

### Load Configuration in Code
```python
# Python
from config import get_settings
settings = get_settings()
print(settings.zerodha_api_key)

# Or from environment
import os
os.getenv("ZERODHA_API_KEY")
```

---

## Migration: Converting Hardcoded Values

### Step 1: Identify Hardcoded Values
```bash
# Find hardcoded URLs
grep -r "http://" backend/ --include="*.py" | grep -v "#" | grep -v ".env"

# Find hardcoded times
grep -r "time(9" backend/ --include="*.py"

# Find hardcoded test data
grep -r "20150\|47850\|78500" backend/ --include="*.py"
```

### Step 2: Move to Environment
```bash
# Move URLs to .env
REDIRECT_URL=http://localhost:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
```

### Step 3: Replace in Code
```python
# Before ❌
redirect_url = "http://localhost:8000/api/auth/callback"

# After ✅
from config import get_settings
settings = get_settings()
redirect_url = settings.redirect_url
```

---

## Testing with Test Data

### Development Workflow
1. Generate test data: `python backend/scripts/generate_test_data.py`
2. Load in your tests
3. Verify functionality
4. Switch to live data in .env: `USE_REAL_MARKET_DATA=true`

### Example Test
```python
from data.test_data_factory import TestDataFactory

def test_market_analysis():
    # Generate realistic test data (not hardcoded!)
    tick = TestDataFactory.generate_complete_tick_with_analysis("NIFTY")
    
    # Run your analysis
    result = analyze_tick(tick)
    
    # Verify results
    assert result["signal"] in ["BUY", "SELL", "NEUTRAL"]
    assert 0 <= result["confidence"] <= 1
```

---

## Production Deployment

### CI/CD Variables
Store these in your CI/CD platform (GitHub Actions, GitLab CI, etc.):
```
ZERODHA_API_KEY
ZERODHA_API_SECRET
ZERODHA_ACCESS_TOKEN
JWT_SECRET
REDIRECT_URL
FRONTEND_URL
```

### Docker
```dockerfile
# Pass via docker-compose
env_file:
  - .env.production

# Or pass directly
environment:
  - ZERODHA_API_KEY=${ZERODHA_API_KEY}
  - JWT_SECRET=${JWT_SECRET}
```

---

## Troubleshooting

### Error: "Configuration value not found"
✅ **Solution:** Check `.env` file exists with correct values
```bash
ls -la backend/.env
cat backend/.env | grep ZERODHA
```

### Error: "Hardcoded URL being used"
✅ **Solution:** Update code to use configuration
```python
# Instead of hardcoding:
url = "http://localhost:8000"

# Use:
from config import get_settings
url = get_settings().redis_url  # or appropriate setting
```

### Error: "Test data has old prices"
✅ **Solution:** Generate fresh test data
```bash
python backend/scripts/generate_test_data.py --output fresh_data.json
```

---

## Resources

- 📖 [Full Configuration & Test Data Guide](./CONFIGURATION_AND_TEST_DATA.md)
- 🎯 [Environment Variables Reference](../.env.example)
- 🧪 [Test Data Factory](../data/test_data_factory.py)
- ⏰ [Market Session Config](../config/market_session.py)
- 🗓️ [NSE Holidays Config](../config/nse_holidays.py)

---

**Key Principle:** Configuration should be **external** to code. Never hardcode URLs, credentials, or test data!
