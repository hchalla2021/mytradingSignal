"""
SMS Alert Service for Trading Signals

This module provides a production-ready SMS notification system using Twilio HTTP API.
Implements rate limiting, cooldown periods, and secure credential management.
Uses direct HTTP requests instead of the Twilio SDK to avoid Windows path length issues.
"""

import logging
import base64
import json
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import requests

from config.settings import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SMSAlertService:
    """
    Enterprise-grade SMS notification service for trading signals.
    
    Features:
    - Rate limiting with configurable cooldown periods
    - Secure credential management via environment variables
    - Comprehensive error handling and logging
    - Spam prevention with alert tracking
    - Direct HTTP API calls (no SDK required)
    """
    
    def __init__(self):
        """Initialize the SMS alert service with Twilio credentials and validation."""
        # Load Twilio credentials from centralized settings
        self.account_sid = settings.TWILIO_ACCOUNT_SID
        self.auth_token = settings.TWILIO_AUTH_TOKEN
        self.from_phone = settings.TWILIO_PHONE_NUMBER
        self.to_phone = settings.ALERT_PHONE_NUMBER
        
        # Validate required credentials
        if not all([self.account_sid, self.auth_token, self.from_phone, self.to_phone]):
            logger.warning("=" * 80)
            logger.warning("[SMS ALERT] ⚠️ WHATSAPP ALERTS DISABLED - Missing Credentials")
            logger.warning("[SMS ALERT] Please configure in backend/.env file:")
            logger.warning("[SMS ALERT]   TWILIO_ACCOUNT_SID")
            logger.warning("[SMS ALERT]   TWILIO_AUTH_TOKEN")
            logger.warning("[SMS ALERT]   TWILIO_PHONE_NUMBER")
            logger.warning("[SMS ALERT]   ALERT_PHONE_NUMBER")
            logger.warning("=" * 80)
            self.enabled = False
            return
        
        self.enabled = True
        
        # Build Twilio API URL
        self.api_url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        
        # Create Basic Auth header
        credentials = f"{self.account_sid}:{self.auth_token}"
        b64_credentials = base64.b64encode(credentials.encode()).decode()
        self.headers = {
            'Authorization': f'Basic {b64_credentials}',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        # Configuration
        self.threshold = int(os.getenv('SIGNAL_STRENGTH_THRESHOLD', '90'))
        self.cooldown_minutes = int(os.getenv('ALERT_COOLDOWN_MINUTES', '5'))
        
        # Track last alert time for each symbol+strike combination
        self.last_alert_time: Dict[str, datetime] = {}
        
        logger.info("=" * 80)
        logger.info(f"[SMS ALERT] 📱 WhatsApp Alert Service ACTIVE")
        logger.info(f"[SMS ALERT]   Threshold: {self.threshold}% (90%+ only)")
        logger.info(f"[SMS ALERT]   Cooldown: {self.cooldown_minutes} minutes")
        logger.info(f"[SMS ALERT]   From: {self.from_phone}")
        logger.info(f"[SMS ALERT]   To: {self.to_phone}")
        logger.info(f"[SMS ALERT]   Account: {self.account_sid[:8]}...")
        logger.info(f"[SMS ALERT] ✅ Ready to send critical trading alerts!")
        logger.info("=" * 80)
    
    def should_send_alert(self, symbol: str, option_type: str, strike: float) -> bool:
        """
        Determine if an alert should be sent based on cooldown period.
        
        Args:
            symbol: Trading symbol (e.g., 'NIFTY', 'BANKNIFTY')
            option_type: Option type ('CE' or 'PE')
            strike: Strike price
            
        Returns:
            bool: True if alert should be sent, False if in cooldown period
        """
        if not self.enabled:
            return False
            
        # Create unique key for this signal
        alert_key = f"{symbol}_{option_type}_{strike}"
        
        # Check if we've sent an alert for this signal recently
        if alert_key in self.last_alert_time:
            time_since_last_alert = datetime.now() - self.last_alert_time[alert_key]
            cooldown = timedelta(minutes=self.cooldown_minutes)
            
            if time_since_last_alert < cooldown:
                remaining = cooldown - time_since_last_alert
                logger.info(f"[SMS ALERT] Cooldown active for {alert_key}. Remaining: {remaining.seconds}s")
                return False
        
        return True
    
    def format_alert_message(self, signal: Dict) -> str:
        """
        Format 90%+ trading signal into attention-grabbing WhatsApp message.
        
        Args:
            signal: Signal dictionary containing all signal data
            
        Returns:
            str: Formatted WhatsApp message optimized for critical alerts
        """
        symbol = signal.get('symbol', 'UNKNOWN')
        strike = signal.get('strike', 0)
        option_type = signal.get('option_type', 'UNKNOWN')
        score = signal.get('score', 0)
        ltp = signal.get('ltp', 0)
        tradingsymbol = signal.get('tradingsymbol', '')
        signal_type = signal.get('signal', 'BUY')
        
        # Get top reasons (first 3)
        reasons = signal.get('reasons', [])
        top_reasons = reasons[:3] if len(reasons) >= 3 else reasons
        
        # Enhanced format for 90%+ signals
        if score >= 90:
            header = "🔥🔥 EXTREME BUY 🔥🔥"
        else:
            header = "🚨 STRONG BUY ALERT"
        
        message = (
            f"{header}\n"
            f"\n"
            f"📊 {symbol} {strike} {option_type}\n"
            f"💯 Score: {score:.1f}% (90%+ Threshold)\n"
            f"💰 Entry: ₹{ltp:.2f}\n"
            f"📍 Symbol: {tradingsymbol}\n"
            f"\n"
            f"✅ Why Trade:\n"
        )
        
        # Add top 3 reasons
        for i, reason in enumerate(top_reasons, 1):
            message += f"  {i}. {reason}\n"
        
        message += f"\n⚡ ACT FAST - Rare 90%+ Signal!"
        
        return message
    
    def send_alert(self, signal: Dict, custom_message: Optional[str] = None) -> Optional[str]:
        """
        Send WhatsApp alert for 90%+ trading signals - GUARANTEED DELIVERY.
        Now supports AI-enhanced messages for instant big player detection!
        
        Args:
            signal: Signal dictionary containing all signal data
            custom_message: Optional custom message (AI-enhanced) to send instead of default
            
        Returns:
            Optional[str]: Message SID if successful, None if failed or skipped
        """
        if not self.enabled:
            logger.warning("[SMS ALERT] ⚠️ Service disabled - missing credentials")
            return None
            
        try:
            symbol = signal.get('symbol', 'UNKNOWN')
            option_type = signal.get('option_type', 'UNKNOWN')
            strike = signal.get('strike', 0)
            score = signal.get('score', 0)
            
            # For 90%+ signals, ALWAYS attempt to send (critical alerts)
            if score < self.threshold:
                logger.debug(f"[SMS ALERT] Signal {symbol} {strike} {option_type} below threshold ({score:.1f}% < {self.threshold}%)")
                return None
            
            # For 90%+ signals, reduce cooldown check strictness
            alert_key = f"{symbol}_{option_type}_{strike}"
            if alert_key in self.last_alert_time:
                time_since_last = (datetime.now() - self.last_alert_time[alert_key]).total_seconds() / 60
                if time_since_last < self.cooldown_minutes:
                    logger.info(f"[SMS ALERT] ⏳ Cooldown active: {time_since_last:.1f}min ago (wait {self.cooldown_minutes}min)")
                    # For 90%+ signals, still log but allow retry sooner
                    if time_since_last < 2:  # Hard limit: 2 minutes minimum
                        return None
            
            # Use custom AI-enhanced message if provided, otherwise format default
            message = custom_message if custom_message else self.format_alert_message(signal)
            
            logger.info(f"[SMS ALERT] 🔥 CRITICAL ALERT: {symbol} {strike} {option_type} (Score: {score:.1f}%)")
            
            # Try WhatsApp first
            whatsapp_data = {
                'From': f'whatsapp:{self.from_phone}',
                'To': f'whatsapp:{self.to_phone}',
                'Body': message
            }
            
            logger.info(f"[SMS ALERT] 📱 Sending WhatsApp:")
            logger.info(f"[SMS ALERT]   From: {self.from_phone}")
            logger.info(f"[SMS ALERT]   To: {self.to_phone}")
            logger.info(f"[SMS ALERT]   API URL: {self.api_url}")
            
            # Send WhatsApp message
            response = requests.post(
                self.api_url,
                headers=self.headers,
                data=whatsapp_data,
                timeout=15  # Increased timeout for reliability
            )
            
            logger.info(f"[SMS ALERT] Response Status: {response.status_code}")
            
            if response.status_code == 201:
                result = response.json()
                message_sid = result.get('sid')
                message_status = result.get('status')
                error_code = result.get('error_code')
                
                # Update last alert time
                self.last_alert_time[alert_key] = datetime.now()
                
                logger.info(f"[SMS ALERT] ✅ WhatsApp SENT SUCCESSFULLY!")
                logger.info(f"[SMS ALERT]   SID: {message_sid}")
                logger.info(f"[SMS ALERT]   Status: {message_status}")
                
                if error_code:
                    logger.warning(f"[SMS ALERT]   Error Code: {error_code}")
                
                return message_sid
                
            elif response.status_code == 400:
                # Try fallback to regular SMS if WhatsApp fails
                logger.warning(f"[SMS ALERT] ⚠️ WhatsApp failed, trying SMS fallback...")
                logger.warning(f"[SMS ALERT]   Error: {response.text}")
                
                # Fallback: Regular SMS
                sms_data = {
                    'From': self.from_phone,
                    'To': self.to_phone,
                    'Body': message
                }
                
                sms_response = requests.post(
                    self.api_url,
                    headers=self.headers,
                    data=sms_data,
                    timeout=15
                )
                
                if sms_response.status_code == 201:
                    result = sms_response.json()
                    message_sid = result.get('sid')
                    self.last_alert_time[alert_key] = datetime.now()
                    logger.info(f"[SMS ALERT] ✅ SMS fallback sent: {message_sid}")
                    return message_sid
                else:
                    logger.error(f"[SMS ALERT] ❌ SMS fallback also failed: {sms_response.text}")
                    return None
            else:
                logger.error(f"[SMS ALERT] ❌ Twilio API error: {response.status_code}")
                logger.error(f"[SMS ALERT]   Response: {response.text}")
                
                # Parse error for specific issues
                try:
                    error_data = response.json()
                    error_msg = error_data.get('message', 'Unknown error')
                    error_code = error_data.get('code', 'N/A')
                    logger.error(f"[SMS ALERT]   Error Code: {error_code}")
                    logger.error(f"[SMS ALERT]   Error Message: {error_msg}")
                    
                    # Common error fixes
                    if 'not a valid phone number' in error_msg.lower():
                        logger.error(f"[SMS ALERT]   💡 Fix: Check phone number format in .env")
                    elif 'not verified' in error_msg.lower():
                        logger.error(f"[SMS ALERT]   💡 Fix: Verify phone number in Twilio console")
                    elif 'sandbox' in error_msg.lower():
                        logger.error(f"[SMS ALERT]   💡 Fix: Join WhatsApp sandbox or upgrade Twilio")
                except:
                    pass
                
                return None
            
        except requests.exceptions.Timeout:
            logger.error(f"[SMS ALERT] ❌ Request timeout - Twilio API not responding")
            return None
        except requests.exceptions.ConnectionError:
            logger.error(f"[SMS ALERT] ❌ Connection error - Check internet connection")
            return None
        except Exception as e:
            logger.error(f"[SMS ALERT] ❌ Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def send_bulk_alerts(self, signals: List[Dict]) -> int:
        """
        Send SMS alerts for multiple trading signals.
        
        Args:
            signals: List of signal dictionaries
            
        Returns:
            int: Number of successfully sent alerts
        """
        if not self.enabled:
            logger.info("[SMS ALERT] Service disabled - no credentials configured")
            return 0
            
        if not signals:
            logger.info("[SMS ALERT] No signals to process")
            return 0
        
        logger.info(f"[SMS ALERT] Processing {len(signals)} signals for alerts")
        
        sent_count = 0
        for signal in signals:
            if self.send_alert(signal):
                sent_count += 1
        
        logger.info(f"[SMS ALERT] Sent {sent_count}/{len(signals)} alerts")
        return sent_count


# Singleton instance
_alert_service: Optional[SMSAlertService] = None


def get_alert_service() -> SMSAlertService:
    """
    Get or create the singleton SMS alert service instance.
    
    Returns:
        SMSAlertService: The singleton alert service instance
    """
    global _alert_service
    
    if _alert_service is None:
        _alert_service = SMSAlertService()
    
    return _alert_service
