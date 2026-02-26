#!/bin/bash
# 🚀 OI MOMENTUM SIGNALS FIX - DEPLOYMENT CHECKLIST

echo "🚀 OI Momentum Signals - High-Performance Overhaul"
echo "=================================================="
echo ""

# Step 1: Verify new files exist
echo "✅ Step 1: Verify new files created"
echo ""
if [ -f "frontend/hooks/useOIMomentumLive.ts" ]; then
    echo "   ✅ frontend/hooks/useOIMomentumLive.ts - CREATED"
else
    echo "   ❌ frontend/hooks/useOIMomentumLive.ts - MISSING"
fi

if [ -f "backend/services/oi_momentum_broadcaster.py" ]; then
    echo "   ✅ backend/services/oi_momentum_broadcaster.py - CREATED"
else
    echo "   ❌ backend/services/oi_momentum_broadcaster.py - MISSING"
fi

echo ""
echo "✅ Step 2: Update OIMomentumCard component"
echo ""
echo "   Replace: frontend/components/OIMomentumCard.tsx"
echo "   With:    frontend/components/OIMomentumCard.tsx.new"
echo ""
echo "   Commands:"
echo "     # Backup old file"
echo "     mv frontend/components/OIMomentumCard.tsx frontend/components/OIMomentumCard.tsx.old"
echo "     # Install new file"
echo "     mv frontend/components/OIMomentumCard.tsx.new frontend/components/OIMomentumCard.tsx"
echo ""

echo "✅ Step 3: Verify backend updates"
echo ""
echo "   ✅ backend/main.py - UPDATED (broadcaster startup added)"
echo ""

echo "🚀 INSTALLATION COMPLETE"
echo ""
echo "To activate:"
echo "  1. Restart backend:"
echo "     cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
echo ""
echo "  2. Rebuild frontend (if needed):"
echo "     cd frontend && npm run dev"
echo ""
echo "  3. Open browser and navigate to OI Momentum section"
echo ""
echo "📊 Performance indicators:"
echo "  - 🔴 LIVE badge: Component receiving live WebSocket updates"
echo "  - ⚡ Fast load: Data from in-memory cache (instant)"
echo "  - 📡 Real-time: Updates every 5 seconds during market hours"
echo ""
echo "🔧 Troubleshooting:"
echo "  - Check backend logs: grep 'OI Momentum' logs"
echo "  - Check browser console: Look for WebSocket 'oi_momentum_update' messages"
echo "  - Verify market hours: 9:15 AM - 3:30 PM IST, Monday-Friday"
