# 📊 Options Trading Signals - AI-Powered Live Analysis

> **Ultra-Fast Real-Time Options Analysis with AI Market Intelligence**

A production-ready options trading dashboard with AI-powered market analysis, real-time signals for NIFTY/BANKNIFTY/SENSEX, interactive option chains, and ultra-fast stock heatmaps (100+ stocks).

## 📚 Documentation

All documentation is organized in the [docs/](docs/) folder:
- [START_HERE.md](docs/START_HERE.md) - Quick start guide
- [AI_FEATURES_GUIDE.md](docs/AI_FEATURES_GUIDE.md) - AI analysis capabilities
- [STOCKS_HEATMAP_GUIDE.md](docs/STOCKS_HEATMAP_GUIDE.md) - Stock heatmap usage
- [PERFORMANCE_OPTIMIZATION.md](docs/PERFORMANCE_OPTIMIZATION.md) - Performance details
- [ULTRA_FAST_DEPLOYMENT.md](docs/ULTRA_FAST_DEPLOYMENT.md) - Deployment guide
- [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) - Code organization

All documentation files are organized in the [`docs/`](docs/) folder:

- **[Deployment Guide](docs/DEPLOYMENT.md)** - Step-by-step deployment instructions
- **[Deployment Readiness](docs/DEPLOYMENT_READINESS.md)** - Pre-deployment checklist & security review
- **[Security Guidelines](docs/SECURITY.md)** - Best practices for API keys and secrets
- **[Folder Structure](docs/FOLDER_STRUCTURE.md)** - Complete project structure overview

## Features

- 🔴 **Live Market Data** from Zerodha Kite Connect
- 📊 **Option Chain Display** with real-time prices
- 📈 **Greeks Calculation** using Black-Scholes model
- 🎯 **Strong Buy Signals** based on Greeks and Open Interest analysis
- ⚡ **Real-time Updates** every 10 seconds
- 🎨 **Clean, Modern UI** with Next.js and Tailwind CSS
- 🚀 **Ready for Render Deployment**

## Technology Stack

### Frontend
- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Axios** - API calls
- **Lucide React** - Icons

### Backend
- **Python 3.11+**
- **FastAPI** - Modern async web framework
- **Kite Connect** - Zerodha API client
- **NumPy & SciPy** - Greeks calculations
- **WebSockets** - Real-time data streaming

## Project Structure

```
MyTradeSignals/
├── backend/
│   ├── app.py              # FastAPI application
│   ├── requirements.txt    # Python dependencies
│   └── .env.example       # Environment variables template
├── frontend/
│   ├── app/
│   │   ├── page.tsx       # Main trading dashboard
│   │   ├── layout.tsx     # App layout
│   │   └── globals.css    # Global styles
│   ├── package.json       # Node dependencies
│   ├── next.config.js     # Next.js configuration
│   ├── tailwind.config.js # Tailwind configuration
│   └── tsconfig.json      # TypeScript configuration
├── render.yaml            # Render deployment config
├── .gitignore
└── README.md
```

## Setup Instructions

### Prerequisites
- Python 3.11 or higher
- Node.js 18 or higher
- Zerodha Kite Connect API credentials

### 1. Zerodha API Setup

1. Create a Kite Connect app at https://developers.kite.trade/
2. Note down your:
   - API Key: `g5tyrnn1mlckrb6f`
   - API Secret: `9qlzwmum5f7pami0gacyxc7uxa6w823s`
   - Redirect URL: `http://localhost:8080/redirect`

### 2. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
copy .env.example .env

# Edit .env and add your Zerodha credentials
# ZERODHA_API_KEY=g5tyrnn1mlckrb6f
# ZERODHA_API_SECRET=9qlzwmum5f7pami0gacyxc7uxa6w823s

# Run the backend
python app.py
```

Backend will run on http://localhost:8000

### 3. Frontend Setup

```bash
# Open new terminal and navigate to frontend
cd frontend

# Install dependencies
npm install

# Create .env.local file
copy .env.local.example .env.local

