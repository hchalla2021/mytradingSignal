"""Authentication endpoints."""
from fastapi import APIRouter, HTTPException, Response, Cookie, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional
import os

from services.auth import auth_service
from config import get_settings

settings = get_settings()
router = APIRouter()


class LoginRequest(BaseModel):
    """Login request model."""
    request_token: str


class TokenResponse(BaseModel):
    """Token response model."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int


@router.get("/login-url")
async def get_login_url():
    """Get Zerodha login URL with redirect configuration."""
    login_url = f"{settings.zerodha_api_base_url}/connect/login?v=3&api_key={settings.zerodha_api_key}"
    return {
        "login_url": login_url,
        "api_key": settings.zerodha_api_key,
        "redirect_url": settings.redirect_url,
        "instructions": f"Set this redirect_url in your Zerodha app settings at {settings.zerodha_developers_url}"
    }


@router.get("/login")
async def redirect_to_zerodha():
    """Redirect to Zerodha login page instantly."""
    login_url = f"{settings.zerodha_api_base_url}/connect/login?v=3&api_key={settings.zerodha_api_key}"
    return RedirectResponse(url=login_url)


@router.get("/validate")
async def validate_token():
    """Check if current access token is configured.
    
    Returns INSTANTLY without making external API calls.
    WebSocket will handle actual Zerodha connection validation.
    
    Returns:
        - valid: True if token exists
        - authenticated: True if token is set
        - message: Status message
    """
    if not settings.zerodha_access_token:
        return {
            "valid": False,
            "authenticated": False,
            "message": "No access token configured"
        }
    
    # Token exists - return immediately without calling Zerodha
    # Actual validation happens when WebSocket connects
    return {
        "valid": True,
        "authenticated": True,
        "user_id": "user",  # Placeholder - real validation via WebSocket
        "user_name": "Authenticated User",
        "message": "Token configured"
    }


@router.get("/callback")
async def zerodha_callback(request_token: str = Query(...), status: str = Query(None), action: str = Query(None)):
    """
    Handle Zerodha OAuth callback (GET request from redirect).
    Exchange request_token for access_token and redirect back to frontend.
    """
    print(f"\n{'='*60}")
    print(f"🔐 ZERODHA CALLBACK RECEIVED")
    print(f"   Request Token: {request_token[:20]}...")
    print(f"   Status: {status}")
    print(f"   Action: {action}")
    print(f"{'='*60}\n")
    
    if status == "error":
        print("❌ Zerodha returned error status")
        return RedirectResponse(url=f"{settings.frontend_url}/?auth=error&message=Authentication cancelled")
    
    try:
        from kiteconnect import KiteConnect
        
        print("📡 Initializing KiteConnect...")
        kite = KiteConnect(api_key=settings.zerodha_api_key)
        
        print("🔄 Generating session with request token...")
        data = kite.generate_session(request_token, api_secret=settings.zerodha_api_secret)
        
        access_token = data["access_token"]
        user_id = data["user_id"]
        user_name = data.get("user_name", "Unknown")
        
        print(f"\n✅ SESSION GENERATED SUCCESSFULLY")
        print(f"   User ID: {user_id}")
        print(f"   User Name: {user_name}")
        print(f"   Access Token: {access_token[:20]}...")
        
        # Save access token to .env file for persistence
        env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        update_env_file(env_path, "ZERODHA_ACCESS_TOKEN", access_token)
        print(f"💾 Access token saved to .env file")
        
        # Update settings
        settings.zerodha_access_token = access_token
        
        # Trigger market feed reconnection
        try:
            from services.market_feed import market_feed_service
            print("🔄 Triggering market feed reconnection...")
            await market_feed_service.reconnect_with_new_token(access_token)
            print("✅ Market feed reconnected successfully")
        except Exception as e:
            print(f"⚠️ Auto-reconnect failed: {e}")
            print("   Backend will use new token on next restart")
        
        print(f"\n🎉 AUTHENTICATION COMPLETE - Redirecting to dashboard...\n")
        
        # Redirect to dashboard (home page) with success notification
        return RedirectResponse(url=f"{settings.frontend_url}/?auth=success&user_id={user_id}&user_name={user_name}")
        
    except Exception as e:
        print(f"\n❌ AUTHENTICATION FAILED")
        print(f"   Error: {e}")
        print(f"   Error Type: {type(e).__name__}")
        import traceback
        print(f"   Traceback:\n{traceback.format_exc()}")
        print(f"\n")
        # Redirect to dashboard with error notification
        error_msg = str(e).replace(' ', '+')  # URL encode spaces
        return RedirectResponse(url=f"{settings.frontend_url}/?auth=error&message={error_msg}")


def update_env_file(env_path: str, key: str, value: str):
    """Update a key in .env file with UTF-8 encoding to prevent charmap errors."""
    lines = []
    found = False
    
    # Use UTF-8 encoding to prevent Windows charmap codec errors
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}\n"
            found = True
            break
    
    if not found:
        lines.append(f"{key}={value}\n")
    
    # Write with UTF-8 encoding
    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)


@router.post("/refresh")
async def refresh_token(response: Response, refresh_token: Optional[str] = Cookie(None)):
    """Refresh access token using refresh token cookie."""
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token missing")
    
    token_data = auth_service.verify_token(refresh_token)
    if not token_data or token_data.type != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    
    # Create new access token
    new_access_token = auth_service.create_access_token({"sub": token_data.sub})
    
    return TokenResponse(
        access_token=new_access_token,
        expires_in=settings.access_token_expire_minutes * 60
    )


@router.post("/logout")
async def logout(response: Response):
    """Logout and clear refresh token."""
    response.delete_cookie("refresh_token")
    return {"message": "Logged out successfully"}
