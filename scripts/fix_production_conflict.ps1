# PowerShell script to fix production merge conflict via SSH
# Run this from your local machine

$SERVER = "root@mydailytradesignals.com"

Write-Host "🔧 Fixing merge conflict on production server..." -ForegroundColor Cyan

# Create and upload the fix script
$fixScript = @'
#!/bin/bash
cd /var/www/mytradingSignal/backend

# Backup
cp main.py main.py.conflict.backup

# Remove conflict markers - keep incoming changes
awk '
/^<<<<<<< Updated upstream/ { skip=1; next }
/^=======/ { skip=0; next }
/^>>>>>>> / { next }
!skip { print }
' main.py > main.py.tmp && mv main.py.tmp main.py

# Validate
python3 -m py_compile main.py && pm2 restart backend
'@

# Execute on server
$fixScript | ssh $SERVER "cat > /tmp/fix_conflict.sh && chmod +x /tmp/fix_conflict.sh && bash /tmp/fix_conflict.sh"

Write-Host ""
Write-Host "✅ Fix applied! Check logs with:" -ForegroundColor Green
Write-Host "   ssh $SERVER 'pm2 logs backend --lines 50'" -ForegroundColor Yellow
