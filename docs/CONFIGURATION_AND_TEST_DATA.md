# Configuration & Test Data Management Guide

## Overview
This guide explains how to properly configure the application using environment variables and test data instead of hardcoding URLs, credentials, and market data.

## Philosophy
- **NO HARDCODED URLs** - All URLs come from environment variables
- **NO HARDCODED CREDENTIALS** - Zerodha keys, JWT secrets, etc. must be in .env
- **NO HARDCODED MARKET DATA** - Use test data factory for generating realistic test data
- **NO HARDCODED MARKET HOURS** - Market hours and holidays loaded from configuration

---

## 1. Environment Configuration

### Backend Setup

#### Copy Configuration Template
```bash
cd backend
cp .env.example .env
```

#### Edit .env with Your Values
```bash
# Critical - MUST HAVE
ZERODHA_API_KEY=your_actual_key
ZERODHA_API_SECRET=your_actual_secret
JWT_SECRET=generate_a_strong_random_string

# URLs based on environment
REDIRECT_URL=http://localhost:8000/api/auth/callback  # For local dev
FRONTEND_URL=http://localhost:3000

# Optional: Production URLs (comment above, uncomment these)
# REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
# FRONTEND_URL=https://mydailytradesignals.com
```

#### Verify Configuration Loaded
```bash
# Backend will show environment detection on startup
python -m uvicorn main:app --reload

# Look for:
# ✅ Environment configuration valid
# 📍 AUTH_URL: [your configured URL]
```

### Frontend Setup

#### Copy Configuration Template
```bash
cd frontend
cp .env.example .env.local
```

#### Edit .env.local
```bash
# Points to your backend
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
```

---

## 2. Market Hours & Holidays

### Configuration File
- **Location:** `backend/config/market_session.py`
- **No Code Changes Needed** - All values loaded from environment

### Update Market Hours (if different for your region)
```bash
# In .env:
MARKET_PRE_OPEN_START=09:00
MARKET_PRE_OPEN_END=09:15
MARKET_OPEN=09:15
MARKET_CLOSE=15:30
MARKET_TIMEZONE=Asia/Kolkata
```

### Update Holidays
- **Location:** `backend/config/nse_holidays.py`
- **Edit the NSE_HOLIDAYS dict** - add/remove dates as announced by NSE
- **No code recompilation** - just restart the backend

```python
# backend/config/nse_holidays.py
NSE_HOLIDAYS = {
    "2025-01-26": "Republic Day",
    "2025-02-26": "Maha Shivaratri",
    # Add more as needed
}
```

---

## 3. Test Data Generation (Instead of Hardcoding)

### Why Test Data Factory?
✅ **Realistic data** - Generates proper OHLC, volume, trends  
✅ **No hardcoding** - All data generated dynamically  
✅ **Configurable** - Change price variance, volume ranges  
✅ **Development-friendly** - Use for demos, testing, development  

### Generate Single Snapshot
```bash
cd backend/scripts
python generate_test_data.py --output test_market_data.json
```

Output:
```json
{
  "NIFTY": {
    "symbol": "NIFTY",
    "price": 20145.50,
    "change": -4.50,
    "changePercent": -0.02,
    "open": 20150.00,
    "high": 20200.00,
    "low": 20100.00,
    "close": 20150.00,
    "volume": 1250000,
    "oi": 25000000,
    "trend": "neutral",
    "status": "LIVE",
    "analysis": {
      "signal": "NEUTRAL",
      "confidence": 0.50,
      "indicators": {...}
    }
  }
}
```

### Generate Multiple Snapshots (Live Simulation)
```bash
# Generate 50 snapshots (5-second intervals)
python generate_test_data.py --snapshots 50

# Creates:
# test_data_snapshots/snapshot_001_090000.json
# test_data_snapshots/snapshot_002_090005.json
# ...
# test_data_snapshots/all_snapshots.jsonl
```

### Generate with Custom Variance
```bash
# Large price movements (testing volatile markets)
python generate_test_data.py --variance 0.05 --snapshots 20

# Small price movements (testing stable markets)
python generate_test_data.py --variance 0.005 --snapshots 20
```

### Use Generated Data in Tests
```python
# Python backend testing
from data.test_data_factory import TestDataFactory

# Generate a single tick
tick = TestDataFactory.generate_tick("NIFTY")

# Generate with analysis
tick_with_analysis = TestDataFactory.generate_complete_tick_with_analysis("NIFTY")

# Generate all symbols
all_ticks = TestDataFactory.generate_all_symbols()
```

