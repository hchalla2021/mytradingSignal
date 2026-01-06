#!/bin/bash
# ========================================
# DIGITAL OCEAN PRODUCTION DEPLOYMENT
# Auto-start backend with systemd service
# ========================================

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   🌊 DIGITAL OCEAN - PRODUCTION DEPLOYMENT SCRIPT          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Configuration
APP_DIR="/opt/mytradingsignal"
APP_USER="root"  # Change if using non-root user
PYTHON_PATH="$APP_DIR/.venv/bin/python"
UVICORN_PATH="$APP_DIR/.venv/bin/uvicorn"

echo "📦 Deployment Configuration:"
echo "   App Directory: $APP_DIR"
echo "   Python: $PYTHON_PATH"
echo "   User: $APP_USER"
echo ""

# Check if app directory exists
if [ ! -d "$APP_DIR" ]; then
    echo "❌ Error: App directory not found: $APP_DIR"
    echo "   Please clone your repository first:"
    echo "   git clone <your-repo-url> $APP_DIR"
    exit 1
fi

cd "$APP_DIR"

# Check if virtual environment exists
if [ ! -f "$PYTHON_PATH" ]; then
    echo "⚙️  Creating virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install --upgrade pip
    pip install -r backend/requirements.txt
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment found"
fi

# Create systemd service file
echo ""
echo "📝 Creating systemd service file..."

cat > /etc/systemd/system/trading-backend.service << EOF
[Unit]
Description=MyTradingSignal Backend (FastAPI with Auto Market Hours)
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/backend
Environment="PATH=$APP_DIR/.venv/bin:/usr/local/bin:/usr/bin:/bin"
Environment="PYTHONPATH=$APP_DIR/backend"

# Load environment variables from .env file
EnvironmentFile=$APP_DIR/backend/.env

# Start command
ExecStart=$UVICORN_PATH main:app --host 0.0.0.0 --port 8000

# Restart policy
Restart=always
RestartSec=10

# Logging
StandardOutput=append:/var/log/trading-backend.log
StandardError=append:/var/log/trading-backend-error.log

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

echo "✅ Service file created: /etc/systemd/system/trading-backend.service"

# Create log files
touch /var/log/trading-backend.log
touch /var/log/trading-backend-error.log
chmod 644 /var/log/trading-backend.log
chmod 644 /var/log/trading-backend-error.log

echo "✅ Log files created"

# Reload systemd
echo ""
echo "🔄 Reloading systemd daemon..."
systemctl daemon-reload

# Enable service (start on boot)
echo "🔧 Enabling service (auto-start on boot)..."
systemctl enable trading-backend.service

# Start service
echo "🚀 Starting backend service..."
systemctl start trading-backend.service

# Wait for service to start
sleep 3

# Check status
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 SERVICE STATUS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
systemctl status trading-backend.service --no-pager

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DEPLOYMENT COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎯 USEFUL COMMANDS:"
echo ""
echo "   Check status:         sudo systemctl status trading-backend"
echo "   View live logs:       sudo journalctl -u trading-backend -f"
echo "   View error logs:      sudo tail -f /var/log/trading-backend-error.log"
echo "   Restart service:      sudo systemctl restart trading-backend"
echo "   Stop service:         sudo systemctl stop trading-backend"
echo "   Start service:        sudo systemctl start trading-backend"
echo "   Disable auto-start:   sudo systemctl disable trading-backend"
echo ""
echo "⏰ MARKET HOURS SCHEDULER:"
echo "   Auto-starts: 8:50 AM IST (10 mins before pre-open)"
echo "   Auto-stops:  3:35 PM IST (5 mins after market close)"
echo "   Checks every: 60 seconds"
echo ""
echo "🔄 SERVICE AUTO-RESTART:"
echo "   Backend will automatically restart if it crashes"
echo "   Backend will auto-start on server reboot"
echo "   No manual intervention needed!"
echo ""
echo "📡 WebSocket Endpoint:"
echo "   ws://your-domain.com/ws/market"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Backend is now running in production mode!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
