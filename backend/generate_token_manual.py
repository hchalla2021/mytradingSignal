"""
MANUAL Token Generator - No Redirect URL Needed!
Run this when the Zerodha window closes automatically.
"""
from kiteconnect import KiteConnect
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

api_key = os.getenv('ZERODHA_API_KEY')
api_secret = os.getenv('ZERODHA_API_SECRET')

if not api_key or not api_secret:
    print("\n❌ ERROR: Missing API credentials in .env file!")
    print("   Add ZERODHA_API_KEY and ZERODHA_API_SECRET")
    exit(1)

kite = KiteConnect(api_key=api_key)

print("\n" + "="*70)
print("🔐 ZERODHA MANUAL TOKEN GENERATOR")
print("="*70)
print("\n📋 STEP-BY-STEP INSTRUCTIONS:")
print("-" * 70)

print("\n1️⃣  COPY this login URL:")
print(f"\n   {kite.login_url()}\n")

print("\n2️⃣  PASTE the URL in your browser and press Enter")

print("\n3️⃣  LOGIN to Zerodha with your credentials")

print("\n4️⃣  After login, you'll see this error page:")
print("    'This site can't be reached' or 'ERR_CONNECTION_REFUSED'")
print("    ⚠️  THIS IS NORMAL! Don't worry!")

print("\n5️⃣  COPY the full URL from browser address bar")
print("    It looks like:")
print("    http://127.0.0.1:8000/api/auth/callback?request_token=XXXXX&action=login&status=success")

print("\n6️⃣  PASTE the full URL here when prompted below")

print("\n" + "="*70)
print("⚠️  IMPORTANT: The 'request_token' expires in 2 minutes!")
print("    Complete steps quickly after logging in")
print("="*70)

# Get the callback URL from user
print("\n")
callback_url = input("Paste the full callback URL here: ").strip()

# Extract request_token from URL
try:
    if "request_token=" not in callback_url:
        print("\n❌ ERROR: No request_token found in URL!")
        print("   Make sure you copied the FULL URL from the error page")
        exit(1)
    
    # Parse request_token
    request_token = callback_url.split("request_token=")[1].split("&")[0]
    
    print(f"\n✅ Found request_token: {request_token[:20]}...")
    print("\n🔄 Generating access token...")
    
    # Generate session
    data = kite.generate_session(request_token, api_secret=api_secret)
    
    access_token = data["access_token"]
    user_id = data["user_id"]
    user_name = data.get("user_name", "Unknown")
    
    print("\n" + "="*70)
    print("✅ SUCCESS! TOKEN GENERATED")
    print("="*70)
    print(f"\nUser ID:      {user_id}")
    print(f"User Name:    {user_name}")
    print(f"\nAccess Token: {access_token}")
    
    # Update .env file
    env_path = ".env"
    if os.path.exists(env_path):
        print(f"\n📝 Updating {env_path}...")
        
        with open(env_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        # Update or add token line
        found = False
        for i, line in enumerate(lines):
            if line.startswith("ZERODHA_ACCESS_TOKEN="):
                lines[i] = f"ZERODHA_ACCESS_TOKEN={access_token}\n"
                found = True
                break
        
        if not found:
            lines.append(f"\nZERODHA_ACCESS_TOKEN={access_token}\n")
        
        with open(env_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        
        print("✅ .env file updated!")
    
    print("\n" + "="*70)
    print("🎉 ALL DONE!")
    print("="*70)
    print("\n📋 Next Steps:")
    print("\n1. Restart your backend server:")
    print("   cd backend")
    print("   python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload")
    print("\n2. PCR values will start showing in the UI!")
    print("\n⏰ Token valid for: 24 hours")
    print("   Run this script again tomorrow to refresh")
    print("\n")
    
except Exception as e:
    print(f"\n❌ ERROR: {e}")
    print("\nPossible reasons:")
    print("  • Request token expired (valid for 2 minutes only)")
    print("  • Incorrect URL format")
    print("  • Invalid API credentials")
    print("\n💡 Solution: Run this script again and complete steps faster!")
    print("\n")
