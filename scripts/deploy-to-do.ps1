# Digital Ocean Deployment Script (PowerShell)
# Usage: .\deploy-to-do.ps1 YOUR_DROPLET_IP
# Uploads source only. backend/.env, the Kite token and runtime data stay server-only,
# so a deploy never replaces production settings with this PC's local ones.

param(
    [Parameter(Mandatory=$true)]
    [string]$DropletIP
)

$DropletUser = "root"
$ErrorActionPreference = "Stop"
$RemoteArchive = "/tmp/mydailytradingsignals-deploy.tgz"
$Excludes = @(
    ".git", ".venv", "venv", "node_modules", ".next", ".next-*", "__pycache__",
    ".pytest_cache", ".ruff_cache", "*.log", ".env", ".env.*", "archive/env_backups",
    "backend/access_token.txt", "backend/data", "backend/logs"
)
$ServerOnlyEntry = '(^|/)(\.env(\.[^/]*)?|access_token\.txt)/?$'

Write-Host "Deploying to Digital Ocean: $DropletIP" -ForegroundColor Cyan

$repoRoot = Split-Path -Parent $PSScriptRoot
$archive = Join-Path ([IO.Path]::GetTempPath()) ("mydailytradingsignals-deploy-{0}.tgz" -f [guid]::NewGuid().ToString("N"))
$excludeArgs = @($Excludes | ForEach-Object { "--exclude=$_" })
try {
    Write-Host "Packaging source..." -ForegroundColor Yellow
    tar -czf $archive @excludeArgs -C $repoRoot .
    if ($LASTEXITCODE -ne 0) {
        throw "Packaging failed (exit $LASTEXITCODE); deployment stopped."
    }
    $serverOnly = @(tar -tzf $archive | Where-Object { $_ -match $ServerOnlyEntry })
    if ($LASTEXITCODE -ne 0) {
        throw "Package check failed (exit $LASTEXITCODE); deployment stopped."
    }
    if ($serverOnly.Count) {
        throw "Package would overwrite server-only files ($($serverOnly -join ', ')); deployment stopped."
    }

    Write-Host "Uploading source..." -ForegroundColor Yellow
    scp $archive "${DropletUser}@${DropletIP}:$RemoteArchive"
    if ($LASTEXITCODE -ne 0) {
        throw "File upload failed (exit $LASTEXITCODE); deployment stopped."
    }
} finally {
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
}

# Execute commands on droplet
Write-Host "Setting up on droplet..." -ForegroundColor Yellow

$setupCommands = @'
set -eu
archive=/tmp/mydailytradingsignals-deploy.tgz
trap 'rm -f "$archive"' EXIT
mkdir -p "$HOME/MyDailyTradingSignals"
tar -xzf "$archive" --no-same-owner --warning=no-unknown-keyword -C "$HOME/MyDailyTradingSignals"
cd "$HOME/MyDailyTradingSignals"
sed -i 's/\r$//' scripts/ensure-docker-compose.sh scripts/check-production-env.sh

# Production settings live only on the server; stop before any container changes.
export BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-backend/.env}"
bash scripts/check-production-env.sh "$BACKEND_ENV_FILE" < /dev/null
# Docker would create a directory for a missing bind-mounted token file.
touch backend/access_token.txt

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo 'Installing Docker...'
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
fi

# Check Compose independently, including hosts that already have Docker.
source scripts/ensure-docker-compose.sh
"${COMPOSE[@]}" -f docker-compose.prod.yml config --quiet
"${COMPOSE[@]}" -f docker-compose.prod.yml up -d --build
"${COMPOSE[@]}" -f docker-compose.prod.yml ps
'@

($setupCommands -replace "`r`n", "`n") | ssh "${DropletUser}@${DropletIP}" "tr -d '\r' | bash -se"
if ($LASTEXITCODE -ne 0) {
    throw "Remote deployment failed (exit $LASTEXITCODE); inspect the server before retrying."
}

Write-Host ""
Write-Host "Container startup completed. Verify service health and the production reverse proxy before use." -ForegroundColor Green
Write-Host "Access your app at: http://${DropletIP}:3000" -ForegroundColor Yellow
