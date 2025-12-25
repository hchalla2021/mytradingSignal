#!/bin/bash

# MyDailyTradingSignals - Single Command Startup Script
# Usage: ./start.sh

echo "🚀 Starting MyDailyTradingSignals..."

# Check if Docker is available
if command -v docker-compose &> /dev/null; then
    echo "📦 Using Docker Compose..."
    docker-compose up --build -d
    echo "✅ Services started!"
    echo "🌐 Frontend: http://localhost:3000"
    echo "🔧 Backend: http://localhost:8000"
    exit 0
fi

# Manual start if Docker not available
echo "🔧 Starting services manually..."

# Start Backend
echo "📡 Starting Backend..."
cd backend
python3 -m venv venv 2>/dev/null || true
source venv/bin/activate || . venv/Scripts/activate
pip install -q -r requirements.txt
nohup python main.py > ../backend.log 2>&1 &
BACKEND_PID=$!
echo "✅ Backend started (PID: $BACKEND_PID)"
cd ..

# Wait for backend to be ready
sleep 3

# Start Frontend
echo "🎨 Starting Frontend..."
cd frontend
npm install --silent
nohup npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
echo "✅ Frontend started (PID: $FRONTEND_PID)"
cd ..

echo ""
echo "🎉 All services running!"
echo "🌐 Frontend: http://localhost:3000"
echo "🔧 Backend: http://localhost:8000"
echo ""
echo "📝 Logs:"
echo "  Backend: tail -f backend.log"
echo "  Frontend: tail -f frontend.log"
echo ""
echo "🛑 To stop: kill $BACKEND_PID $FRONTEND_PID"
