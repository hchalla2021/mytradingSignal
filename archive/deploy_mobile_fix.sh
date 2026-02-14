#!/bin/bash
# 📱 DEPLOY ALL MOBILE BROWSERS FIX
# Deploys the mobile-optimized trading dashboard  
# Works on Chrome, Safari, Firefox, Samsung Internet, Opera, Edge

echo "🚀 DEPLOYING MOBILE-OPTIMIZED TRADING DASHBOARD"
echo "==============================================="
echo ""

# Check current directory
current_path=$(pwd)
echo "📁 Current directory: $current_path"

# Ensure we're in the correct directory
if [ ! -d "frontend" ]; then
    echo "❌ ERROR: frontend directory not found!"
    echo "   Please run this script from the project root directory."
    exit 1
fi

echo "✅ Frontend directory found"

# Navigate to frontend
echo ""
echo "📂 Entering frontend directory..."
cd frontend

# Check for package.json
if [ ! -f "package.json" ]; then
    echo "❌ ERROR: package.json not found in frontend!"
    exit 1
fi

echo "✅ Package.json found"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ ERROR: npm install failed!"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Clean build cache
echo ""
echo "🧹 Cleaning build cache..."
if [ -d ".next" ]; then
    rm -rf .next
    echo "✅ Build cache cleaned"
else
    echo "ℹ️  No build cache to clean"
fi

# Build the mobile-optimized version
echo ""
echo "🔨 Building mobile-optimized version..."
echo "   This includes optimizations for:"
echo "   • Chrome Mobile (Android/iOS)"
echo "   • Safari Mobile (iPhone/iPad)"
echo "   • Firefox Mobile (Android)"
echo "   • Samsung Internet (Android)"
echo "   • Opera Mobile (All platforms)"
echo "   • Edge Mobile (All platforms)"
echo ""

npm run build

if [ $? -ne 0 ]; then
    echo "❌ ERROR: Build failed!"
    exit 1
fi

echo "✅ Build completed successfully!"

# Display summary
echo ""
echo "🎉 MOBILE DEPLOYMENT SUCCESSFUL!"
echo "================================"
echo ""
echo "📱 Mobile Browser Support:"
echo "  ✅ Chrome Mobile (Android/iOS)"
echo "  ✅ Safari Mobile (iPhone/iPad)"
echo "  ✅ Firefox Mobile (Android)"
echo "  ✅ Samsung Internet (Android)"
echo "  ✅ Opera Mobile (All platforms)"
echo "  ✅ Edge Mobile (All platforms)"
echo ""

echo "🔧 Key Improvements:"
echo "  • Fixed SSR/hydration issues for mobile browsers"
echo "  • Extended WebSocket timeouts for mobile networks"
echo "  • Mobile-optimized error handling and recovery"
echo "  • Touch-optimized interface for all mobile devices"
echo "  • Mobile viewport optimization for all browsers"
echo ""

echo "🚀 Next Steps:"
echo "  1. Start the application: npm start"
echo "  2. Test on mobile devices: Open on phone/tablet"
echo "  3. Verify no 'Application error' on any mobile browser"
echo ""

echo "🌐 Start commands:"
echo "  Production: npm start"
echo "  Development: npm run dev"
echo ""

echo "📖 Documentation: docs/MOBILE_BROWSER_FIX_COMPLETE.md"
echo ""

# Ask if user wants to start the application
read -p "Would you like to start the application now? (y/N): " start_app

if [[ $start_app == "y" || $start_app == "Y" || $start_app == "yes" || $start_app == "Yes" ]]; then
    echo ""
    echo "🚀 Starting mobile-optimized trading dashboard..."
    echo "   Press Ctrl+C to stop the application"
    echo ""
    npm start
else
    echo ""
    echo "ℹ️  To start the application later, run: npm start"
    echo "   Or for development: npm run dev"
    echo ""
    echo "Happy trading! 📈📱"
fi

# Return to original directory
cd "$current_path"