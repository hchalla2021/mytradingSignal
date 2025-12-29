"""Application configuration settings."""
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # ==================== ZERODHA API ====================
    zerodha_api_key: str = ""
    zerodha_api_secret: str = ""
    zerodha_access_token: str = ""
    zerodha_api_base_url: str = "https://kite.zerodha.com"
    zerodha_developers_url: str = "https://developers.kite.trade/apps"
    
    # ==================== OAUTH & REDIRECT ====================
    # Backend callback URL (where Zerodha redirects after login)
    redirect_url: str = ""  # Required: e.g., http://127.0.0.1:8000/api/auth/callback
    # Frontend URL (where backend redirects after auth)
    frontend_url: str = ""  # Required: e.g., http://localhost:3000
    
    # ==================== REDIS ====================
    redis_url: str = "redis://localhost:6379"
    redis_db: int = 0
    redis_password: Optional[str] = None
    
    # ==================== JWT ====================
    jwt_secret: str = "your-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    
    # ==================== SERVER ====================
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False  # Production mode
    cors_origins: str = "*"  # Comma-separated: http://localhost:3000,https://example.com
    
    # ==================== AI / LLM ====================
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-4o-mini"
    openai_temperature: float = 0.2
    openai_max_tokens: int = 500
    openai_timeout: int = 30  # seconds
    
    # ==================== NEWS API ====================
    news_api_key: Optional[str] = None
    news_api_base_url: str = "https://newsapi.org/v2/everything"
    news_api_page_size: int = 10
    news_api_lookback_hours: int = 24
    news_api_rate_limit_cooldown: int = 3600  # 1 hour in seconds
    news_http_timeout: int = 10  # seconds
    
    # Alternative AI providers (future support)
    anthropic_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    
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
    nifty_fut_token: int = 12683010       # NIFTY Current Month Future (update monthly!)
    banknifty_fut_token: int = 12674050   # BANKNIFTY Current Month Future (update monthly!)
    sensex_fut_token: int = 12683010      # Using NIFTY futures as proxy (SENSEX futures on BFO)
    
    # ==================== BUY-ON-DIP SETTINGS ====================
    buy_on_dip_update_interval: int = 60  # seconds between WebSocket updates
    buy_on_dip_signal_threshold: int = 70  # minimum score for BUY-ON-DIP signal (0-100)
    buy_on_dip_lookback_days: int = 2  # days of historical data to fetch
    buy_on_dip_default_interval: str = "5minute"  # default candle interval
    
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
    ai_analysis_interval: int = 180  # 3 minutes
    ai_retry_interval: int = 60  # 1 minute
    
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
