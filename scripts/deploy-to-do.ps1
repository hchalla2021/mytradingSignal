# Digital Ocean Deployment Script (PowerShell)
# Usage: .\deploy-to-do.ps1 YOUR_DROPLET_IP

param(
    [Parameter(Mandatory=$true)]
    [string]$DropletIP
)

$DropletUser = "root"

Write-Host "🚀 Deploying to Digital Ocean: $DropletIP" -ForegroundColor Cyan

# Copy files using SCP
Write-Host "📦 Copying files..." -ForegroundColor Yellow
scp -r . "${DropletUser}@${DropletIP}:~/MyDailyTradingSignals"

# Execute commands on droplet
Write-Host "🔧 Setting up on droplet..." -ForegroundColor Yellow

$setupCommands = @"
cd ~/MyDailyTradingSignals

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo '📦 Installing Docker...'
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
    
    # Install Docker Compose
    curl -L 'https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)' -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# Start services
echo '🐳 Starting services...'
docker-compose down 2>/dev/null || true
docker-compose up -d --build

echo '✅ Deployment complete!'
echo '🌐 Frontend: http://${DropletIP}:3000'
echo '🔧 Backend: http://${DropletIP}:8000'

docker-compose ps
"@

ssh "${DropletUser}@${DropletIP}" $setupCommands

Write-Host ""
Write-Host "🎉 Deployment successful!" -ForegroundColor Green
Write-Host "🌐 Access your app at: http://${DropletIP}:3000" -ForegroundColor Yellow
