"""
CENTRALIZED MARKET AUTO-START SYSTEM (Python Version)
======================================================

Alternative to Node.js version. Use this if you prefer Python.

Features:
- Auto-starts backend at 9 AM on market days
- Monitors health every 10 minutes
- Auto-restarts if backend crashes
- Logs all activity for debugging

Usage:
  1. Install: pip install APScheduler requests python-dateutil
  2. Deploy: Copy to /var/www/mytradingSignal/market_auto_start.py
  3. Run with PM2: pm2 start market_auto_start.py --interpreter python3
  4. Save: pm2 save && pm2 startup
"""

import schedule
import time
import subprocess
import sys
import os
import logging
from datetime import datetime, timedelta
from pathlib import Path
import requests
import json

# ============= CONFIGURATION =============

PROJECT_PATH = "/var/www/mytradingSignal"
BACKEND_NAME = "backend"
BACKEND_CMD = f"cd {PROJECT_PATH} && pm2 start backend/main.py --name {BACKEND_NAME} --interpreter python3"
LOG_DIR = Path("/var/log/mytradingSignal")
LOG_FILE = LOG_DIR / "market-auto-start.log"
ERROR_LOG = LOG_DIR / "market-auto-start-error.log"

# Market timings (IST)
MARKET_OPEN_TIME = "09:00"  # 9:00 AM
MARKET_CLOSE_TIME = "15:30"  # 3:30 PM
PREOPEN_END_TIME = "09:15"   # Pre-open ends at 9:15 AM
LIVE_START_TIME = "09:15"    # Live trading starts at 9:15 AM

# NSE/BSE Holidays
HOLIDAYS_2026 = [
    "2026-01-26", "2026-03-25", "2026-04-02", "2026-05-01",
    "2026-07-17", "2026-08-15", "2026-09-02", "2026-10-02",
    "2026-10-25", "2026-11-01", "2026-11-11", "2026-12-25"
]

HOLIDAYS_2027 = [
    "2027-01-26", "2027-03-14", "2027-04-02", "2027-05-01",
    "2027-07-06", "2027-08-15", "2027-08-19", "2027-10-02",
    "2027-10-16", "2027-10-20", "2027-10-21", "2027-12-25"
]

ALL_HOLIDAYS = HOLIDAYS_2026 + HOLIDAYS_2027

# ============= LOGGER SETUP =============

def setup_logger():
    """Configure logging to both file and console"""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    
    logger = logging.getLogger("market_scheduler")
    logger.setLevel(logging.DEBUG)
    
    # File handler for main log
    file_handler = logging.FileHandler(LOG_FILE)
    file_handler.setLevel(logging.DEBUG)
    
    # File handler for errors
    error_handler = logging.FileHandler(ERROR_LOG)
    error_handler.setLevel(logging.ERROR)
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    
    # Formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    file_handler.setFormatter(formatter)
    error_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)
    
    logger.addHandler(file_handler)
    logger.addHandler(error_handler)
    logger.addHandler(console_handler)
    
    return logger

logger = setup_logger()

# ============= MARKET FUNCTIONS =============

def is_market_day():
    """
    Check if today is a trading day
    Trading days: Monday-Friday, excluding holidays
    """
    now = datetime.now()
    day_of_week = now.weekday()  # 0 = Monday, 6 = Sunday
    
    # Skip weekends (5 = Friday, 6 = Saturday, 0 = Sunday becomes 7)
    if day_of_week >= 5:  # Saturday or Sunday
        return False
    
    # Check if it's a holiday
    date_str = now.strftime("%Y-%m-%d")
    if date_str in ALL_HOLIDAYS:
        logger.info(f"📅 Today is a market holiday: {date_str}")
        return False
    
    return True

def get_ist_time():
    """Get current time in IST (UTC+5:30)"""
    return datetime.now() + timedelta(hours=5, minutes=30)

def is_within_market_hours():
    """Check if current time is within market trading hours"""
    ist_time = get_ist_time()
    current_time = ist_time.strftime("%H:%M")
    
    return MARKET_OPEN_TIME <= current_time <= MARKET_CLOSE_TIME

