# MyDailyTradingSignals - Project Instructions

## Project Overview
Real-time trading dashboard for NIFTY, BANKNIFTY, and SENSEX with Zerodha Kite API integration.

## Architecture
```
Zerodha WebSocket (KiteTicker) → Python Backend → Redis Cache → FastAPI WebSocket → Next.js UI
```

## Backend (Python FastAPI)
- Location: `/backend`
- Framework: FastAPI with async support
- WebSocket server at `/ws/market`
- Zerodha KiteTicker for live market data
- Redis for micro-latency caching
- JWT authentication with refresh tokens

## Frontend (Next.js + TypeScript)
- Location: `/frontend`
- Dark theme trader-friendly UI
- Reusable IndexCard components
- WebSocket hooks for live updates
- React.memo for performance optimization

## Key Commands
### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Environment Variables
### Backend (.env)
- ZERODHA_API_KEY
- ZERODHA_API_SECRET
- REDIS_URL
- JWT_SECRET

### Frontend (.env.local)
- NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market

## Docker
```bash
docker-compose up --build
```
