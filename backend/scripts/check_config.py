"""
Configuration Checker - Verify Zerodha API Setup
Run this script to diagnose API key issues
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
root_dir = Path(__file__).parent.parent
env_path = root_dir / ".env"
load_dotenv(dotenv_path=env_path, encoding='utf-8')

print("=" * 70)
print("🔍 ZERODHA API CONFIGURATION CHECKER")
print("=" * 70)

# Check if .env file exists
print(f"\n📁 Environment File:")
print(f"   Location: {env_path}")
print(f"   Exists: {'✅ Yes' if env_path.exists() else '❌ No'}")

if not env_path.exists():
    print("\n❌ ERROR: .env file not found!")
    print("   Fix: Copy .env.example to .env and add your credentials")
    exit(1)

# Check API credentials
print(f"\n🔑 Zerodha Credentials:")

api_key = os.getenv("ZERODHA_API_KEY", "")
api_secret = os.getenv("ZERODHA_API_SECRET", "")
access_token = os.getenv("ZERODHA_ACCESS_TOKEN", "")
redirect_url = os.getenv("REDIRECT_URL", "")

# Validate API Key
if not api_key:
    print("   API Key: ❌ NOT SET")
elif api_key == "g5tyrnn1mlckrb6f" or api_key == "your_api_key_here":
    print(f"   API Key: ⚠️  EXAMPLE KEY DETECTED: {api_key}")
    print("           You're using an example/demo key. This will NOT work!")
    print("           Get your REAL key from: https://developers.kite.trade/")
elif len(api_key) < 10:
    print(f"   API Key: ⚠️  TOO SHORT: {api_key}")
    print("           Valid Zerodha API keys are typically 16-32 characters")
else:
    print(f"   API Key: ✅ Set ({api_key[:8]}...{api_key[-4:]})")

# Validate API Secret
if not api_secret:
    print("   API Secret: ❌ NOT SET")
elif api_secret == "9qlzwmum5f7pami0gacyxc7uxa6w823s" or api_secret == "your_api_secret_here":
    print(f"   API Secret: ⚠️  EXAMPLE SECRET DETECTED")
    print("               You're using an example/demo secret. This will NOT work!")
elif len(api_secret) < 10:
    print(f"   API Secret: ⚠️  TOO SHORT")
else:
    print(f"   API Secret: ✅ Set ({api_secret[:8]}...)")

# Check Access Token
if not access_token:
    print("   Access Token: ⚠️  NOT SET (This is OK - will be generated after login)")
else:
    print(f"   Access Token: ✅ Set ({access_token[:12]}...)")
    print("                  Note: Tokens expire daily at 6 AM IST")

# Check Redirect URL
if not redirect_url:
    print("   Redirect URL: ❌ NOT SET")
elif "localhost:3000" not in redirect_url and "127.0.0.1:3000" not in redirect_url:
    print(f"   Redirect URL: ⚠️  {redirect_url}")
    print("                 Expected: http://localhost:3000/auth/callback")
else:
    print(f"   Redirect URL: ✅ {redirect_url}")

# Test Zerodha API connection
print(f"\n🔗 Testing Zerodha API Connection:")
if api_key and api_secret and api_key != "g5tyrnn1mlckrb6f":
    try:
        from kiteconnect import KiteConnect
        kite = KiteConnect(api_key=api_key)
        
        # Generate login URL (this will fail if API key is invalid)
        try:
            login_url = kite.login_url()
            print(f"   ✅ API Key is VALID!")
            print(f"   Login URL: {login_url[:80]}...")
            
            # Test if access token works (if set)
            if access_token:
                try:
                    kite.set_access_token(access_token)
                    profile = kite.profile()
                    print(f"   ✅ Access Token is VALID!")
                    print(f"   User: {profile.get('user_name', 'Unknown')} ({profile.get('email', 'N/A')})")
                    print(f"   User ID: {profile.get('user_id', 'N/A')}")
                except Exception as e:
                    print(f"   ⚠️  Access Token INVALID/EXPIRED: {e}")
                    print(f"       Fix: Login again via frontend")
        except Exception as e:
            error_str = str(e).lower()
            if "invalid" in error_str and "api_key" in error_str:
                print(f"   ❌ API Key is INVALID!")
                print(f"   Error: {e}")
                print(f"\n   🔧 FIX:")
                print(f"   1. Go to: https://developers.kite.trade/")
                print(f"   2. Create a new Kite Connect app (or use existing)")
                print(f"   3. Copy the REAL API Key and API Secret")
                print(f"   4. Update .env file with your credentials")
            else:
                print(f"   ⚠️  Connection Error: {e}")
    except ImportError:
        print("   ⚠️  kiteconnect library not installed")
        print("      Run: pip install kiteconnect")
    except Exception as e:
        print(f"   ❌ Error: {e}")
else:
    print("   ⏭️  Skipped (API key not set or using example key)")

# Check other services
print(f"\n📱 Optional Services:")

twilio_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "")
if twilio_sid and twilio_token:
    print(f"   WhatsApp Alerts: ✅ Configured")
else:
    print(f"   WhatsApp Alerts: ⚠️  Not configured (Optional)")

openai_key = os.getenv("OPENAI_API_KEY", "")
if openai_key and not openai_key.startswith("sk-proj-4s49"):
    print(f"   AI Analysis: ✅ Configured")
elif openai_key:
    print(f"   AI Analysis: ⚠️  Example key detected")
else:
    print(f"   AI Analysis: ⚠️  Not configured (Optional)")

# Summary
print(f"\n" + "=" * 70)
print(f"📊 SUMMARY:")
print("=" * 70)

issues = []
if not api_key or api_key == "g5tyrnn1mlckrb6f":
    issues.append("❌ Invalid/Missing API Key - GET YOUR REAL KEY!")
if not api_secret or api_secret == "9qlzwmum5f7pami0gacyxc7uxa6w823s":
    issues.append("❌ Invalid/Missing API Secret")
if not redirect_url:
    issues.append("⚠️  Missing Redirect URL")

if issues:
    print("\n🚨 ISSUES FOUND:")
    for issue in issues:
        print(f"   {issue}")
    print(f"\n🔧 NEXT STEPS:")
    print(f"   1. Open: https://developers.kite.trade/")
    print(f"   2. Create a Kite Connect app (if you don't have one)")
    print(f"   3. Copy YOUR API Key and API Secret")
    print(f"   4. Update .env file:")
    print(f"      ZERODHA_API_KEY=<your_real_api_key>")
    print(f"      ZERODHA_API_SECRET=<your_real_api_secret>")
    print(f"   5. Restart backend: python app.py")
    print(f"   6. Login via frontend: http://localhost:3000")
else:
    print("\n✅ Configuration looks good!")
    print(f"   Next: Login via frontend at http://localhost:3000")

print("=" * 70)
print(f"\n💡 Need help? Read: ZERODHA_SETUP_GUIDE.md")
print("=" * 70)
