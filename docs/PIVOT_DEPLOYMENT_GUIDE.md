# Pivot Points Enhancement - Deployment Guide

## Pre-Deployment Checklist

### 1. Code Review
- [ ] Review `enhanced_pivot_analysis.py` implementation
- [ ] Verify all imports and dependencies
- [ ] Check confidence scoring logic
- [ ] Validate prediction algorithm
- [ ] Review error handling

### 2. Environment Setup
- [ ] Python 3.9+ installed
- [ ] FastAPI dependencies installed
- [ ] Redis running (for caching)
- [ ] Node.js 18+ and npm for frontend
- [ ] All backend requirements.txt packages installed

### 3. Type Safety
- [ ] TypeScript types defined in `pivot-analysis.ts`
- [ ] All types exported correctly
- [ ] No type errors in IDE

## Step-by-Step Deployment

### Phase 1: Backend Setup (30 minutes)

#### 1.1 Create the Enhanced Analysis Module
```bash
cd backend/strategies
# File: enhanced_pivot_analysis.py
# [Copy implementation from provided code]
```

**What gets created:**
- Market status classification engine
- Pivot confidence scoring system
- 5-minute prediction engine
- Nearest level detection

#### 1.2 Create/Update API Endpoint
```bash
cd backend/routes
# Create new file or update existing: pivot_analysis.py
```

Add route:
```python
from fastapi import APIRouter
from strategies.enhanced_pivot_analysis import EnhancedPivotAnalyzer

router = APIRouter(prefix="/api", tags=["pivot-analysis"])
analyzer = EnhancedPivotAnalyzer()

@router.get("/pivot-analysis/{symbol}")
async def get_pivot_analysis(symbol: str):
    """Get enhanced pivot analysis"""
    return await analyzer.analyze(symbol)
```

#### 1.3 Update Main App
In `backend/main.py`:
```python
from routes.pivot_analysis import router as pivot_router

# Add to app startup
app.include_router(pivot_router)
```

#### 1.4 Test Backend
```bash
# Terminal 1: Start Redis (if Docker)
docker run -d -p 6379:6379 redis:latest

# Terminal 2: Start backend
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Terminal 3: Test endpoint
curl http://localhost:8000/api/pivot-analysis/NIFTY

# Expected response:
# {
#   "symbol": "NIFTY",
#   "status": "LIVE",
#   "current_price": 23450.50,
#   "classic_pivots": {...},
#   "market_status": "BULLISH",
#   "pivot_confidence": 78,
#   "prediction_direction": "UP",
#   "prediction_confidence": 72
# }
```

**Validation Checklist:**
- [ ] Endpoint returns 200 status
- [ ] Response includes all required fields
- [ ] Market status is one of 5 valid values
- [ ] Confidence scores are 0-100
- [ ] Timestamps are ISO 8601 format
- [ ] No console errors

### Phase 2: Frontend Setup (30 minutes)

#### 2.1 Add TypeScript Types
```bash
# File: frontend/types/pivot-analysis.ts
# [Copy types from provided code]
```

Verify installation:
```bash
cd frontend
npm run type-check
```

#### 2.2 Create/Update PivotCard Component
```bash
# File: frontend/components/dashboard/IndexCard/PivotCard.tsx
# [Copy component from provided code]
```

Check component:
```bash
npm run lint -- PivotCard.tsx
```

#### 2.3 Update IndexCard Section
In `frontend/components/dashboard/IndexCard/IndexCard.tsx`:

```tsx
import { PivotCard } from './PivotCard';
import { EnhancedPivotAnalysis } from '@/types/pivot-analysis';

// Add to your main card structure
<section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
  {pivotAnalyses.map((analysis) => (
    <PivotCard 
      key={analysis.symbol}
      analysis={analysis}
      symbol={analysis.symbol}
      isLive={analysis.status === 'LIVE'}
    />
  ))}
</section>
```

#### 2.4 WebSocket Integration
Ensure your useWebSocket hook fetches pivot data:

```typescript
// In your WebSocket data fetching
if (messageType === 'pivot_analysis') {
  setPivotAnalyses(prev => [
    ...prev.filter(p => p.symbol !== data.symbol),
    data as EnhancedPivotAnalysis
  ]);
}
```

#### 2.5 Test Frontend
```bash
cd frontend

# Check types
npm run type-check

# Run ESLint
npm run lint

# Start dev server
npm run dev

# Browser: http://localhost:3000
# Verify Pivot Card appears in dashboard
# Check styling is correct
# Verify colors match market status
```

