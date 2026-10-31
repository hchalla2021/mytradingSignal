"""Read-only Kite positions. Never adopts or mutates broker orders."""

import copy
import math
import re
import threading
import time

from services.aqte_live import broker_client
from services.aqte_service import normalize


class BrokerPositions:
    def __init__(self, broker=None):
        self.broker = broker or broker_client
        self.lock = threading.Lock()
        self.cached = None
        self.cached_at = 0

    def snapshot(self):
        with self.lock:
            now = time.time()
            client = self.broker()
            # Credentials are never returned or stored in the display payload.
            identity = (client.api_key, client.access_token)
            if self.cached and now - self.cached_at < 3 and identity == self.identity:
                return copy.deepcopy(self.cached)
            positions = client.positions()["net"]
            orders = client.orders()
            selected = []
            for position in positions:
                name = position["tradingsymbol"]
                match = re.match(r"^(BANKNIFTY|NIFTY|SENSEX)\d", name)
                if position["quantity"] and position["exchange"] in ("NFO", "BFO") and match:
                    selected.append((match[1], position))
            keys = list({f'{p["exchange"]}:{p["tradingsymbol"]}' for _, p in selected})
            quotes = client.quote(keys) if keys else {}
            result = []
            for symbol, position in selected:
                name, exchange, product = (position[k] for k in ("tradingsymbol", "exchange", "product"))
                quantity = int(position["quantity"])
                entry = float(position["average_price"])
                if not math.isfinite(entry) or entry <= 0:
                    raise ValueError(f"Broker entry price unavailable for {name}")
                raw = quotes.get(f"{exchange}:{name}")
                quote_at = ltp = points = percent = gross = None
                if raw:
                    tick = normalize(symbol, "option", {
                        **raw, "exchange_timestamp": raw.get("timestamp"),
                        "volume_traded": raw.get("volume", 0),
                    }, time.time())
                    quote_at = tick.at
                    if all(math.isfinite(v) for v in (tick.price, tick.at)) and (
                        tick.price > 0 and 0 <= time.time() - tick.at <= 5
                    ):
                        ltp = tick.price
                        points = round((ltp - entry) * (1 if quantity > 0 else -1), 2)
                        percent = round(points / entry * 100, 2)
                        gross = round(points * abs(quantity), 2)
                stops = []
                exits = []
                for order in orders:
                    if (order["tradingsymbol"], order["exchange"], order["product"]) != (name, exchange, product):
                        continue
                    if order["transaction_type"] != ("SELL" if quantity > 0 else "BUY"):
                        continue
                    if order["status"] not in ("TRIGGER PENDING", "OPEN"):
                        continue
                    remaining = int(order["quantity"]) - int(order["filled_quantity"])
                    if remaining <= 0:
                        continue
                    detail = dict(order_id=str(order["order_id"]), quantity=remaining,
                                  status=order["status"], price=float(order["price"]))
                    if order["order_type"] in ("SL", "SL-M"):
                        stops.append({**detail, "trigger": float(order["trigger_price"])})
                    else:
                        exits.append(detail)
                result.append(dict(
                    symbol=symbol, trading_symbol=name, exchange=exchange, product=product,
                    quantity=quantity, entry=entry, ltp=ltp, quote_at=quote_at,
                    points=points, return_pct=percent, gross_pnl=gross,
                    stops=stops, exit_orders=exits,
                ))
            payload = dict(generated_at=time.time(), positions=result, read_only=True)
            self.cached, self.cached_at, self.identity = payload, time.time(), identity
            return copy.deepcopy(payload)


broker_positions = BrokerPositions()
