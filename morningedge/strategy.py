"""Independent deterministic features only; trading signal generation requires validated model."""
from collections import deque


class IndexFeatures:
    def __init__(self, capacity: int = 20) -> None:
        self.prices: deque[float] = deque(maxlen=capacity)

    def update(self, price: float) -> dict[str, float] | None:
        if price <= 0:
            return None
        self.prices.append(price)
        if len(self.prices) < 2:
            return None
        return {"last_price": price, "change_pct": (price / self.prices[0] - 1) * 100}