**Visual Validation:**
- [ ] Pivot Card visible on dashboard
- [ ] Colors update with market status changes
- [ ] Confidence percentage displayed
- [ ] Nearest levels show correct values
- [ ] 5-Minute prediction card visible
- [ ] Real-time updates working
- [ ] No console errors (React/TypeScript)

### Phase 3: Integration Testing (45 minutes)

#### 3.1 Full Stack Test
```bash
# Start all services
docker-compose up --build

# Or start individually:
# Terminal 1: Redis
docker run -d -p 6379:6379 redis:latest

# Terminal 2: Backend
cd backend && uvicorn main:app --reload

# Terminal 3: Frontend
cd frontend && npm run dev
```

#### 3.2 System Integration Tests
```bash
# Test 1: API Endpoint Availability
curl -X GET "http://localhost:8000/api/pivot-analysis/NIFTY" \
  -H "accept: application/json"

# Test 2: WebSocket Connection
# In browser console:
ws = new WebSocket('ws://localhost:8000/ws/market?symbol=NIFTY');
ws.onmessage = (e) => console.log(e.data);
```

#### 3.3 Data Accuracy Validation
```bash
# Create test script: test_pivot_accuracy.py
import requests
import time
from datetime import datetime

# Test endpoint response
response = requests.get('http://localhost:8000/api/pivot-analysis/NIFTY')
data = response.json()

# Validation checks
assert response.status_code == 200, "API returned non-200 status"
assert 'symbol' in data, "Missing symbol field"
assert data['symbol'] == 'NIFTY', "Wrong symbol"
assert 0 <= data['pivot_confidence'] <= 100, "Invalid confidence"
assert data['market_status'] in ['STRONG_BULLISH', 'BULLISH', 'NEUTRAL', 'BEARISH', 'STRONG_BEARISH'], "Invalid status"
assert data['prediction_direction'] in ['UP', 'DOWN', 'SIDEWAYS'], "Invalid prediction"
assert data['current_price'] > 0, "Invalid price"

# Check pivots structure
pivots = data['classic_pivots']
assert pivots['s3'] < pivots['s2'] < pivots['s1'] < pivots['pivot'] < pivots['r1'] < pivots['r2'] < pivots['r3'], "Pivots not in ascending order"

# Check nearest levels
if data.get('nearest_resistance'):
    assert data['nearest_resistance']['value'] > data['current_price'], "Resistance not above current price"

if data.get('nearest_support'):
    assert data['nearest_support']['value'] < data['current_price'], "Support not below current price"

print("✓ All validation checks passed!")
print(f"Analysis at {data['timestamp']}: {data['market_status']} with {data['pivot_confidence']}% confidence")
```

Run the test:
```bash
python test_pivot_accuracy.py
```

#### 3.4 Performance Testing
```bash
# Load test: 100 requests in sequence
import concurrent.futures
import requests
import time

def fetch_analysis():
    response = requests.get('http://localhost:8000/api/pivot-analysis/NIFTY')
    return response.elapsed.total_seconds()

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    start = time.time()
    results = list(executor.map(fetch_analysis, range(100)))
    elapsed = time.time() - start

avg_time = sum(results) / len(results)
max_time = max(results)

print(f"Average response time: {avg_time*1000:.2f}ms")
print(f"Max response time: {max_time*1000:.2f}ms")
print(f"Requests per second: {100/elapsed:.1f}")
print(f"✓ Performance acceptable!" if avg_time < 0.2 else "⚠ Performance degraded")
```

### Phase 4: Quality Assurance (30 minutes)

#### 4.1 UI/UX Testing
- [ ] Load dashboard in Chrome/Firefox/Safari
- [ ] Verify Pivot Card responsive on mobile
- [ ] Check colors render correctly
- [ ] Test on dark/light themes (if applicable)
- [ ] Hover states work properly
- [ ] Click interactions responsive
- [ ] No layout shifts during updates

#### 4.2 Error Scenario Testing
```bash
# Stop Redis - test offline handling
docker stop <redis_container_id>

# Verify frontend shows CACHED status
# Reload page - should show "OFFLINE" with grey styling
# Restart Redis and verify recovery
```

