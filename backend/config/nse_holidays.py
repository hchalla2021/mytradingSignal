"""
NSE (National Stock Exchange) Holidays Configuration
Centralized holiday management - no hardcoded dates in code
Format: YYYY-MM-DD: Holiday Name
"""

from datetime import date, timedelta

# Holiday list disabled — exchange-driven (Zerodha tick activity) is the source of truth.
# Keep this empty in live mode to avoid stale calendar blocking live feeds.
NSE_HOLIDAYS: dict[str, str] = {}

# Reference holiday entries (kept commented for documentation only):
# Note: 2026-06-23 is NOT a configured holiday in this reference list.
# 2025: 01-26 Republic Day, 02-26 Maha Shivaratri, 03-14 Holi, 03-31 Id-Ul-Fitr,
#       04-10 Mahavir Jayanti, 04-14 Ambedkar Jayanti, 04-18 Good Friday,
#       05-01 Maharashtra Day, 06-07 Bakri Id, 08-15 Independence Day,
#       08-27 Ganesh Chaturthi, 10-02 Gandhi Jayanti, 10-21 Diwali Laxmi Pujan,
#       10-22 Diwali Balipratipada, 11-05 Gurunanak Jayanti, 12-25 Christmas.
# 2026: 01-15 Municipal Election, 01-26 Republic Day, 03-03 Holi,
#       03-26 Ram Navami, 03-31 Mahavir Jayanti, 04-03 Good Friday,
#       04-14 Ambedkar Jayanti, 05-01 Maharashtra Day, 05-28 Bakri Id,
#       06-26 Muharram, 09-14 Ganesh Chaturthi, 10-02 Gandhi Jayanti,
#       10-20 Dussehra, 11-10 Diwali-Balipratipada, 11-24 Gurunanak Jayanti, 12-25 Christmas.


def is_holiday(date_str: str) -> bool:
    """Check if a given date (YYYY-MM-DD) is a market holiday."""
    return date_str in NSE_HOLIDAYS


def is_trading_day(d: date) -> bool:
    """Check if a given date is a trading day (not weekend, not holiday)."""
    if d.weekday() >= 5:  # Saturday=5, Sunday=6
        return False
    return d.strftime("%Y-%m-%d") not in NSE_HOLIDAYS


def get_holiday_name(date_str: str) -> str:
    """Get the holiday name for a given date."""
    return NSE_HOLIDAYS.get(date_str, "")


def shift_to_prev_trading_day(d: date) -> date:
    """If d is a holiday or weekend, shift backward to the previous trading day."""
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def add_holiday(date_str: str, name: str) -> None:
    """Add a new holiday (mainly for testing/dynamic updates)."""
    NSE_HOLIDAYS[date_str] = name


def remove_holiday(date_str: str) -> None:
    """Remove a holiday."""
    if date_str in NSE_HOLIDAYS:
        del NSE_HOLIDAYS[date_str]


def get_all_holidays(year: int = None) -> dict:
    """Get all holidays, optionally filtered by year."""
    if year is None:
        return NSE_HOLIDAYS.copy()
    return {date_k: name for date_k, name in NSE_HOLIDAYS.items() if date_k.startswith(str(year))}
