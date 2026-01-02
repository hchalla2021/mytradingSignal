"""
Quick script to generate fresh Zerodha access token
Run this daily to refresh your token
"""
from kiteconnect import KiteConnect
import webbrowser
import os
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Get API credentials from environment variables
api_key = os.getenv('ZERODHA_API_KEY')
api_secret = os.getenv('ZERODHA_API_SECRET')

if not api_key or not api_secret:
    print("\n" + "="*70)
    print("❌ ERROR: Zerodha credentials not configured!")
    print("="*70)
    print("\nSet these in backend/.env:")
    print("  ZERODHA_API_KEY=your_api_key")
    print("  ZERODHA_API_SECRET=your_api_secret")
    print("\nGet credentials from: https://developers.kite.trade/apps\n")
    exit(1)

# Initialize Kite
kite = KiteConnect(api_key=api_key)

# Generate login URL
login_url = kite.login_url()

print("\n" + "="*70)
print("ZERODHA TOKEN GENERATOR")
print("="*70)
print("\n1. Opening Zerodha login page in browser...")
print(f"\nLogin URL:\n{login_url}\n")

# Open browser
webbrowser.open(login_url)

print("\n2. After logging in with your Zerodha credentials:")
print("   - You'll be redirected to: http://127.0.0.1:8000/api/auth/callback?...")
print("   - Copy the 'request_token' parameter from the URL")
print("   - Example: ...callback?request_token=ABC123&action=login")
print("   - Copy only: ABC123")

# Get request token from user
print("\n3. Paste the REQUEST_TOKEN here:")
request_token = input("REQUEST_TOKEN: ").strip()

try:
    # Generate session
    data = kite.generate_session(request_token, api_secret=api_secret)
    
    print("\n" + "="*70)
    print("✅ SUCCESS! NEW ACCESS TOKEN GENERATED")
    print("="*70)
    print(f"\nACCESS TOKEN:\n{data['access_token']}\n")
    print("="*70)
    print("\n4. Update your backend/.env file:")
    print(f"   ZERODHA_ACCESS_TOKEN={data['access_token']}")
    print("\n5. Restart your backend server")
    print("\nNote: This token expires in 24 hours. Run this script daily.\n")
    
except Exception as e:
    print(f"\n❌ ERROR: {e}")
    print("\nMake sure:")
    print("  - You copied the correct request_token")
    print("  - Token hasn't expired (valid for ~1 minute)")
    print("  - Try logging in again\n")
