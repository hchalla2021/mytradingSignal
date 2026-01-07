"""Authentication endpoints."""
from fastapi import APIRouter, HTTPException, Response, Cookie, Query
from fastapi.responses import RedirectResponse, HTMLResponse
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
        
        # Clear settings cache to reload new token immediately
        from config import get_settings
        get_settings.cache_clear()
        
        # 🔥 CRITICAL: Clear global token manager cache
        from services.global_token_manager import get_token_manager
        token_manager = get_token_manager()
        token_manager.force_recheck()
        print("🔄 Global token manager cache cleared - will revalidate immediately")
        
        # Verify token was saved correctly
        reloaded_settings = get_settings()
        saved_token = reloaded_settings.zerodha_access_token
        
        print(f"💾 Access token saved to .env file")
        print(f"🔄 Settings cache cleared - all services will use new token")
        print(f"✅ Verification: Token in memory matches saved token: {saved_token == access_token}")
        if saved_token != access_token:
            print(f"   ⚠️ WARNING: Token mismatch!")
            print(f"   → Original: {access_token[:20]}...")
            print(f"   → Saved: {saved_token[:20] if saved_token else 'NONE'}...")
        
        print(f"\n✅ TOKEN SAVED! File watcher will trigger automatic reconnection...")
        print(f"   No backend restart needed - connection will resume automatically")
        
        print(f"\n🎉 AUTHENTICATION COMPLETE - Redirecting to dashboard...\n")
        
        # Redirect to dashboard with auto-close script for popup
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Login Successful</title>
            <meta charset="utf-8">
            <style>
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }}
                .container {{
                    text-align: center;
                    padding: 40px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 20px;
                    backdrop-filter: blur(10px);
                    max-width: 500px;
                }}
                .icon {{
                    font-size: 64px;
                    margin-bottom: 20px;
                    animation: checkmark 0.8s ease;
                }}
                @keyframes checkmark {{
                    0% {{ transform: scale(0); }}
                    50% {{ transform: scale(1.2); }}
                    100% {{ transform: scale(1); }}
                }}
                .spinner {{
                    border: 3px solid rgba(255,255,255,0.3);
                    border-top: 3px solid white;
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                    margin: 20px auto;
                }}
                @keyframes spin {{
                    0% {{ transform: rotate(0deg); }}
                    100% {{ transform: rotate(360deg); }}
                }}
                .instructions {{
                    margin-top: 20px;
                    padding: 15px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 10px;
                    font-size: 14px;
                    line-height: 1.6;
                }}
                .btn {{
                    display: inline-block;
                    margin-top: 15px;
                    padding: 12px 24px;
                    background: rgba(255,255,255,0.2);
                    border: 2px solid rgba(255,255,255,0.3);
                    border-radius: 8px;
                    color: white;
                    text-decoration: none;
                    font-weight: bold;
                    transition: all 0.3s;
                }}
                .btn:hover {{
                    background: rgba(255,255,255,0.3);
                    transform: translateY(-2px);
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">✅</div>
                <h1>Login Successful!</h1>
                <p>Welcome, {user_name}</p>
                <div class="spinner"></div>
                <p id="status">Reconnecting to live market data...</p>
                <div class="instructions" id="instructions" style="display:none;">
                    <strong>⚠️ Frontend Not Running</strong>
                    <p>Please start the frontend server:</p>
                    <code style="display:block; margin:10px 0; padding:10px; background:rgba(0,0,0,0.3); border-radius:5px;">
                        cd frontend<br/>
                        npm run dev
                    </code>
                    <p>Then refresh this page or close this window.</p>
                </div>
                <a href="{settings.frontend_url}" class="btn" id="manualLink" style="display:none;">
                    Go to Dashboard
                </a>
            </div>
            <script>
                const frontendUrl = '{settings.frontend_url}';
                
                // Test if frontend is accessible
                async function testFrontend() {{
                    try {{
                        const response = await fetch(frontendUrl, {{ mode: 'no-cors' }});
                        return true;
                    }} catch (error) {{
                        return false;
                    }}
                }}
                
                // Main redirect logic
                async function handleRedirect() {{
                    const frontendRunning = await testFrontend();
                    
                    if (window.opener) {{
                        // Popup mode - wait longer to show success message
                        console.log('🎉 Auth successful, closing popup in 2 seconds...');
                        
                        // Update message
                        document.getElementById('status').innerHTML = '✅ Login successful!<br/>Closing window...';
                        
                        // Try to notify parent window if on same origin
                        try {{
                            if (window.opener && !window.opener.closed) {{
                                window.opener.postMessage({{ type: 'zerodha-auth-success', userId: '{user_id}' }}, '*');
                            }}
                        }} catch (e) {{
                            console.log('Cannot notify parent:', e);
                        }}
                        
                        // Close after showing success message (2 seconds)
                        setTimeout(() => {{
                            window.close();
                            
                            // Fallback: if window didn't close, show manual close button
                            setTimeout(() => {{
                                if (!window.closed) {{
                                    document.getElementById('status').innerHTML = 
                                        '✅ Login successful!<br/><br/>' +
                                        '<button onclick="window.close()" style="padding:10px 20px;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer;font-size:16px;">' +
                                        'Close Window' +
                                        '</button>';
                                }}
                            }}, 500);
                        }}, 2000);
                    }} else if (frontendRunning) {{
                        // Frontend is running - redirect
                        setTimeout(() => {{
                            window.location.href = frontendUrl;
                        }}, 2000);
                    }} else {{
                        // Frontend not running - show instructions
                        document.querySelector('.spinner')?.remove();
                        document.getElementById('status').textContent = 'Authentication complete!';
                        document.getElementById('instructions').style.display = 'block';
                        document.getElementById('manualLink').style.display = 'inline-block';
                    }}
                }}
                
                handleRedirect();
            </script>
        </body>
        </html>
        """
        
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content=html_content)
        
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
