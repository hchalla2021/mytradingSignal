"""
Twilio Alert Service - WhatsApp Notifications
Send critical trading alerts via WhatsApp
"""
try:
    from twilio.rest import Client
    TWILIO_AVAILABLE = True
except ImportError:
    TWILIO_AVAILABLE = False
    print("⚠️ Twilio not installed - WhatsApp alerts disabled")

from typing import Dict, Any, Optional
from datetime import datetime, timedelta
import os


class TwilioAlertService:
    """Send WhatsApp alerts for critical market events."""
    
    def __init__(self):
        """Initialize Twilio client."""
        if not TWILIO_AVAILABLE:
            self.enabled = False
            print("⚠️ Twilio package not available")
            return
            
        self.account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        self.auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        self.from_number = os.getenv("TWILIO_PHONE_NUMBER", "+14155238886")  # Sandbox default
        self.to_number = os.getenv("ALERT_PHONE_NUMBER")
        
        # Alert cooldown to prevent spam
        self.cooldown_minutes = int(os.getenv("ALERT_COOLDOWN_MINUTES", "5"))
        self.last_alert_time = {}
        
        # Initialize client if configured
        self.enabled = bool(self.account_sid and self.auth_token and self.to_number and TWILIO_AVAILABLE)
        if self.enabled:
            self.client = Client(self.account_sid, self.auth_token)
            print("✅ Twilio WhatsApp alerts enabled")
        else:
            print("⚠️ Twilio not configured - Alerts disabled")
    
    def send_alert(
        self,
        symbol: str,
        alert_type: str,
        message: str,
        details: Dict[str, Any]
    ) -> bool:
        """
        Send WhatsApp alert if conditions met.
        Returns True if sent, False if skipped
        """
        if not self.enabled:
            print(f"📱 Alert (disabled): {symbol} - {message}")
            return False
        
        # Check cooldown
        alert_key = f"{symbol}_{alert_type}"
        if not self._check_cooldown(alert_key):
            print(f"⏰ Alert cooldown active for {alert_key}")
            return False
        
        try:
            # Format message
            whatsapp_message = self._format_message(symbol, alert_type, message, details)
            
            # Send via Twilio
            result = self.client.messages.create(
                from_=f'whatsapp:{self.from_number}',
                body=whatsapp_message,
                to=f'whatsapp:{self.to_number}'
            )
            
            # Update cooldown
            self.last_alert_time[alert_key] = datetime.now()
            
            print(f"✅ WhatsApp alert sent: {result.sid}")
            return True
            
        except Exception as e:
            print(f"❌ Failed to send WhatsApp alert: {e}")
            return False
    
    def send_crash_alert(self, symbol: str, features: Dict[str, Any]) -> bool:
        """Send crash risk alert."""
        message = f"⚠️ CRASH RISK DETECTED"
        details = {
            "VIX": features.get('india_vix', 0),
            "Price": features.get('price', 0),
            "Change": f"{features.get('change_pct', 0):.2f}%",
            "Action": "AVOID LONG POSITIONS"
        }
        return self.send_alert(symbol, "CRASH_RISK", message, details)
    
    def send_strong_buy_alert(self, symbol: str, ai_result: Dict[str, Any]) -> bool:
        """Send strong buy signal alert."""
        signal = ai_result.get('signal', {})
        strength = signal.get('strength', 0)
        
        if strength < 80:
            return False
        
        message = f"🚀 STRONG BUY SIGNAL"
        details = {
            "Strength": f"{strength}%",
            "Confidence": f"{ai_result['ai_analysis']['confidence']:.0f}%",
            "Probability": f"{ai_result['ai_analysis']['bullish_probability']:.1f}%",
            "Price": f"₹{ai_result['price']:,.2f}",
            "Action": signal.get('action', 'Consider Long')
        }
        return self.send_alert(symbol, "STRONG_BUY", message, details)
    
    def send_buy_dip_alert(self, symbol: str, features: Dict[str, Any]) -> bool:
        """Send buy the dip alert."""
        # Conditions: Price near low, high volume, bullish sentiment
        near_low = features.get('near_low', False)
        volume_spike = features.get('volume_spike_pct', 0)
        pcr = features.get('pcr', 1.0)
        
        if not (near_low and volume_spike > 150 and pcr > 1.1):
            return False
        
        message = f"📉 BUY THE DIP OPPORTUNITY"
        details = {
            "Price": f"₹{features.get('price', 0):,.2f}",
            "Volume": f"{volume_spike:.0f}% spike",
            "PCR": f"{pcr:.2f} (Bullish)",
            "Position": "Near day low",
            "Action": "Consider accumulation"
        }
        return self.send_alert(symbol, "BUY_DIP", message, details)
    
    def send_institutional_activity(self, symbol: str, features: Dict[str, Any]) -> bool:
        """Send institutional activity alert."""
        volume_spike = features.get('volume_spike_pct', 0)
        oi_change = features.get('oi_change_pct', 0)
        
        if volume_spike < 300 or abs(oi_change) < 8:
            return False
        
        direction = "BUYING" if oi_change > 0 else "SELLING"
        message = f"🏦 INSTITUTIONAL {direction}"
        details = {
            "Volume": f"{volume_spike:.0f}% spike",
            "OI Change": f"{oi_change:.1f}%",
            "Price": f"₹{features.get('price', 0):,.2f}",
            "Action": f"FOLLOW SMART MONEY - {direction}"
        }
        return self.send_alert(symbol, "INSTITUTIONAL", message, details)
    
    def _check_cooldown(self, alert_key: str) -> bool:
        """Check if alert is off cooldown."""
        if alert_key not in self.last_alert_time:
            return True
        
        last_time = self.last_alert_time[alert_key]
        elapsed = (datetime.now() - last_time).total_seconds() / 60
        
        return elapsed >= self.cooldown_minutes
    
    def _format_message(
        self,
        symbol: str,
        alert_type: str,
        message: str,
        details: Dict[str, Any]
    ) -> str:
        """Format WhatsApp message."""
        lines = [
            f"📊 *MyDailyTradingSignals*",
            f"",
            f"*{symbol}*",
            f"{message}",
            f"",
            f"*Details:*"
        ]
        
        for key, value in details.items():
            lines.append(f"• {key}: {value}")
        
        lines.append("")
        lines.append(f"🕐 {datetime.now().strftime('%I:%M %p')}")
        lines.append("_Generated by AI Trading Engine_")
        
        return "\n".join(lines)
