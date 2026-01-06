#!/bin/bash
#
# Setup Automated Token Refresh for Digital Ocean/Linux Production
# This script sets up a cron job to refresh Zerodha token daily at 7:45 AM IST
#

echo "🔧 Setting up automated Zerodha token refresh..."

# Get the absolute path to the project
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "📁 Project directory: $PROJECT_DIR"

# Create the cron job script
cat > "$PROJECT_DIR/refresh_token_cron.sh" << 'EOF'
#!/bin/bash
# Automated Token Refresh Script for Cron
# Runs daily at 7:45 AM IST (after markets open at 9:15 AM)

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtual environment if exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
elif [ -d "venv" ]; then
    source venv/bin/activate
fi

# Log file
LOG_FILE="$SCRIPT_DIR/logs/token_refresh.log"
mkdir -p "$SCRIPT_DIR/logs"

echo "========================================" >> "$LOG_FILE"
echo "Token Refresh: $(date)" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

# Run the token refresh script
python3 "$SCRIPT_DIR/auto_token_refresh.py" >> "$LOG_FILE" 2>&1

# Restart backend service (if using systemd)
if systemctl list-units --type=service | grep -q "trading-backend"; then
    echo "Restarting trading-backend service..." >> "$LOG_FILE"
    sudo systemctl restart trading-backend >> "$LOG_FILE" 2>&1
fi

# Restart Docker container (if using Docker)
if docker ps --format '{{.Names}}' | grep -q "trading-backend"; then
    echo "Restarting Docker container..." >> "$LOG_FILE"
    docker restart trading-backend >> "$LOG_FILE" 2>&1
fi

echo "Token refresh completed at $(date)" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
EOF

# Make the script executable
chmod +x "$PROJECT_DIR/refresh_token_cron.sh"

echo "✅ Cron script created: $PROJECT_DIR/refresh_token_cron.sh"

# Add cron job (7:45 AM IST = 2:15 AM UTC)
echo ""
echo "📅 Setting up cron job..."
echo "   Time: 7:45 AM IST daily (2:15 AM UTC)"
echo ""

# Backup existing crontab
crontab -l > "$PROJECT_DIR/crontab_backup_$(date +%Y%m%d_%H%M%S).txt" 2>/dev/null || true

# Add new cron job (avoid duplicates)
(crontab -l 2>/dev/null | grep -v "refresh_token_cron.sh"; echo "15 2 * * * $PROJECT_DIR/refresh_token_cron.sh") | crontab -

echo "✅ Cron job added successfully!"
echo ""
echo "🔍 Current cron jobs:"
crontab -l | grep -v "^#"
echo ""
echo "📝 To view logs:"
echo "   tail -f $PROJECT_DIR/logs/token_refresh.log"
echo ""
echo "🎉 Setup complete! Token will refresh daily at 7:45 AM IST"
