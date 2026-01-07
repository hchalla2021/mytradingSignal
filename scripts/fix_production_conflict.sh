#!/bin/bash
# Fix Git merge conflict in production main.py

cd /var/www/mytradingSignal/backend

echo "🔍 Checking for merge conflicts in main.py..."
if grep -q "<<<<<<< Updated upstream" main.py; then
    echo "⚠️  Merge conflict detected! Resolving..."
    
    # Backup current file
    cp main.py main.py.conflict.backup
    echo "💾 Backup created: main.py.conflict.backup"
    
    # Remove all Git conflict markers and keep the "Incoming Change" version
    sed -i '/<<<<<<< Updated upstream/,/=======/{//!d}' main.py
    sed -i '/=======/d' main.py
    sed -i '/>>>>>>> Stashed changes/d' main.py
    
    # Alternative: If the above doesn't work, use this more aggressive approach
    # grep -v -E '(<<<<<<< |=======|>>>>>>> )' main.py > main.py.clean
    # mv main.py.clean main.py
    
    echo "✅ Merge conflict resolved!"
    
    # Validate Python syntax
    echo "🔍 Validating Python syntax..."
    python3 -m py_compile main.py
    
    if [ $? -eq 0 ]; then
        echo "✅ Syntax valid!"
        
        # Restart backend service
        echo "🔄 Restarting backend..."
        pm2 restart backend
        
        echo "✅ Production backend restarted successfully!"
        echo ""
        echo "📊 Check status with: pm2 logs backend"
    else
        echo "❌ Syntax error still present. Restoring backup..."
        cp main.py.conflict.backup main.py
        echo "⚠️  Please resolve the conflict manually"
    fi
else
    echo "✅ No merge conflicts found in main.py"
fi
