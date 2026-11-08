from typing import Any

from config import Settings


def evaluate_readiness(settings: Settings, risk: dict[str, Any]) -> tuple[str, tuple[str, ...]]:
    reasons = []
    for key, label in (("api_key", "Zerodha API key"),
                       ("access_token", "Zerodha account auth"),
                       ("database_url", "PostgreSQL URL"), ("redis_url", "Redis URL"),
                       ("model_artifact", "Model artifact")):
        if not getattr(settings, key):
            reasons.append(f"{label} is not configured")
    if not settings.model_validated:
        reasons.append("Model has not been independently validated")
    if not settings.allowlisted_host_ip:
        reasons.append("Allowlisted host IP is not configured")
    for key in ("per_trade_loss_cap_inr", "daily_loss_cap_inr", "max_trades_per_day"):
        if not risk.get(key):
            reasons.append(f"{key} must be configured")
    return ("READY" if not reasons else "NOT_READY", tuple(reasons))
