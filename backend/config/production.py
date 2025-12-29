"""
Production Configuration
Environment-based settings for deployment
"""
import os
from typing import Optional

class ProductionConfig:
    """Production environment configuration."""
    
    # API Settings
    API_HOST: str = os.getenv("HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    
    # Zerodha Configuration
    ZERODHA_API_KEY: str = os.getenv("ZERODHA_API_KEY", "")
    ZERODHA_API_SECRET: str = os.getenv("ZERODHA_API_SECRET", "")
    ZERODHA_ACCESS_TOKEN: str = os.getenv("ZERODHA_ACCESS_TOKEN", "")
    REDIRECT_URL: str = os.getenv("REDIRECT_URL", "http://localhost:8000/api/auth/callback")
    
    # Security
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change-this-in-production")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    
    # Cache Settings
    REDIS_URL: Optional[str] = os.getenv("REDIS_URL")
    CACHE_EXPIRE_TIME: int = int(os.getenv("CACHE_EXPIRE_TIME", "300"))  # 5 minutes
    
    # Market Data Configuration - Loaded from env file via main config.py
    # See backend/.env for NIFTY_TOKEN, BANKNIFTY_TOKEN, SENSEX_TOKEN, etc.
    
    # WebSocket Configuration
    WS_PING_INTERVAL: int = 25  # seconds
    WS_RECONNECT_DELAY: int = 3  # seconds
    
    # Analysis Configuration
    ANALYSIS_UPDATE_INTERVAL: int = 3  # seconds
    ENABLE_TIME_FILTER: bool = os.getenv("ENABLE_TIME_FILTER", "False").lower() == "true"
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
    @classmethod
    def validate(cls) -> bool:
        """Validate required configuration."""
        if not cls.JWT_SECRET or cls.JWT_SECRET == "change-this-in-production":
            print("⚠️ WARNING: Using default JWT_SECRET - Change in production!")
            return False
        return True
    
    @classmethod
    def is_zerodha_configured(cls) -> bool:
        """Check if Zerodha credentials are configured."""
        return bool(cls.ZERODHA_API_KEY and cls.ZERODHA_ACCESS_TOKEN)
