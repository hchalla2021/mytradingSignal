"""Application configuration settings."""
from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache
from typing import Optional
import os
import socket


def detect_environment() -> str:
    """Auto-detect if running locally or in production.
    
    Detection logic:
    1. Check ENVIRONMENT variable (if set explicitly)
    2. Check hostname (if contains 'localhost', '127.0.0.1', or is local IP)
    3. Check if running in container (Docker/Kubernetes)
    4. Default to production for safety
    """
    # Check explicit environment setting
    env = os.getenv("ENVIRONMENT", "auto").lower()
    if env in ["local", "production"]:
        return env
    
    # Auto-detection
    hostname = socket.gethostname().lower()
    
    # Local indicators
    local_indicators = [
        "localhost",
        "127.0.0.1",
        hostname.startswith("desktop-"),
        hostname.startswith("laptop-"),
        hostname.startswith("pc-"),
        "local" in hostname,
    ]
    
    if any(local_indicators):
        return "local"
    
    # Check if running in local development (common dev patterns)
    if os.path.exists("/workspaces") or os.getenv("CODESPACES"):
        return "local"
    
    # Default to production
    return "production"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # ==================== ZERODHA API ====================
    zerodha_api_key: str = ""
    zerodha_api_secret: str = ""
    zerodha_access_token: str = ""
    zerodha_api_base_url: str = "https://kite.zerodha.com"
    zerodha_developers_url: str = "https://developers.kite.trade/apps"
    
    # ==================== OAUTH & REDIRECT ====================
    # Environment detection
    environment: str = Field(default="auto", env="ENVIRONMENT")
    
    # Local URLs
    local_redirect_url: str = Field(default="http://127.0.0.1:8000/api/auth/callback", env="LOCAL_REDIRECT_URL")
    local_frontend_url: str = Field(default="http://localhost:3000", env="LOCAL_FRONTEND_URL")
    
    # Production URLs
    production_redirect_url: str = Field(default="https://mydailytradesignals.com/api/auth/callback", env="PRODUCTION_REDIRECT_URL")
    production_frontend_url: str = Field(default="https://mydailytradesignals.com", env="PRODUCTION_FRONTEND_URL")
    
    # Legacy support (will be overridden by smart detection)
    redirect_url: str = ""
    frontend_url: str = ""
    
    # ==================== REDIS ====================
    redis_url: str = "redis://localhost:6379"
    redis_db: int = 0
    redis_password: Optional[str] = None
    
    # ==================== JWT ====================
    jwt_secret: str = Field(default="", env="JWT_SECRET")  # MUST be set in production!
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    
    # ==================== SERVER ====================
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False  # Production mode
    cors_origins: str = "*"  # Comma-separated: http://localhost:3000,https://example.com
    
    # ==================== MARKET HOURS SCHEDULER ====================
    enable_scheduler: bool = True  # Set to False for localhost testing anytime
    
    # ==================== AI / LLM (DISABLED) ====================
    # AI Engine removed - using InstantSignal analysis only
    # openai_api_key: Optional[str] = None
    # openai_model: str = "gpt-4o-mini"
    # openai_temperature: float = 0.2
    # openai_max_tokens: int = 500
    # openai_timeout: int = 30  # seconds
    
    # ==================== NEWS API (DISABLED) ====================
    # news_api_key: Optional[str] = None
    # news_api_base_url: str = "https://newsapi.org/v2/everything"
    # news_api_page_size: int = 10
    # news_api_lookback_hours: int = 24
    # news_api_rate_limit_cooldown: int = 3600  # 1 hour in seconds
    # news_http_timeout: int = 10  # seconds
    
    # Alternative AI providers (future support) - DISABLED
    # anthropic_api_key: Optional[str] = None
    # google_api_key: Optional[str] = None
    # groq_api_key: Optional[str] = None
    
    # ==================== NOTIFICATIONS (Optional) ====================
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_phone_number: Optional[str] = None
    alert_phone_numbers: str = ""  # Comma-separated phone numbers
    
    # Email notifications
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    alert_email_to: str = ""  # Comma-separated emails
    
    # ==================== INSTRUMENT TOKENS ====================
    nifty_token: int = 256265      # NIFTY 50 (NSE) - for price
    banknifty_token: int = 260105  # BANK NIFTY (NSE) - for price
    sensex_token: int = 265        # SENSEX (BSE) - for price
    finnifty_token: int = 257801   # FINNIFTY (NSE)
    midcpnifty_token: int = 288009 # MIDCPNIFTY (NSE)
    
    # FUTURES TOKENS - FOR VOLUME DATA (indices don't have volume!)
    # Note: These need to be updated monthly when contracts expire!
    # Format: NFO:SYMBOL25JANFUT (JAN 2025 expiry example)
    # Run backend/scripts/find_futures_tokens.py to get current month tokens
    nifty_fut_token: int = Field(default=12683010, env="NIFTY_FUT_TOKEN")  # NIFTY Current Month Future
    banknifty_fut_token: int = Field(default=12674050, env="BANKNIFTY_FUT_TOKEN")  # BANKNIFTY Current Month Future
    sensex_fut_token: int = Field(default=292786437, env="SENSEX_FUT_TOKEN")  # SENSEX26JANFUT (Updated: Dec 30, 2025)
    # ✅ SENSEX futures ARE available on BFO exchange (BSE Futures & Options)
    
    # ==================== PERFORMANCE & TIMING ====================
    # WebSocket settings
    ws_ping_interval: int = 25  # seconds
    ws_reconnect_delay: int = 3  # seconds
    ws_timeout: int = 60  # seconds
    
    # Market feed settings
    market_feed_retry_interval: int = 30  # seconds
    ticker_reconnect_wait: int = 2  # seconds
    
    # Analysis settings
    analysis_update_interval: int = 3  # seconds
    # ai_analysis_interval: int = 180  # REMOVED - AI Engine disabled
    # ai_retry_interval: int = 60  # REMOVED - AI Engine disabled
    
    # Cache settings
    pcr_cache_ttl: int = 30  # seconds
    market_data_cache_ttl: int = 5  # seconds
    instruments_cache_days: int = 1  # days
    advanced_analysis_cache_ttl: int = 5  # seconds for Volume Pulse, Trend Base, News
    
    # PCR fetch delays (stagger to avoid rate limits)
    pcr_delay_nifty: int = 0  # seconds
    pcr_delay_banknifty: int = 10  # seconds
    pcr_delay_sensex: int = 20  # seconds
    
    # ==================== RATE LIMITS ====================
    zerodha_rate_limit_per_second: int = 3
    zerodha_backoff_multiplier: float = 1.5
    zerodha_max_backoff: int = 60  # seconds
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"
    
    def __init__(self, **kwargs):
        """Initialize settings with environment auto-detection."""
        super().__init__(**kwargs)
        
        # Detect environment
        detected_env = detect_environment()
        print(f"🌍 Environment detected: {detected_env.upper()}")
        
        # Auto-select URLs based on environment
        if detected_env == "local":
            self.redirect_url = self.local_redirect_url
            self.frontend_url = self.local_frontend_url
            print(f"   → Redirect URL: {self.redirect_url}")
            print(f"   → Frontend URL: {self.frontend_url}")
        else:
            self.redirect_url = self.production_redirect_url
            self.frontend_url = self.production_frontend_url
            print(f"   → Redirect URL: {self.redirect_url}")
            print(f"   → Frontend URL: {self.frontend_url}")
    
    @property
    def is_production(self) -> bool:
        """Check if running in production."""
        return detect_environment() == "production"
    
    @property
    def is_local(self) -> bool:
        """Check if running locally."""
        return detect_environment() == "local"
    
    @property
    def cors_origins_list(self) -> list:
        """Parse CORS origins from comma-separated string."""
        if self.cors_origins == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
    
    @property
    def alert_phones_list(self) -> list:
        """Parse alert phone numbers from comma-separated string."""
        return [phone.strip() for phone in self.alert_phone_numbers.split(",") if phone.strip()]
    
    @property
    def alert_emails_list(self) -> list:
        """Parse alert emails from comma-separated string."""
        return [email.strip() for email in self.alert_email_to.split(",") if email.strip()]


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
