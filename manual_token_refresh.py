#!/usr/bin/env python3
"""
Manual Token Refresh Script
Quick way to generate a new Zerodha access token
"""
import os
from kiteconnect import KiteConnect
from dotenv import load_dotenv

# Load environment variables
load_dotenv('backend/.env')

API_KEY = os.getenv('ZERODHA_API_KEY')
API_SECRET = os.getenv('ZERODHA_API_SECRET')

print("\n" + "="*60)
print("🔑 ZERODHA TOKEN GENERATOR")
print("="*60)
print(f"API Key: {API_KEY[:10]}...")
print()

# Step 1: Get login URL
kite = KiteConnect(api_key=API_KEY)
login_url = kite.login_url()

print("📋 STEP 1: Open this URL in your browser:")
print(f"   {login_url}")
print()
print("📋 STEP 2: Login with your Zerodha credentials")
print()
print("📋 STEP 3: After login, you'll be redirected to a URL like:")
print("   http://127.0.0.1:8000/api/auth/callback?request_token=ABC123...")
print()
print("📋 STEP 4: Copy the 'request_token' from that URL")
print("   (the part after 'request_token=')")
print()

request_token = input("🔑 Paste request_token here: ").strip()

if not request_token:
    print("❌ No token provided!")
    exit(1)

# Step 2: Generate session
try:
    print("\n🔄 Generating session...")
    data = kite.generate_session(request_token, api_secret=API_SECRET)
    
    access_token = data["access_token"]
    user_id = data["user_id"]
    user_name = data.get("user_name", "Unknown")
    
    print(f"\n✅ SESSION GENERATED!")
    print(f"   User: {user_name} ({user_id})")
    print(f"   Access Token: {access_token[:20]}...")
    
    # Step 3: Save to .env
    env_path = 'backend/.env'
    lines = []
    found = False
    
    with open(env_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    for i, line in enumerate(lines):
        if line.startswith("ZERODHA_ACCESS_TOKEN="):
            lines[i] = f"ZERODHA_ACCESS_TOKEN={access_token}\n"
            found = True
            break
    
    if not found:
        lines.append(f"ZERODHA_ACCESS_TOKEN={access_token}\n")
    
    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    
    print(f"\n💾 Token saved to {env_path}")
    print("\n🎉 SUCCESS! Restart your backend:")
    print("   1. Stop backend (Ctrl+C)")
    print("   2. Start: cd backend; python -m uvicorn main:app --reload")
    print("\n✅ Your token is now valid for 24 hours!")
    print("="*60 + "\n")
    
except Exception as e:
    print(f"\n❌ ERROR: {e}")
    print("\nMake sure:")
    print("  1. Request token is correct (copy the FULL string)")
    print("  2. Request token is fresh (use it within 5 minutes)")
    print("  3. API Secret in .env is correct")
    exit(1)
