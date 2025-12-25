# 📊 MyDailyTradingSignals

Real-time trading signals dashboard for **NIFTY**, **BANKNIFTY**, and **SENSEX** with Zerodha Kite API integration.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10+-blue.svg)
![Node](https://img.shields.io/badge/node-20+-green.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)

## 🚀 Features

- **Live Market Data** - Real-time price updates via WebSocket
- **Zerodha Integration** - Direct feed from Kite Ticker
- **Ultra-Fast Updates** - Sub-second latency with Redis caching
- **Beautiful Dark UI** - Trader-friendly interface
- **Responsive Design** - Works on desktop and mobile
- **Demo Mode** - Works without Zerodha credentials

## 🏗️ Project Structure

```
MyDailyTradingSignals/
├── 📁 backend/              # Python FastAPI Backend
│   ├── routers/            # API endpoints (auth, market, health)
│   ├── services/           # Business logic (market feed, cache, auth)
│   ├── config.py           # App configuration
│   ├── main.py             # Entry point
│   └── requirements.txt    # Dependencies
│
├── 📁 frontend/             # Next.js Frontend
│   ├── app/                # Pages (dashboard, login)
│   ├── components/         # React components
│   ├── hooks/              # Custom hooks (WebSocket)
│   └── package.json        # Dependencies
│
├── 📁 scripts/              # Startup & deployment scripts
│   ├── start.bat           # Windows quick start
│   ├── start.ps1           # PowerShell script
│   ├── start.sh            # Linux/Mac script
│   └── deploy-to-do.*      # Digital Ocean deployment
│
├── 📁 docs/                 # Documentation
│   ├── DEPLOYMENT.md       # Deployment guide
│   ├── GITHUB_TO_DO.md     # GitHub to DO workflow
│   └── LOGIN_FLOW.md       # OAuth flow
│
├── docker-compose.yml       # Container orchestration
├── .env.example            # Environment template
└── README.md               # This file
```
         ↓
Redis Cache (In-Memory)
         ↓
WebSocket Server
         ↓
Next.js Frontend
```

## 📁 Project Structure

```
MyDailyTradingSignals/
├── backend/                 # Python FastAPI Backend
│   ├── main.py             # Application entry point
│   ├── config.py           # Configuration settings
│   ├── requirements.txt    # Python dependencies
│   ├── services/
│   │   ├── market_feed.py  # Zerodha KiteTicker service
│   │   ├── cache.py        # Redis cache service
│   │   ├── auth.py         # JWT authentication
│   │   └── websocket_manager.py
│   └── routers/
│       ├── auth.py         # Auth endpoints
│       ├── market.py       # WebSocket endpoint
│       └── health.py       # Health checks
├── frontend/               # Next.js Frontend
│   ├── app/
│   │   ├── page.tsx       # Main dashboard
│   │   ├── layout.tsx     # Root layout
│   │   └── globals.css    # Global styles
│   ├── components/
│   │   ├── Header.tsx     # Header component
│   │   ├── IndexCard.tsx  # Market index card
│   │   └── LiveStatus.tsx # Connection status
│   └── hooks/
│       └── useMarketSocket.ts  # WebSocket hook
└── docker-compose.yml      # Docker configuration
```

## 🛠️ Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- Redis (optional, has fallback)
- Zerodha Kite API credentials (optional for demo)

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Copy environment file
copy .env.example .env  # Windows
# cp .env.example .env  # Linux/Mac

# Edit .env with your Zerodha credentials (optional)

# Start server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

### Docker Setup (Recommended)

```bash
# Start all services
docker-compose up --build

# Access:
# - Frontend: http://localhost:3000
# - Backend: http://localhost:8000
# - API Docs: http://localhost:8000/docs
```

## ⚙️ Configuration

### Backend Environment Variables (.env)

```env
# Zerodha API (Optional - runs in demo mode without)
ZERODHA_API_KEY=your_api_key
ZERODHA_API_SECRET=your_api_secret
ZERODHA_ACCESS_TOKEN=your_access_token

# Redis (Optional - uses memory fallback)
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-super-secret-key
```

### Frontend Environment Variables (.env.local)

```env
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## 📡 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API info |
| `GET /health` | Health check |
| `WS /ws/market` | Market data WebSocket |
| `GET /api/auth/login-url` | Zerodha login URL |
| `POST /api/auth/callback` | OAuth callback |
| `POST /api/auth/refresh` | Refresh token |

## 🎨 UI Features

- **Dark Theme** - Easy on the eyes for long trading sessions
- **Color Coding**
  - 🟢 Green = Bullish / Up
  - 🔴 Red = Bearish / Down
  - 🟡 Yellow = Neutral
- **Live Status Indicator** - Shows connection health
- **Price Flash Animation** - Visual feedback on price changes
- **OHLC Display** - Open, High, Low, Close for each index

## 🔒 Security

- JWT authentication with refresh tokens
- HTTP-only cookies for refresh tokens
- CORS configured for frontend origin
- WebSocket authentication support

## 📈 Future Enhancements

- [ ] Options chain data
- [ ] OI & Volume heatmap
- [ ] AI-based trading signals
- [ ] Mobile app
- [ ] Multi-broker support
- [ ] Historical data charts

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📝 License

MIT License - feel free to use for your trading projects!

---

**Built with ❤️ for Traders**