# Run development server
npm run dev
```

Frontend will run on http://localhost:3000

### 4. Authentication Flow

1. Open http://localhost:3000
2. Click "Login to Zerodha"
3. Complete Zerodha login in the popup window
4. After login, you'll be redirected with a `request_token` in URL
5. Copy the request_token and use it to set access token via API:
   ```
   POST http://localhost:8000/api/auth/set-token?request_token=YOUR_TOKEN
   ```

## How It Works

### Signal Generation Algorithm

The application generates strong buy signals based on multiple factors:

1. **Delta Analysis**
   - CE options: Delta > 0.6 (Strong), > 0.4 (Good)
   - PE options: Delta < -0.6 (Strong), < -0.4 (Good)

2. **Gamma Analysis**
   - High Gamma (> 0.015): Excellent leverage potential
   - Good Gamma (> 0.008): Decent leverage

3. **Vega Analysis**
   - High Vega (> 10): Benefits from volatility increase
   - Moderate Vega (> 5): Some volatility benefit

4. **Open Interest Analysis**
   - Strong OI buildup (> 15% change): Strong signal
   - Positive OI (> 5% change): Good signal

5. **Strike Type**
   - ATM (At The Money): Preferred
   - ITM (In The Money): Good

### Scoring System

- **70+ Score**: STRONG BUY 🟢
- **50-69 Score**: BUY 🟡
- **30-49 Score**: WEAK BUY 🟠
- **Below 30**: NO SIGNAL ⚪

## Deployment on Render

### Prerequisites
- GitHub account
- Render account (free tier available)

### Steps

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Deploy on Render**
   - Go to https://render.com
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository
   - Render will automatically detect `render.yaml`
   - Add environment variables:
     - `ZERODHA_API_KEY`
     - `ZERODHA_API_SECRET`
     - `ZERODHA_ACCESS_TOKEN` (optional, can set after first login)
   - Click "Apply"

3. **Update Frontend API URL**
   - After backend deploys, note the URL (e.g., https://options-trading-backend.onrender.com)
   - Update frontend environment variable `NEXT_PUBLIC_API_URL` in Render dashboard

## API Endpoints

### Authentication
- `GET /api/auth/login-url` - Get Zerodha login URL
- `POST /api/auth/set-token` - Set access token after login

### Data Endpoints
- `GET /api/instruments/{symbol}` - Get full option chain
  - Symbols: NIFTY, BANKNIFTY, SENSEX
- `GET /api/signals/{symbol}` - Get strong buy signals only
- `WebSocket /ws/signals` - Real-time signal updates

## Features Explained

### Greeks Calculation
- **Delta**: Rate of change of option price relative to underlying
- **Gamma**: Rate of change of delta
- **Theta**: Time decay of option
- **Vega**: Sensitivity to volatility changes

### Option Chain Display
- Shows strikes around ATM (±5 strikes)
- Displays both CE and PE for each strike
- Real-time LTP, OI, and IV
- Color-coded signals

### Auto-Refresh
- Updates every 10 seconds
- Can be toggled on/off
- Shows last update timestamp

## Important Notes

⚠️ **Disclaimer**: This application is for educational purposes only. Not financial advice. Always do your own research before trading.

⚠️ **API Limits**: Zerodha Kite Connect has rate limits. Free tier allows 3 requests/second.

⚠️ **Market Hours**: Live data only available during market hours (9:15 AM - 3:30 PM IST).

⚠️ **Access Token**: Zerodha access tokens expire daily. You need to login every day.

## Troubleshooting

### Backend Issues
- **401 Error**: Not authenticated. Login to Zerodha first.
- **500 Error**: Check if access token is valid and not expired.
- **No data**: Ensure markets are open.

### Frontend Issues
- **Connection Error**: Check if backend is running.
- **CORS Error**: Ensure backend CORS is configured correctly.

### Deployment Issues
- **Build Failed**: Check build logs in Render dashboard.
- **Environment Variables**: Ensure all required env vars are set.

## Future Enhancements

- [ ] Historical signal tracking
- [ ] Backtesting feature
- [ ] Multiple strategy support
- [ ] Alert notifications
- [ ] Portfolio tracking
- [ ] More technical indicators

## License

MIT License

## Support

For issues and questions, please create an issue on GitHub.

---

**Happy Trading! 📈**
