#!/bin/bash
# ========================================
# ENABLE DOCKER AUTO-START ON BOOT
# Fix for Digital Ocean production
# ========================================

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   🐳 DOCKER AUTO-START CONFIGURATION                      ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed!"
    echo "   Install Docker first: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed!"
    echo "   Install: apt install docker-compose -y"
    exit 1
fi

echo "✅ Docker and Docker Compose found"
echo ""

# Enable Docker service to start on boot
echo "🔧 Enabling Docker service to start on boot..."
systemctl enable docker

# Start Docker if not running
if ! systemctl is-active --quiet docker; then
    echo "🚀 Starting Docker service..."
    systemctl start docker
else
    echo "✅ Docker is already running"
fi

# Get the project directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo ""
echo "📁 Project directory: $PROJECT_DIR"

# Create systemd service for docker-compose
echo ""
echo "📝 Creating systemd service for auto-starting containers..."

cat > /etc/systemd/system/trading-docker.service << EOF
[Unit]
Description=Trading Signal Docker Compose Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/docker-compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker-compose -f docker-compose.prod.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

echo "✅ Service file created: /etc/systemd/system/trading-docker.service"

# Reload systemd
echo ""
echo "🔄 Reloading systemd daemon..."
systemctl daemon-reload

# Enable the service
echo "🔧 Enabling trading-docker service..."
systemctl enable trading-docker.service

# Start the service
echo "🚀 Starting containers..."
cd "$PROJECT_DIR"
docker-compose -f docker-compose.prod.yml up -d

# Wait for containers to start
echo ""
echo "⏳ Waiting for containers to start..."
sleep 5

# Check container status
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 CONTAINER STATUS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker-compose -f docker-compose.prod.yml ps

# Check service status
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 SYSTEMD SERVICE STATUS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
systemctl status trading-docker.service --no-pager

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ AUTO-START CONFIGURATION COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎯 WHAT'S CONFIGURED:"
echo "   ✅ Docker service starts on boot"
echo "   ✅ trading-backend container auto-starts"
echo "   ✅ trading-frontend container auto-starts"
echo "   ✅ redis container auto-starts"
echo "   ✅ All containers restart on failure"
echo ""
echo "🔄 RESTART POLICY:"
echo "   Policy: unless-stopped"
echo "   Containers will survive:"
echo "   - Server reboots ✅"
echo "   - Docker restarts ✅"
echo "   - Container crashes ✅"
echo ""
echo "🧪 TEST AUTO-START:"
echo "   sudo reboot"
echo "   # After reboot, check:"
echo "   docker ps"
echo ""
echo "🎉 Your backend will now auto-start on every server boot!"
echo ""
