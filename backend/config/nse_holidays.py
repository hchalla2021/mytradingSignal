"""
NSE (National Stock Exchange) Holidays Configuration
Centralized holiday management - no hardcoded dates in code
Format: YYYY-MM-DD: Holiday Name
"""

NSE_HOLIDAYS = {
    # 2025 Holidays
    "2025-01-26": "Republic Day",
    "2025-02-26": "Maha Shivaratri",
    "2025-03-14": "Holi",
    "2025-03-31": "Id-Ul-Fitr",
    "2025-04-10": "Shri Mahavir Jayanti",
    "2025-04-14": "Dr. Ambedkar Jayanti",
    "2025-04-18": "Good Friday",
    "2025-05-01": "Maharashtra Day",
    "2025-06-07": "Bakri Id",
    "2025-08-15": "Independence Day",
    "2025-08-27": "Ganesh Chaturthi",
    "2025-10-02": "Mahatma Gandhi Jayanti",
    "2025-10-21": "Diwali Laxmi Pujan",
    "2025-10-22": "Diwali Balipratipada",
    "2025-11-05": "Gurunanak Jayanti",
    "2025-12-25": "Christmas",
    
    # 2026 Holidays (to be added as they're announced)
    # "2026-01-26": "Republic Day",
}

def is_holiday(date_str: str) -> bool:
    """Check if a given date (YYYY-MM-DD) is a market holiday"""
    return date_str in NSE_HOLIDAYS

def get_holiday_name(date_str: str) -> str:
    """Get the holiday name for a given date"""
    return NSE_HOLIDAYS.get(date_str, "")

def add_holiday(date_str: str, name: str) -> None:
    """Add a new holiday (mainly for testing/dynamic updates)"""
    NSE_HOLIDAYS[date_str] = name

def remove_holiday(date_str: str) -> None:
    """Remove a holiday"""
    if date_str in NSE_HOLIDAYS:
        del NSE_HOLIDAYS[date_str]

def get_all_holidays(year: int = None) -> dict:
    """Get all holidays, optionally filtered by year"""
    if year is None:
        return NSE_HOLIDAYS.copy()
    return {date: name for date, name in NSE_HOLIDAYS.items() if date.startswith(str(year))}