def is_preopen_period():
    """Check if we're in pre-open period (9:00 - 9:15)"""
    ist_time = get_ist_time()
    current_time = ist_time.strftime("%H:%M")
    
    return MARKET_OPEN_TIME <= current_time < PREOPEN_END_TIME

def is_live_trading_period():
    """Check if we're in live trading period (9:15 - 3:30)"""
    ist_time = get_ist_time()
    current_time = ist_time.strftime("%H:%M")
    
    return LIVE_START_TIME <= current_time <= MARKET_CLOSE_TIME

# ============= BACKEND MANAGEMENT =============

def is_backend_running():
    """Check if backend is running via PM2"""
    try:
        result = subprocess.run(
            ["pm2", "list", "--silent"],
            capture_output=True,
            text=True,
            timeout=5
        )
        return BACKEND_NAME in result.stdout and "online" in result.stdout
    except Exception as e:
        logger.error(f"Failed to check PM2 status: {e}")
        return False

def start_backend():
    """Start backend using PM2"""
    try:
        logger.info("🚀 Starting backend...")
        subprocess.run(
            BACKEND_CMD,
            shell=True,
            check=True,
            capture_output=True,
            timeout=30
        )
        logger.info("✅ Backend started successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to start backend: {e}")
        return False

def restart_backend():
    """Restart backend using PM2"""
    try:
        logger.info("🔄 Restarting backend...")
        subprocess.run(
            f"pm2 restart {BACKEND_NAME}",
            shell=True,
            check=True,
            capture_output=True,
            timeout=30
        )
        logger.info("✅ Backend restarted successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to restart backend: {e}")
        return False

def health_check_backend():
    """Check if backend is responding to HTTP requests"""
    try:
        response = requests.get("http://localhost:8000/health", timeout=3)
        return response.status_code == 200
    except Exception as e:
        logger.debug(f"Health check failed: {e}")
        return False

# ============= MAIN SCHEDULER LOGIC =============

def check_and_start_backend():
    """Main function: Check if should start backend"""
    ist_time = get_ist_time()
    time_str = ist_time.strftime("%Y-%m-%d %H:%M:%S IST")
    
    print(f"\n🕐 Market Scheduler Check - {time_str}")
    
    # Check if market is open
    if not is_market_day():
        logger.debug("📊 Market closed (weekend or holiday)")
        return
    
    if not is_within_market_hours():
        logger.debug("⏰ Outside market hours")
        return
    
    # Log status
    logger.info("=" * 60)
    logger.info("=== MARKET DAY & TRADING HOURS ===")
    logger.info(f"🕐 Current Time (IST): {time_str}")
    
    if is_preopen_period():
        logger.info("📻 PRE-OPEN PERIOD (9:00-9:15): Values frozen, no live feed")
    else:
        logger.info("📈 LIVE TRADING PERIOD (9:15-3:30): Live values streaming")
    
    # Check backend status
    backend_running = is_backend_running()
    
    if not backend_running:
        logger.warning("🔴 Backend is DOWN - Starting now...")
        
        # Try to start
        if start_backend():
            logger.info("⏳ Waiting 5 seconds for backend to initialize...")
            time.sleep(5)
            
            # Health check
            if health_check_backend():
                logger.info("✅ Health check PASSED - Backend is responsive")
            else:
                logger.warning("⚠️ Health check FAILED - Backend started but may not be responsive yet")
    else:
        logger.info("✅ Backend is already running")
        
        # Health check even if running
        if not health_check_backend():
            logger.warning("⚠️ Backend not responding - attempting restart...")
            restart_backend()
    
    logger.info("=" * 60)

def market_open_event():
    """Called at 9:00 AM - Market opens"""
    logger.info("\n" + "=" * 60)
    logger.info("⏰ 9:00 AM - MARKET OPEN EVENT")
    logger.info("🟠 PRE-OPEN PERIOD STARTING (9:00-9:15)")
    logger.info("📊 Values will be frozen, no live feed yet")
    logger.info("=" * 60)
    check_and_start_backend()

