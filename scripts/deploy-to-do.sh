#!/bin/bash

# Digital Ocean Deployment Script
# Usage: ./deploy-to-do.sh YOUR_DROPLET_IP

set -e

if [ -z "$1" ]; then
    echo "❌ Usage: ./deploy-to-do.sh YOUR_DROPLET_IP"
    exit 1
fi

DROPLET_IP=$1
DROPLET_USER="root"

echo "🚀 Deploying to Digital Ocean: $DROPLET_IP"

# Copy files to droplet
echo "📦 Copying files..."
scp -r ../MyDailyTradingSignals $DROPLET_USER@$DROPLET_IP:~/

# SSH and setup
echo "🔧 Setting up on droplet..."
ssh $DROPLET_USER@$DROPLET_IP << 'ENDSSH'
    cd ~/MyDailyTradingSignals
    
    # Install Docker if not present
    if ! command -v docker &> /dev/null; then
        echo "📦 Installing Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
        systemctl enable docker
        systemctl start docker
        
        # Install Docker Compose
        curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        chmod +x /usr/local/bin/docker-compose
    fi
    
    # Start services
    echo "🐳 Starting services with Docker Compose..."
    docker-compose down 2>/dev/null || true
    docker-compose up -d --build
    
    echo "✅ Deployment complete!"
    echo "🌐 Frontend: http://$DROPLET_IP:3000"
    echo "🔧 Backend: http://$DROPLET_IP:8000"
    
    docker-compose ps
ENDSSH

echo "🎉 Deployment successful!"
echo "🌐 Access your app at: http://$DROPLET_IP:3000"
