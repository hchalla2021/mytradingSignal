"""Quick check for market status and token validation"""
import sys
sys.path.insert(0, 'backend')

from datetime import datetime, time
import pytz
from config import get_settings

# Get settings
settings = get_settings()

# Indian timezone
IST = pytz.timezone('Asia/Kolkata')

# Market hours
PRE_OPEN_START = time(9, 0)
PRE_OPEN_END = time(9, 15)
MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 30)

print("=" * 80)
print("🔍 MARKET STATUS & TOKEN CHECK")
print("=" * 80)

# Current time
now = datetime.now(IST)
current_time = now.time()
print(f"\n📅 Current Date/Time (IST): {now.strftime('%Y-%m-%d %H:%M:%S %A')}")
print(f"   Weekday: {now.weekday()} (0=Mon, 6=Sun)")

# Check if weekend
is_weekend = now.weekday() >= 5
print(f"\n🗓️  Is Weekend: {'YES ❌' if is_weekend else 'NO ✅'}")

# Check market hours
if PRE_OPEN_START <= current_time < PRE_OPEN_END:
    status = "PRE_OPEN"
    color = "🟡"
elif MARKET_OPEN <= current_time <= MARKET_CLOSE:
    status = "LIVE"
    color = "🟢"
else:
    status = "CLOSED"
    color = "🔴"

print(f"\n{color} Market Status: {status}")
print(f"   Market Hours: 9:15 AM - 3:30 PM IST")
print(f"   Pre-Open: 9:00 AM - 9:15 AM IST")

# Token check
print("\n" + "=" * 80)
print("🔑 ZERODHA TOKEN STATUS")
print("=" * 80)

has_api_key = bool(settings.zerodha_api_key)
has_access_token = bool(settings.zerodha_access_token)

print(f"\nAPI Key: {'✅ Present' if has_api_key else '❌ MISSING'}")
if has_api_key:
    print(f"   Value: {settings.zerodha_api_key[:10]}...")

print(f"\nAccess Token: {'✅ Present' if has_access_token else '❌ MISSING'}")
if has_access_token:
    print(f"   Value: {settings.zerodha_access_token[:20]}...")
    print(f"   ⚠️ Note: Tokens expire daily at 3:30 AM IST")

# Test connection if token exists
if has_api_key and has_access_token:
    print("\n" + "=" * 80)
    print("🧪 TESTING ZERODHA CONNECTION")
    print("=" * 80)
    try:
        from kiteconnect import KiteConnect
        kite = KiteConnect(api_key=settings.zerodha_api_key)
        kite.set_access_token(settings.zerodha_access_token)
        
        print("\n📡 Fetching NIFTY quote to test connection...")
        quote = kite.quote(["NSE:NIFTY 50"])
        
        if quote and "NSE:NIFTY 50" in quote:
            nifty = quote["NSE:NIFTY 50"]
            print(f"✅ CONNECTION SUCCESSFUL!")
            print(f"\n📊 NIFTY 50:")
            print(f"   Last Price: {nifty['last_price']}")
            print(f"   Change: {nifty.get('change', 'N/A')}")
            print(f"   Volume: {nifty.get('volume', 0):,}")
            print(f"   Timestamp: {nifty.get('timestamp', 'N/A')}")
            print(f"\n✅ Your token is VALID and working!")
        else:
            print("❌ No data received from Zerodha")
            
    except Exception as e:
        error_msg = str(e)
        print(f"\n❌ CONNECTION FAILED: {error_msg}")
        
        if "TokenException" in error_msg or "token" in error_msg.lower():
            print("\n⚠️ TOKEN ERROR - Your access token is INVALID or EXPIRED")
            print("\n🔧 TO FIX:")
            print("1. Generate new token:")
            print(f"   https://kite.trade/connect/login?api_key={settings.zerodha_api_key}")
            print("2. Copy the request_token from redirect URL")
            print("3. Run: python backend/get_token.py")
            print("4. Update ZERODHA_ACCESS_TOKEN in .env")
        else:
            print(f"\n⚠️ Error: {error_msg}")
else:
    print("\n❌ Cannot test - API Key or Access Token missing in .env")

# Summary
print("\n" + "=" * 80)
print("📝 SUMMARY")
print("=" * 80)

if not is_weekend and status == "LIVE":
    if has_access_token:
        print("\n🟢 SHOULD BE WORKING:")
        print("   ✅ Market is OPEN")
        print("   ✅ Token is configured")
        print("   → If data not showing, token may be EXPIRED")
    else:
        print("\n🔴 PROBLEM:")
        print("   ✅ Market is OPEN")
        print("   ❌ Token is MISSING - Cannot fetch data")
elif status == "CLOSED" or is_weekend:
    print("\n🔴 Market is CLOSED:")
    print("   - App will show LAST TRADED prices")
    print("   - Live data will resume when market opens")
    print("   - Token needs to be valid for data to cache")

print("\n" + "=" * 80)
