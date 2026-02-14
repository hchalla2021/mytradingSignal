#!/bin/bash
# ==============================================================================
# PRODUCTION DEPLOYMENT - FINAL PREPARATION
# ==============================================================================

echo ""
echo "================================================================================"
echo "🚀 PRODUCTION DEPLOYMENT - FINAL PREPARATION"
echo "================================================================================"
echo ""

# Step 1: Update backend/.env for production
echo "📝 Step 1: Updating backend/.env for production..."
sed -i 's|^REDIRECT_URL=http://localhost:8000|# REDIRECT_URL=http://localhost:8000|' backend/.env
sed -i 's|^FRONTEND_URL=http://localhost:3000|# FRONTEND_URL=http://localhost:3000|' backend/.env
sed -i 's|^CORS_ORIGINS=http://localhost.*|# CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000|' backend/.env
sed -i 's|^# REDIRECT_URL=https://mydailytradesignals.com|REDIRECT_URL=https://mydailytradesignals.com|' backend/.env
sed -i 's|^# FRONTEND_URL=https://mydailytradesignals.com|FRONTEND_URL=https://mydailytradesignals.com|' backend/.env
sed -i 's|^# CORS_ORIGINS=https://mydailytradesignals.com|CORS_ORIGINS=https://mydailytradesignals.com|' backend/.env

echo "✅ backend/.env updated for production"
echo ""

# Step 2: Update frontend/.env.local for production
echo "📝 Step 2: Updating frontend/.env.local for production..."
sed -i 's|^NEXT_PUBLIC_API_URL=http://localhost:8000|# NEXT_PUBLIC_API_URL=http://localhost:8000|' frontend/.env.local
sed -i 's|^NEXT_PUBLIC_WS_URL=ws://localhost:8000|# NEXT_PUBLIC_WS_URL=ws://localhost:8000|' frontend/.env.local
sed -i 's|^NEXT_PUBLIC_ENVIRONMENT=local|# NEXT_PUBLIC_ENVIRONMENT=local|' frontend/.env.local
sed -i 's|^# NEXT_PUBLIC_API_URL=https://mydailytradesignals.com|NEXT_PUBLIC_API_URL=https://mydailytradesignals.com|' frontend/.env.local
sed -i 's|^# NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com|NEXT_PUBLIC_WS_URL=wss://mydailytradesignals.com|' frontend/.env.local
sed -i 's|^# NEXT_PUBLIC_ENVIRONMENT=production|NEXT_PUBLIC_ENVIRONMENT=production|' frontend/.env.local

echo "✅ frontend/.env.local updated for production"
echo ""

# Step 3: Verify changes
echo "📋 Step 3: Verifying configuration..."
echo ""
echo "Backend production URLs:"
grep "^REDIRECT_URL=" backend/.env
grep "^FRONTEND_URL=" backend/.env
grep "^CORS_ORIGINS=" backend/.env
echo ""
echo "Frontend production URLs:"
grep "^NEXT_PUBLIC_API_URL=" frontend/.env.local
grep "^NEXT_PUBLIC_WS_URL=" frontend/.env.local
grep "^NEXT_PUBLIC_ENVIRONMENT=" frontend/.env.local
echo ""

# Step 4: Git commit
echo "📦 Step 4: Committing changes..."
git add backend/.env frontend/.env.local
git commit -m "Production ready: Update URLs for deployment"
echo "✅ Changes committed"
echo ""

# Step 5: Final instructions
echo "================================================================================"
echo "✅ PRODUCTION PREPARATION COMPLETE"
echo "================================================================================"
echo ""
echo "📋 Next Steps:"
echo "   1. git push origin main"
echo "   2. SSH to Digital Ocean: ssh root@your-droplet-ip"
echo "   3. cd /opt/mytradingSignal && git pull origin main"
echo "   4. ./deploy_digitalocean.sh"
echo "   5. Login daily at 8:00-8:45 AM (Zerodha token refresh)"
echo ""
echo "📖 Documentation:"
echo "   • See: PRODUCTION_READINESS_REPORT.md"
echo "   • See: docs/DIGITAL_OCEAN_DEPLOYMENT_CHECKLIST.md"
echo "   • See: docs/DAILY_CHECKLIST.md"
echo ""
echo "================================================================================"
