#!/usr/bin/env python3
"""
Automated Token Refresh Script (Headless)
For production environments with valid session

This script:
1. Checks if current token is valid
2. If expired, attempts to use stored request_token
3. Falls back to manual refresh if needed
4. Updates .env file automatically
5. Can be run by cron jobs

Note: Initial setup requires manual login once to get request_token
"""
import os
import sys
from datetime import datetime
from pathlib import Path
from kiteconnect import KiteConnect
from dotenv import load_dotenv, set_key

# Load environment variables
env_path = Path(__file__).parent / 'backend' / '.env'
load_dotenv(env_path)

API_KEY = os.getenv('ZERODHA_API_KEY')
API_SECRET = os.getenv('ZERODHA_API_SECRET')
CURRENT_TOKEN = os.getenv('ZERODHA_ACCESS_TOKEN')

def log(message):
    """Print with timestamp"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{timestamp}] {message}")

def check_token_validity():
    """Check if current token is still valid"""
    if not CURRENT_TOKEN or CURRENT_TOKEN == "your_access_token_here":
        log("❌ No valid token found")
        return False
    
    try:
        kite = KiteConnect(api_key=API_KEY)
        kite.set_access_token(CURRENT_TOKEN)
        profile = kite.profile()
        log(f"✅ Current token valid for user: {profile.get('user_name', 'Unknown')}")
        return True
    except Exception as e:
        log(f"❌ Token validation failed: {e}")
        return False

def refresh_token_with_stored_request():
    """
    Attempt to refresh token using stored request_token
    Note: This only works if you have a stored valid request_token
    For first-time setup, use manual_token_refresh.py
    """
    stored_request_token = os.getenv('ZERODHA_REQUEST_TOKEN')
    
    if not stored_request_token:
        log("⚠️ No stored request_token found")
        log("💡 Run manual_token_refresh.py first to set up initial token")
        return False
    
    try:
        kite = KiteConnect(api_key=API_KEY)
        data = kite.generate_session(stored_request_token, api_secret=API_SECRET)
        
        access_token = data["access_token"]
        user_id = data["user_id"]
        
        # Save to .env
        set_key(env_path, "ZERODHA_ACCESS_TOKEN", access_token)
        
        log(f"✅ Token refreshed successfully for {user_id}")
        log(f"   New token: {access_token[:20]}...")
        return True
        
    except Exception as e:
        log(f"❌ Token refresh failed: {e}")
        return False

def main():
    log("🔄 Starting automatic token refresh...")
    log(f"   API Key: {API_KEY[:10] if API_KEY else 'NOT SET'}...")
    
    # Check if current token is valid
    if check_token_validity():
        log("✅ Token is still valid - no refresh needed")
        return 0
    
    # Token is invalid, try to refresh
    log("🔄 Token expired, attempting refresh...")
    
    if refresh_token_with_stored_request():
        log("🎉 Token refresh successful!")
        log("💡 Backend will auto-detect the new token (no restart needed)")
        return 0
    
    # If we get here, automatic refresh failed
    log("⚠️ Automatic refresh failed")
    log("📋 Manual intervention required:")
    log("   1. Run: python manual_token_refresh.py")
    log("   2. Or set up Zerodha API app for auto-login")
    return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
