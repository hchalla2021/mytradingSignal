"""Quick token fix - Auto-opens browser and guides you through token generation"""
import webbrowser
import time
import os
from pathlib import Path
from kiteconnect import KiteConnect
from dotenv import load_dotenv

# Load environment variables from backend/.env
backend_env = Path(__file__).parent / 'backend' / '.env'
if backend_env.exists():
    load_dotenv(backend_env)
else:
    print("⚠️ backend/.env file not found, using environment variables...")

# Get credentials from environment variables
api_key = os.getenv('ZERODHA_API_KEY')
api_secret = os.getenv('ZERODHA_API_SECRET')

if not api_key or not api_secret:
    print("\n" + "="*80)
    print("❌ ERROR: Zerodha API credentials not found!")
    print("="*80)
    print("\nPlease set the following in backend/.env:")
    print("  ZERODHA_API_KEY=your_api_key")
    print("  ZERODHA_API_SECRET=your_api_secret")
    print("\nGet your credentials from: https://developers.kite.trade/apps")
    print("="*80 + "\n")
    exit(1)

print("\n" + "="*80)
print("🔧 ZERODHA TOKEN REGENERATION - QUICK FIX")
print("="*80)
print("\n📝 This will help you generate a fresh access token\n")

# Auto-open browser
login_url = f"https://kite.zerodha.com/connect/login?api_key={api_key}"
print(f"🌐 Opening Zerodha login in your browser...")
print(f"   URL: {login_url}\n")

try:
    webbrowser.open(login_url)
    time.sleep(2)
except:
    print("   ⚠️ Could not auto-open browser")
    print(f"   Please manually open: {login_url}\n")

print("📋 STEPS:")
print("   1. Login with your Zerodha User ID, Password, and PIN")
print("   2. After login, you'll be redirected to a URL like:")
print("      http://127.0.0.1:8000/api/auth/callback?request_token=XXXXXX&action=login")
print("   3. Copy the 'request_token' value (the XXXXXX part)")
print("   4. Paste it below\n")

# STEP 1: Paste your request_token here (from redirect URL)
REQUEST_TOKEN = input("📥 Paste request_token: ").strip()

if not REQUEST_TOKEN:
    print("\n❌ No token provided. Exiting...")
    exit(1)

if not REQUEST_TOKEN:
    print("\n❌ No token provided. Exiting...")
    exit(1)

print("\n🔄 Generating access token...")

try:
    kite = KiteConnect(api_key=api_key)
    data = kite.generate_session(REQUEST_TOKEN, api_secret=api_secret)
    
    print("\n" + "="*80)
    print("✅ SUCCESS! NEW TOKEN GENERATED")
    print("="*80)
    print(f"\nAccess Token: {data['access_token'][:20]}...")
    print(f"Valid Until: Tomorrow (24 hours)")
    print("="*80)
    
    # Auto-update .env file
    env_path = "backend/.env"
    print(f"\n💾 Updating {env_path}...")
    
    with open(env_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    updated = False
    with open(env_path, 'w', encoding='utf-8') as f:
        for line in lines:
            if line.startswith('ZERODHA_ACCESS_TOKEN='):
                f.write(f"ZERODHA_ACCESS_TOKEN={data['access_token']}\n")
                updated = True
            else:
                f.write(line)
    
    if updated:
        print(f"✅ Token updated in {env_path}")
    else:
        print(f"⚠️ Could not find ZERODHA_ACCESS_TOKEN line in .env")
        print(f"   Add this line to backend/.env:")
        print(f"   ZERODHA_ACCESS_TOKEN={data['access_token']}")
    
    print("\n🎉 TOKEN GENERATION COMPLETE!")
    print("\n🔄 NEXT STEPS:")
    print("   Your backend has a token file watcher and should auto-reconnect")
    print("   If not, restart the backend:")
    print("   1. Stop backend (Ctrl+C in backend terminal)")
    print("   2. Start: cd backend && python -m uvicorn main:app --reload")
    print("\n✅ Live data will now flow automatically during market hours!")
    print("="*80 + "\n")
    
except Exception as e:
    print(f"\n❌ ERROR: {e}")
    print("\n💡 TROUBLESHOOTING:")
    print("  1. Make sure you copied the COMPLETE request_token")
    print("  2. Tokens expire in 60 seconds - be quick!")
    print("  3. Try the process again from the beginning")
    print(f"  4. Open: {login_url}")
    print("\n="*80 + "\n")
