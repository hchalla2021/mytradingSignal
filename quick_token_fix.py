"""Quick token fix - Paste your request_token below"""
from kiteconnect import KiteConnect

# STEP 1: Paste your request_token here (from redirect URL)
REQUEST_TOKEN = input("Paste request_token from URL: ").strip()

# Your credentials
api_key = "g5tyrnn1mlckrb6f"
api_secret = "6cusjkixpyv7pii7c2rtei61ewcoxj3l"

try:
    kite = KiteConnect(api_key=api_key)
    data = kite.generate_session(REQUEST_TOKEN, api_secret=api_secret)
    
    print("\n" + "="*80)
    print("✅ SUCCESS! NEW TOKEN GENERATED")
    print("="*80)
    print(f"\nZERODHA_ACCESS_TOKEN={data['access_token']}\n")
    print("="*80)
    
    # Auto-update .env file
    env_path = "backend/.env"
    with open(env_path, 'r') as f:
        lines = f.readlines()
    
    with open(env_path, 'w') as f:
        for line in lines:
            if line.startswith('ZERODHA_ACCESS_TOKEN='):
                f.write(f"ZERODHA_ACCESS_TOKEN={data['access_token']}\n")
                print(f"✅ Updated {env_path}")
            else:
                f.write(line)
    
    print("\n🚀 TOKEN UPDATED! Now restart your backend:\n")
    print("   1. Stop backend (Ctrl+C)")
    print("   2. Start: uvicorn main:app --reload --host 0.0.0.0 --port 8000")
    print("\nAll features will work now! 🎉\n")
    
except Exception as e:
    print(f"\n❌ ERROR: {e}")
    print("\nMake sure you:")
    print("  1. Copied the FULL request_token")
    print("  2. Used it within 60 seconds")
    print("  3. Try logging in again\n")
