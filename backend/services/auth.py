"""Authentication service with JWT tokens."""
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from jose import JWTError, jwt
from pydantic import BaseModel

from config import get_settings

settings = get_settings()


class TokenData(BaseModel):
    """Token payload data."""
    sub: str
    exp: datetime
    type: str = "access"


class AuthService:
    """JWT authentication service."""
    
    @staticmethod
    def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
        """Create a new access token."""
        to_encode = data.copy()
        expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
        to_encode.update({
            "exp": expire,
            "type": "access"
        })
        return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    
    @staticmethod
    def create_refresh_token(data: Dict[str, Any]) -> str:
        """Create a new refresh token (longer expiry)."""
        to_encode = data.copy()
        expire = datetime.utcnow() + timedelta(days=7)
        to_encode.update({
            "exp": expire,
            "type": "refresh"
        })
        return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    
    @staticmethod
    def verify_token(token: str) -> Optional[TokenData]:
        """Verify and decode a token."""
        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
            return TokenData(**payload)
        except JWTError:
            return None
    
    @staticmethod
    def get_zerodha_login_url() -> str:
        """Get Zerodha login URL for OAuth."""
        return f"https://kite.zerodha.com/connect/login?v=3&api_key={settings.zerodha_api_key}"


auth_service = AuthService()
