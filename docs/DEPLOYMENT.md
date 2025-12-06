# Trading Signals App - Deployment Guide

## 🚀 Quick Deploy

### Backend (Render)
1. Push code to GitHub
2. Create new Web Service on Render
3. Set **Root Directory**: `backend`
4. **Build Command**: `pip install -r requirements.txt`
5. **Start Command**: `python app.py`
6. Add environment variables:
   - `ZERODHA_API_KEY` = your_key
   - `ZERODHA_API_SECRET` = your_secret
   - `REDIRECT_URL` = https://your-frontend.netlify.app/auth/callback
   - `PORT` = 8000

### Frontend (Netlify)
1. Connect GitHub repo to Netlify
2. **Base directory**: `frontend`
3. **Build command**: `npm install && npm run build`
4. **Publish directory**: `.next`
5. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = https://your-backend.onrender.com

## 📝 Local Development

### Start Both Servers
```powershell
# Backend
cd backend
python app.py

# Frontend (in new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## 🔐 Zerodha Authentication

1. Click "Login to Zerodha"
2. Enter your Zerodha credentials
3. Authorize the app
4. You'll be redirected back automatically

## 🧪 Test Without Login

Click "Load Test Data" button to see the app with sample data.

## 🌐 Environment Variables

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Backend (.env)
```
ZERODHA_API_KEY=your_key
ZERODHA_API_SECRET=your_secret
REDIRECT_URL=http://localhost:3000/auth/callback
PORT=8000
```

## 📦 Files Overview

- `render.yaml` - Render deployment config
- `netlify.toml` - Netlify deployment config
- `.python-version` - Python 3.11 for compatibility
- `runtime.txt` - Python version for Render

## ⚡ Features

- Real-time options signals
- Live data refresh (1 second)
- Greeks calculation (Black-Scholes)
- PCR analysis
- Market bias indicators
- Full option chain viewer

## 🛠️ Troubleshooting

**Backend not starting?**
- Check Python version (3.11 recommended)
- Install dependencies: `pip install -r requirements.txt`

**Frontend not connecting?**
- Verify `NEXT_PUBLIC_API_URL` is set
- Check backend is running
- Try "Load Test Data" button

**Login failing?**
- Verify Zerodha API credentials
- Check `REDIRECT_URL` matches your frontend URL
- Allow popups in browser

## 📊 Tech Stack

- **Backend**: FastAPI + Python
- **Frontend**: Next.js + React + TailwindCSS
- **API**: Zerodha Kite Connect
- **Hosting**: Render (backend) + Netlify (frontend)