#### 4.3 Browser DevTools Validation
- [ ] No JavaScript console errors
- [ ] No red/yellow warnings
- [ ] React DevTools shows correct component tree
- [ ] No memory leaks (check heap size over time)
- [ ] Network requests < 500ms
- [ ] WebSocket reconnects on disconnect

#### 4.4 Accessibility Testing (WCAG 2.1)
- [ ] Color contrast ratio >= 4.5:1 for text
- [ ] All interactive elements keyboard accessible (Tab/Enter)
- [ ] Screen reader describes status correctly
- [ ] Error messages clear and actionable
- [ ] Loading states announced

### Phase 5: Pre-Production Setup (15 minutes)

#### 5.1 Environment Variables
Update `.env` files:

**Backend (.env)**:
```
ZERODHA_API_KEY=your_key
ZERODHA_API_SECRET=your_secret
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret
PIVOT_CACHE_TTL=3600  # 1 hour
CONFIDENCE_CACHE_TTL=60  # 1 minute
```

**Frontend (.env.local)**:
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
NEXT_PUBLIC_ENABLE_PIVOT_ANALYSIS=true
```

#### 5.2 Logging Configuration
Update logging in `backend/main.py`:
```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('logs/pivot_analysis.log')
    ]
)

logger = logging.getLogger(__name__)
```

#### 5.3 Error Tracking
Add Sentry or similar (optional):
```python
import sentry_sdk

sentry_sdk.init(
    dsn="your_sentry_dsn",
    traces_sample_rate=0.1,
    environment="development"
)
```

### Phase 6: Production Deployment (varies)

#### 6.1 For Docker Deployment
```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# Verify services running
docker-compose ps

# Check logs
docker-compose logs -f backend
docker-compose logs -f frontend
```

#### 6.2 For Manual Deployment
```bash
# Backend
cd backend
pip install -r requirements.txt
gunicorn -w 4 -b 0.0.0.0:8000 main:app

# Frontend (in separate terminal)
cd frontend
npm install
npm run build
npm start
```

#### 6.3 Health Checks
```bash
# Backend health
curl http://your-backend-url/api/pivot-analysis/NIFTY

# Frontend health
curl http://your-frontend-url/

# Check logs
tail -f backend/logs/pivot_analysis.log
```

## Rollback Procedure

If issues arise:

### Quick Rollback (< 5 minutes)
```bash
# 1. Stop new version
docker-compose down

# 2. Restore previous images
docker pull previous:tag
docker-compose up -d

# 3. Verify services
docker-compose ps
```

### Code Rollback
```bash
# Git rollback
git revert <commit-hash>
git push origin main

# Rebuild and restart
docker-compose up --build -d
```

## Monitoring & Maintenance

### Daily Checks
- [ ] Error rate < 0.1%
- [ ] Response times < 500ms
- [ ] WebSocket connections stable
- [ ] Database/Redis healthy

### Weekly Checks
- [ ] Log review for warnings
- [ ] Performance trending
- [ ] Prediction accuracy stats
- [ ] User feedback

### Monthly Maintenance
- [ ] Update dependencies
- [ ] Purge old cache
- [ ] Optimize database indexes
- [ ] Review and refine confidence algorithms

## Support & Troubleshooting

### Common Issues

**Issue: Pivot levels not updating**
```
Solution: Check Redis connection
redis-cli ping
Expected: PONG
```

**Issue: Confidence scores always 50**
```
Solution: Verify volume data available
Check WebSocket market data is flowing
```

**Issue: Prediction accuracy poor**
```
Solution: Adjust RSI threshold in enhanced_pivot_analysis.py
Test with different weight configurations
Collect more historical data for training
```

**Issue: Component renders slowly**
```
Solution: Check React.memo is applied
Verify WebSocket batching enabled
Profile with React DevTools
```

## Sign-Off Checklist

- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Documentation updated
- [ ] Team trained on new features
- [ ] Monitoring in place
- [ ] Rollback plan documented
- [ ] Go-live approval obtained

## Post-Deployment

### First 24 Hours
- Monitor error logs closely
- Check user feedback
- Verify prediction accuracy
- Monitor resource usage

### First Week
- Collect confidence score statistics
- Track prediction accuracy
- Optimize based on real data
- Document any issues

### Ongoing
- Monthly accuracy reviews
- Quarterly algorithm reviews
- Annual strategy reassessment
- Continuous monitoring

---

**Contact**: [Your team contact info]
**Last Updated**: December 2024
**Version**: 1.0
