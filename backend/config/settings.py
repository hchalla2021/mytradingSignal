"""
Configuration settings loaded from environment variables
All credentials and sensitive data are kept in .env file
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from root .env file
root_dir = Path(__file__).parent.parent.parent
env_path = root_dir / ".env"

# Force UTF-8 encoding to avoid 'charmap' codec errors on Windows
load_dotenv(dotenv_path=env_path, encoding='utf-8')

class Settings:
    """Application settings from environment variables"""
    
    # Zerodha API Configuration
    ZERODHA_API_KEY: str = os.getenv("ZERODHA_API_KEY", "")
    ZERODHA_API_SECRET: str = os.getenv("ZERODHA_API_SECRET", "")
    ZERODHA_ACCESS_TOKEN: str = os.getenv("ZERODHA_ACCESS_TOKEN", "")
    ZERODHA_REDIRECT_URL: str = os.getenv("REDIRECT_URL", "http://localhost:3000/auth/callback")
    
    # Twilio WhatsApp Configuration
    TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_PHONE_NUMBER: str = os.getenv("TWILIO_PHONE_NUMBER", "")
    ALERT_PHONE_NUMBER: str = os.getenv("ALERT_PHONE_NUMBER", "")
    
    # Alert Settings
    SIGNAL_STRENGTH_THRESHOLD: int = int(os.getenv("SIGNAL_STRENGTH_THRESHOLD", "90"))
    ALERT_COOLDOWN_MINUTES: int = int(os.getenv("ALERT_COOLDOWN_MINUTES", "15"))
    
    # Cache Settings
    CACHE_DURATION: float = 0.5  # 0.5 seconds for ultra-fast updates
    INSTRUMENTS_CACHE_DURATION: int = 300  # 5 minutes
    SPOT_PRICE_CACHE_DURATION: float = 0.5  # 0.5 seconds
    
    # OpenAI Configuration
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    
    # Server Settings
    PORT: int = int(os.getenv("PORT", "8001"))
    HOST: str = os.getenv("HOST", "0.0.0.0")
    
    @classmethod
    def validate(cls) -> bool:
        """Validate required settings are present"""
        required = [cls.ZERODHA_API_KEY, cls.ZERODHA_API_SECRET]
        return all(required)

settings = Settings()
