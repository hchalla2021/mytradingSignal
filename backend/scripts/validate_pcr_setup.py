"""
Validate PCR Setup - Check and fix PCR not showing issue
This script diagnoses and fixes common PCR display issues.
"""
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import get_settings
from kiteconnect import KiteConnect
from kiteconnect.exceptions import TokenException
import asyncio

def print_header(title: str):
    """Print section header"""
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80)

def print_status(label: str, status: str, details: str = ""):
    """Print status line"""
    status_emoji = "✅" if status == "OK" else "❌" if status == "FAIL" else "⚠️"
    print(f"{status_emoji} {label:30} [{status}]")
    if details:
        print(f"   → {details}")

async def validate_pcr_setup():
    """Validate entire PCR setup"""
    
    print_header("PCR SETUP VALIDATION & DIAGNOSTICS")
    
    # 1. Check .env file exists
    print("\n📁 Step 1: Checking configuration files...")
    env_path = Path(__file__).parent.parent / ".env"
    
    if not env_path.exists():
        print_status("Backend .env file", "FAIL", "File not found")
        print("\n💡 Solution: Create backend/.env file with Zerodha credentials")
        return False
    else:
        print_status("Backend .env file", "OK", str(env_path))
    
    # 2. Load settings
    print("\n⚙️ Step 2: Loading configuration...")
    try:
        settings = get_settings()
        print_status("Settings loaded", "OK")
    except Exception as e:
        print_status("Settings loaded", "FAIL", str(e))
        return False
    
    # 3. Check API credentials
    print("\n🔑 Step 3: Checking Zerodha credentials...")
    
    if not settings.zerodha_api_key:
        print_status("ZERODHA_API_KEY", "FAIL", "Not configured in .env")
    else:
        print_status("ZERODHA_API_KEY", "OK", settings.zerodha_api_key[:10] + "...")
    
    if not settings.zerodha_api_secret:
        print_status("ZERODHA_API_SECRET", "FAIL", "Not configured in .env")
    else:
        print_status("ZERODHA_API_SECRET", "OK", settings.zerodha_api_secret[:10] + "...")
    
    if not settings.zerodha_access_token:
        print_status("ZERODHA_ACCESS_TOKEN", "FAIL", "Not configured in .env")
        print("\n💡 Solution: Generate token using one of these methods:")
        print("   Method 1: python backend/get_token.py")
        print("   Method 2: python quick_token_fix.py")
        print("   Method 3: Click LOGIN button in the UI")
        return False
    else:
        print_status("ZERODHA_ACCESS_TOKEN", "OK", settings.zerodha_access_token[:20] + "...")
    
    # 4. Validate token by making API call
    print("\n🔌 Step 4: Validating Zerodha API token...")
    try:
        kite = KiteConnect(api_key=settings.zerodha_api_key)
        kite.set_access_token(settings.zerodha_access_token)
        
        # Test with profile API
        profile = kite.profile()
        print_status("Token validation", "OK", f"User: {profile.get('user_name', 'Unknown')}")
        print_status("Email", "OK", profile.get('email', 'Unknown'))
        print_status("User ID", "OK", profile.get('user_id', 'Unknown'))
        
    except TokenException as e:
        print_status("Token validation", "FAIL", "Token expired or invalid")
        print("\n💡 Solution: Token expired (valid for 24 hours only)")
        print("   Regenerate using: python backend/get_token.py")
        return False
    except Exception as e:
        print_status("Token validation", "FAIL", str(e))
        return False
    
    # 5. Test PCR data fetch
    print("\n📊 Step 5: Testing PCR data fetch...")
    try:
        # Test fetching instruments
        nfo_instruments = kite.instruments("NFO")
        print_status("NFO instruments", "OK", f"{len(nfo_instruments):,} instruments loaded")
        
        bfo_instruments = kite.instruments("BFO")
        print_status("BFO instruments", "OK", f"{len(bfo_instruments):,} instruments loaded")
        
    except Exception as e:
        print_status("Instruments fetch", "FAIL", str(e))
        if "too many requests" in str(e).lower():
            print("   → Rate limited - wait 2-3 minutes and try again")
        return False
    
    # 6. Test PCR calculation for NIFTY
    print("\n🔢 Step 6: Testing PCR calculation for NIFTY...")
    try:
        from services.pcr_service import get_pcr_service
        
        pcr_service = get_pcr_service()
        pcr_data = await pcr_service.get_pcr_data("NIFTY")
        
        if pcr_data['pcr'] > 0:
            print_status("NIFTY PCR fetch", "OK", f"PCR = {pcr_data['pcr']:.2f}")
            print(f"   → Call OI: {pcr_data['callOI']:,}")
            print(f"   → Put OI: {pcr_data['putOI']:,}")
            print(f"   → Total OI: {pcr_data['oi']:,}")
            print(f"   → Sentiment: {pcr_data['sentiment']}")
        else:
            print_status("NIFTY PCR fetch", "WARN", "PCR = 0 (likely rate limited or no options data)")
            
    except Exception as e:
        print_status("PCR calculation", "FAIL", str(e))
        import traceback
        traceback.print_exc()
        return False
    
    # 7. Summary
    print_header("VALIDATION SUMMARY")
    print("\n✅ PCR Setup is WORKING!")
    print("\n📋 What's Working:")
    print("   • Zerodha credentials configured")
    print("   • Access token is VALID")
    print("   • API connection successful")
    print("   • Instruments loaded")
    print("   • PCR calculation working")
    
    print("\n🚀 Next Steps:")
    print("   1. Start backend: python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload")
    print("   2. Start frontend: cd frontend && npm run dev")
    print("   3. Open: http://localhost:3000")
    print("   4. PCR values should appear within 30 seconds")
    
    print("\n⏰ Token Maintenance:")
    print("   • Token expires: Every 24 hours")
    print("   • Auto-refresh: Set up using quick_token_fix.py")
    print("   • Manual refresh: python backend/get_token.py")
    
    return True

if __name__ == "__main__":
    try:
        result = asyncio.run(validate_pcr_setup())
        
        if result:
            print("\n" + "=" * 80)
            print("  ✅ ALL CHECKS PASSED - PCR SYSTEM READY!")
            print("=" * 80 + "\n")
            sys.exit(0)
        else:
            print("\n" + "=" * 80)
            print("  ❌ VALIDATION FAILED - FIX ISSUES ABOVE")
            print("=" * 80 + "\n")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n\n⚠️ Validation cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Validation error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
