#!/bin/bash
# Update Production Token on Digital Ocean
# Usage: ./update-production-token.sh YOUR_DROPLET_IP

if [ -z "$1" ]; then
    echo "❌ Usage: ./update-production-token.sh YOUR_DROPLET_IP"
    echo "Example: ./update-production-token.sh 143.198.123.45"
    exit 1
fi

DROPLET_IP=$1
LOCAL_TOKEN=$(grep "ZERODHA_ACCESS_TOKEN" backend/.env | cut -d '=' -f2)

if [ -z "$LOCAL_TOKEN" ]; then
    echo "❌ Error: No token found in backend/.env"
    exit 1
fi

echo "🔐 Updating production token on $DROPLET_IP..."
echo "   Token: ${LOCAL_TOKEN:0:20}..."

# SSH and update token
ssh root@$DROPLET_IP << ENDSSH
    cd ~/mytradingsignal
    
    # Backup current .env
    cp backend/.env backend/.env.backup
    
    # Update token
    sed -i "s/^ZERODHA_ACCESS_TOKEN=.*/ZERODHA_ACCESS_TOKEN=$LOCAL_TOKEN/" backend/.env
    
    echo "✅ Token updated in .env file"
    
    # Restart backend
    if command -v docker-compose &> /dev/null; then
        echo "🔄 Restarting backend (Docker)..."
        docker-compose restart backend
    elif systemctl is-active --quiet mytradingsignal; then
        echo "🔄 Restarting backend (systemd)..."
        systemctl restart mytradingsignal
    else
        echo "⚠️  Please restart backend manually"
    fi
    
    echo "✅ Production token updated successfully!"
ENDSSH

echo ""
echo "🎉 Done! Your production server now has the latest token."
echo "🌐 Check: http://$DROPLET_IP:3000"
