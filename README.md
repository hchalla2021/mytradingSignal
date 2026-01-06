# MyDailyTradingSignals

Real-time trading dashboard for NIFTY, BANKNIFTY, and SENSEX with Zerodha Kite API integration.

## Quick Start

### Development
```bash
# One-time setup
cd backend
pip install -r requirements.txt
cd ../frontend
npm install

# Generate token (required daily)
cd ..
python quick_token_fix.py

# Start backend
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Start frontend (new terminal)
cd frontend
npm run dev
```

### Production (Docker)
```bash
docker-compose up -d
```

## Documentation

📚 **All documentation is located in the [`docs/`](docs/) folder**

### Essential Guides
- **[Project Overview](docs/README.md)** - Full project documentation
- **[Quick Start Guide](docs/QUICKSTART_ANALYSIS.md)** - Get started quickly
- **[Authentication Setup](docs/ZERODHA_AUTH_SETUP.md)** - Zerodha API setup
- **[Mobile Login Guide](docs/MOBILE_LOGIN_GUIDE.md)** - Login from mobile devices
- **[Token Automation](docs/TOKEN_AUTOMATION_README.md)** - Automatic token refresh

### System Documentation
- **[Architecture](docs/VISUAL_ARCHITECTURE.md)** - System architecture overview
- **[Analysis System](docs/ANALYSIS_SYSTEM.md)** - Technical analysis features
- **[State Orchestration](docs/STATE_ORCHESTRATION_SYSTEM.md)** - State management
- **[WebSocket System](docs/WEBSOCKET_403_PERMANENT_FIX.md)** - WebSocket troubleshooting

### Recent Fixes
- **[Data Refresh Fix](docs/FIX_DATA_NOT_REFRESHING.md)** - Fixed flat market data issue (Jan 6, 2026)

## Testing

```bash
# Test WebSocket connection
python test_ws_client.py

# Test system components
python test_orchestration.py
```

## Architecture

```
Zerodha WebSocket (KiteTicker) → Python Backend → In-Memory Cache → FastAPI WebSocket → Next.js UI
```

### Tech Stack
- **Backend**: Python, FastAPI, KiteTicker
- **Frontend**: Next.js, TypeScript, TailwindCSS
- **Cache**: In-memory (ultra-fast)
- **WebSocket**: Real-time bidirectional communication

## Features

- 🔴 **Live Market Data** - Real-time price updates
- 📊 **Technical Analysis** - InstantSignal, PCR Analysis, Volume Pulse
- 📈 **Multiple Indices** - NIFTY, BANKNIFTY, SENSEX
- 🎯 **Trading Signals** - BUY/SELL signals with confidence levels
- 🔔 **Early Warning** - Market trend detection
- 🎨 **Dark Theme** - Trader-friendly UI

## Environment Setup

### Backend (.env)
```env
ZERODHA_API_KEY=your_api_key
ZERODHA_API_SECRET=your_api_secret
ZERODHA_ACCESS_TOKEN=your_access_token
REDIRECT_URL=http://127.0.0.1:8000/api/auth/callback
FRONTEND_URL=http://localhost:3000
```

### Frontend (.env.local)
```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/market
```

## License

See [LICENSE](LICENSE) file for details.

## Support

For issues, questions, or contributions, please refer to the [documentation](docs/) or create an issue.

---

**Made with ❤️ for Indian Stock Market Traders**