---

## 4. Switching Between Live & Test Data

### Development (Test Data)
```bash
# .env
USE_REAL_MARKET_DATA=false  # Use generated test data
TEST_DATA_ENABLED=true
TEST_DATA_PRICE_VARIANCE=0.02
```

### Production (Live Data)
```bash
# .env
USE_REAL_MARKET_DATA=true   # Use Zerodha real data
ZERODHA_API_KEY=your_production_key
ZERODHA_API_SECRET=your_production_secret
ZERODHA_ACCESS_TOKEN=your_token
```

---

## 5. Environment-Specific Configurations

### Local Development
```bash
# backend/.env
DEBUG=true
ENABLE_SCHEDULER=false  # No need for market hours logic
CORS_ORIGINS=*
REDIS_URL=redis://localhost:6379
REDIRECT_URL=http://localhost:8000/api/auth/callback
```

### Staging/Testing
```bash
# backend/.env
DEBUG=false
ENABLE_SCHEDULER=true
CORS_ORIGINS=https://staging.mydailytradesignals.com
REDIS_URL=redis://redis-staging:6379
REDIRECT_URL=https://staging.mydailytradesignals.com/api/auth/callback
```

### Production
```bash
# backend/.env (NEVER commit this!)
DEBUG=false
ENABLE_SCHEDULER=true
CORS_ORIGINS=https://mydailytradesignals.com,https://app.mydailytradesignals.com
REDIS_URL=redis://redis-prod:6379
REDIRECT_URL=https://mydailytradesignals.com/api/auth/callback
JWT_SECRET=<very_long_random_string>
```

---

## 6. Best Practices

### ✅ DO
- Use `.env` files for all configuration
- Use environment variables in code
- Generate test data instead of hardcoding
- Document configuration choices
- Use `.env.example` as template
- Version control `.env.example`, NOT `.env`

### ❌ DON'T
- Hardcode URLs in code
- Hardcode API keys/secrets
- Hardcode market hours
- Hardcode test data
- Commit `.env` to git
- Copy/paste configuration values
- Mix environment detection with hardcoding

### Security
```bash
# Never commit .env files
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
echo ".env*.local" >> .gitignore

# Rotate secrets regularly
# Store production secrets in secure vault (AWS Secrets Manager, etc.)
# Use different credentials for dev/staging/prod
```

---

## 7. Docker Deployment

### Pass Environment Variables
```bash
# As environment variables
docker run -e ZERODHA_API_KEY=xxx -e ZERODHA_API_SECRET=yyy ...

# From .env file
docker run --env-file .env.prod ...

# In docker-compose.yml
env_file:
  - .env.prod
```

---

## 8. CI/CD Integration

### GitHub Actions Example
```yaml
- name: Build and Deploy
  env:
    ZERODHA_API_KEY: ${{ secrets.ZERODHA_API_KEY }}
    ZERODHA_API_SECRET: ${{ secrets.ZERODHA_API_SECRET }}
    JWT_SECRET: ${{ secrets.JWT_SECRET }}
  run: |
    npm install
    npm run build
    npm run deploy
```

---

## Troubleshooting

### Issue: "Configuration not found"
**Solution:** Ensure `.env` file exists and is readable
```bash
ls -la backend/.env  # Check if file exists
cat backend/.env | head -10  # Check contents
```

### Issue: "Hardcoded URL being used"
**Solution:** Check environment variable is set
```bash
echo $ZERODHA_API_KEY  # Verify env var exists
grep -r "http://" backend/ --include="*.py" | grep -v "#"  # Find hardcoded URLs
```

### Issue: Test data not generating
**Solution:** Run with verbose output
```bash
python generate_test_data.py --output test_data.json --variance 0.02
# Check for errors in output
```

---

## Summary

| Component | Configuration | Example |
|-----------|---------------|---------|
| API URLs | `.env` file | `NEXT_PUBLIC_API_URL=http://localhost:8000` |
| Credentials | `.env` file | `ZERODHA_API_KEY=your_key` |
| Market Hours | `backend/config/market_session.py` | `MARKET_OPEN=09:15` |
| Holidays | `backend/config/nse_holidays.py` | `"2025-01-26": "Republic Day"` |
| Test Data | `TestDataFactory` | `TestDataFactory.generate_tick("NIFTY")` |

---

**Last Updated:** January 25, 2026  
**Version:** 1.0  
**Status:** ✅ Complete configuration management system
