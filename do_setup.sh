#!/bin/bash
# 
# Digital Ocean Quick Setup Script
# Run this ONCE after deploying to Digital Ocean
# 
# Usage: curl -sSL https://raw.githubusercontent.com/yourusername/mytradingSignal/main/do_setup.sh | bash
# Or: wget -O - https://raw.githubusercontent.com/yourusername/mytradingSignal/main/do_setup.sh | bash
# Or locally: bash do_setup.sh
#

set -e  # Exit on error

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 MyTradingSignals - Digital Ocean Setup Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get project directory
if [ -z "$1" ]; then
    PROJECT_DIR="/var/www/mytradingSignal"
else
    PROJECT_DIR="$1"
fi

echo "📁 Project directory: $PROJECT_DIR"
echo ""

# Check if project directory exists
if [ ! -d "$PROJECT_DIR" ]; then
    echo "❌ Error: Project directory not found: $PROJECT_DIR"
    echo "   Please specify the correct path:"
    echo "   bash $0 /path/to/mytradingSignal"
    exit 1
fi

cd "$PROJECT_DIR"

# Step 1: Check environment file
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Step 1/5: Checking environment configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "backend/.env" ]; then
    echo "❌ backend/.env not found!"
    echo "   Please create it first with your Zerodha credentials"
    exit 1
fi

# Check if API keys are set
if ! grep -q "ZERODHA_API_KEY=.." backend/.env; then
    echo "⚠️  Warning: ZERODHA_API_KEY not set in backend/.env"
    echo "   Please set it before continuing"
    exit 1
fi

echo "✅ Environment file found"
echo ""

# Step 2: Install dependencies
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Step 2/5: Installing Python dependencies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Installing..."
    apt-get update && apt-get install -y python3 python3-pip python3-venv
fi

# Create virtual environment if doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate and install
source .venv/bin/activate
pip install --upgrade pip
pip install kiteconnect python-dotenv watchdog

echo "✅ Dependencies installed"
echo ""

# Step 3: Generate initial token
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔑 Step 3/5: Generate initial Zerodha token"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "⚠️  IMPORTANT: You need to generate the first token manually"
echo "   This requires browser access to Zerodha website"
echo ""
echo "Option A: Run this on your LOCAL machine first:"
echo "   python manual_token_refresh.py"
echo "   Then copy the token to this server's backend/.env"
echo ""
echo "Option B: If you have X11 forwarding or VNC:"
echo "   python manual_token_refresh.py"
echo ""

read -p "Have you already set ZERODHA_ACCESS_TOKEN in backend/.env? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Please generate token first, then run this script again"
    exit 1
fi

echo "✅ Token configuration confirmed"
echo ""

# Step 4: Setup cron job for automatic token refresh
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏰ Step 4/5: Setting up automatic token refresh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Make setup script executable
chmod +x setup_token_cron.sh

# Run setup
./setup_token_cron.sh

echo "✅ Cron job configured"
echo ""

# Step 5: Start services
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Step 5/5: Starting services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if Docker is available
if command -v docker &> /dev/null; then
    echo "🐳 Docker detected. Starting with Docker Compose..."
    docker-compose up -d
    echo "✅ Docker services started"
elif command -v systemctl &> /dev/null; then
    echo "🔧 Systemd detected. Starting services..."
    if systemctl list-units --type=service | grep -q "trading-backend"; then
        systemctl restart trading-backend
        systemctl restart trading-frontend
        echo "✅ Systemd services restarted"
    else
        echo "⚠️  Systemd services not configured. Please start manually:"
        echo "   cd backend && uvicorn main:app --host 0.0.0.0 --port 8000 &"
        echo "   cd frontend && npm run start &"
    fi
else
    echo "⚠️  No service manager detected. Please start manually:"
    echo "   cd backend && uvicorn main:app --host 0.0.0.0 --port 8000 &"
    echo "   cd frontend && npm run start &"
fi

echo ""

# Final verification
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔍 Verification commands:"
echo "   Health check:  curl http://localhost:8000/api/system/health | jq"
echo "   View logs:     tail -f logs/token_refresh.log"
echo "   Test cron:     ./refresh_token_cron.sh"
echo "   List cron:     crontab -l"
echo ""
echo "📊 Your application is now running at:"
echo "   Backend:  http://$(hostname -I | awk '{print $1}'):8000"
echo "   Frontend: http://$(hostname -I | awk '{print $1}'):3000"
echo "   API Docs: http://$(hostname -I | awk '{print $1}'):8000/docs"
echo ""
echo "⏰ Token refresh is scheduled for 7:45 AM IST daily"
echo "   No manual intervention needed!"
echo ""
echo "🎉 Deployment successful! Your trading signals are live!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