def live_trading_event():
    """Called at 9:15 AM - Live trading starts"""
    logger.info("\n" + "=" * 60)
    logger.info("⏰ 9:15 AM - LIVE TRADING STARTED")
    logger.info("🟢 LIVE TRADING PERIOD (9:15-3:30)")
    logger.info("📈 Live market values streaming from WebSocket")
    logger.info("=" * 60)

def market_close_event():
    """Called at 3:30 PM - Market closes"""
    logger.info("\n" + "=" * 60)
    logger.info("⏰ 3:30 PM - MARKET CLOSED")
    logger.info("🔴 MARKET CLOSED FOR THE DAY")
    logger.info("📉 Live feed will stop, values will freeze")
    logger.info("=" * 60)

def health_check_scheduled():
    """Periodic health check during market hours"""
    if is_market_day() and is_within_market_hours():
        backend_running = is_backend_running()
        if not backend_running:
            logger.warning("⚠️ Backend crashed during market hours - Restarting...")
            check_and_start_backend()
        else:
            logger.debug("✅ Periodic health check PASSED")

# ============= SCHEDULER SETUP =============

def setup_schedules():
    """Setup all cron jobs"""
    
    # Job 1: Every minute - Check if should start backend
    schedule.every(1).minutes.do(check_and_start_backend)
    logger.info("📅 Scheduled: Check every minute if should start backend")
    
    # Job 2: 9:00 AM on market days - Market open
    schedule.every().monday.at("09:00").do(market_open_event)
    schedule.every().tuesday.at("09:00").do(market_open_event)
    schedule.every().wednesday.at("09:00").do(market_open_event)
    schedule.every().thursday.at("09:00").do(market_open_event)
    schedule.every().friday.at("09:00").do(market_open_event)
    logger.info("📅 Scheduled: Market open at 9:00 AM (Mon-Fri)")
    
    # Job 3: 9:15 AM on market days - Live trading starts
    schedule.every().monday.at("09:15").do(live_trading_event)
    schedule.every().tuesday.at("09:15").do(live_trading_event)
    schedule.every().wednesday.at("09:15").do(live_trading_event)
    schedule.every().thursday.at("09:15").do(live_trading_event)
    schedule.every().friday.at("09:15").do(live_trading_event)
    logger.info("📅 Scheduled: Live trading at 9:15 AM (Mon-Fri)")
    
    # Job 4: 3:30 PM on market days - Market close
    schedule.every().monday.at("15:30").do(market_close_event)
    schedule.every().tuesday.at("15:30").do(market_close_event)
    schedule.every().wednesday.at("15:30").do(market_close_event)
    schedule.every().thursday.at("15:30").do(market_close_event)
    schedule.every().friday.at("15:30").do(market_close_event)
    logger.info("📅 Scheduled: Market close at 3:30 PM (Mon-Fri)")
    
    # Job 5: Health check every 10 minutes during market hours
    schedule.every(10).minutes.do(health_check_scheduled)
    logger.info("📅 Scheduled: Health check every 10 minutes")

def main():
    """Main scheduler loop"""
    logger.info("\n" + "=" * 60)
    logger.info("🚀 MARKET AUTO-START SYSTEM (Python) INITIALIZED")
    logger.info("=" * 60)
    logger.info(f"Project Path: {PROJECT_PATH}")
    logger.info(f"Market Open: {MARKET_OPEN_TIME} AM IST")
    logger.info(f"Pre-Open Period: {MARKET_OPEN_TIME} - {PREOPEN_END_TIME} (Values Frozen)")
    logger.info(f"Live Trading: {LIVE_START_TIME} - {MARKET_CLOSE_TIME} (Live Feed)")
    logger.info(f"Market Days: Monday - Friday (excluding holidays)")
    logger.info(f"Backend Name: {BACKEND_NAME}")
    logger.info(f"Log File: {LOG_FILE}")
    logger.info("=" * 60)
    
    # Setup schedules
    setup_schedules()
    
    # Initial check
    check_and_start_backend()
    
    logger.info("✅ All schedules configured successfully")
    logger.info("💚 System is monitoring for market open time...\n")
    
    # Main loop
    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("👋 Scheduler shutting down gracefully...")
        sys.exit(0)

if __name__ == "__main__":
    main()
