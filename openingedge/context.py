import math
import threading
from datetime import date, datetime, time


STALE_SECONDS = 30
BASKET = ("RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS",
          "ITC", "LT", "SBIN", "BHARTIARTL", "AXISBANK")
OPTION_STRIKES = 5
GLOBAL_INDICES = {
    ("NSEIX", "GIFT NIFTY"): "gift",
    ("GLOBAL", "US500"): "us500",
    ("GLOBAL", "US100"): "us100",
    ("GLOBAL", "USCOMPOSITE"): "uscomposite",
    ("GLOBAL", "US30"): "us30",
    ("GLOBAL", "JAPAN225"): "japan225",
    ("GLOBAL", "HANGSENG"): "hangseng",
    ("GLOBAL", "SHANGHAICHINA"): "shanghai",
    ("GLOBAL", "AUS200"): "aus200",
    ("GLOBAL", "UK100"): "uk100",
    ("GLOBAL", "GERMANY40"): "germany40",
    ("GLOBAL", "FRANCE40"): "france40",
    ("GLOBAL", "US10YRYIELD"): "us10yr",
}
CUE_LABELS = {
    "gift": "GIFT NIFTY", "us500": "US 500", "us100": "US 100",
    "uscomposite": "US Composite", "us30": "US 30", "japan225": "Japan 225",
    "hangseng": "Hang Seng", "shanghai": "Shanghai China", "aus200": "Australia 200",
    "uk100": "UK 100", "germany40": "Germany 40", "france40": "France 40",
    "us10yr": "US 10-year yield", "india_vix": "India VIX",
    "nifty_future": "NIFTY future", "bank_future": "BANKNIFTY future",
    "usdinr": "USDINR future, not spot FX", "gold": "MCX gold future, not spot gold",
}


def positive(value):
    return (not isinstance(value, bool) and isinstance(value, (int, float))
            and math.isfinite(value) and value > 0)


def expiry_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def live_expiry(row, now, cutoff=time(15, 30)):
    expiry = expiry_date(row.get("expiry"))
    return expiry is not None and (expiry > now.date() or (
        expiry == now.date() and now.time() < cutoff))


def nearest_future(rows, exchange, name, now, cutoff=time(15, 30)):
    candidates = [row for row in rows if row.get("exchange") == exchange
                  and row.get("name") == name and row.get("instrument_type") == "FUT"
                  and row.get("instrument_token") and live_expiry(row, now, cutoff)]
    return min(candidates, key=lambda row: expiry_date(row["expiry"]), default=None)


def black_scholes_iv(price, spot, strike, years, is_call):
    if not all(positive(v) for v in (price, spot, strike, years)):
        return None
    rate = 0.06
    discount = math.exp(-rate * years)
    intrinsic = max(0, spot - strike * discount) if is_call else max(0, strike * discount - spot)
    maximum = spot if is_call else strike * discount
    if not intrinsic < price < maximum:
        return None

    def option_value(vol):
        root = math.sqrt(years)
        d1 = (math.log(spot / strike) + (rate + vol * vol / 2) * years) / (vol * root)
        d2 = d1 - vol * root
        cdf = lambda x: (1 + math.erf(x / math.sqrt(2))) / 2
        return spot * cdf(d1) - strike * discount * cdf(d2) if is_call else (
            strike * discount * cdf(-d2) - spot * cdf(-d1))

    low, high = 0.0001, 5.0
    if not option_value(low) <= price <= option_value(high):
        return None
    for _ in range(60):
        middle = (low + high) / 2
        if option_value(middle) < price:
            low = middle
        else:
            high = middle
    return (low + high) * 50


class ContextFeed:
    def __init__(self):
        self.lock = threading.RLock()
        self.instruments = {}
        self.options = {}
        self.all_options = {}
        self.selected = {}
        self.quotes = {}
        self.last_quotes = {}
        self.last_selected = {}

    def configure(self, equities, derivatives, currency, now, international=(), commodities=(), bfo=()):
        instruments = {}
        for row in equities:
            symbol = row.get("tradingsymbol")
            token = row.get("instrument_token")
            if row.get("exchange") == "NSE" and symbol in BASKET and row.get("instrument_type") == "EQ" and token:
                instruments[token] = {"key": symbol, "symbol": symbol, "exchange": "NSE"}
            if row.get("exchange") == "NSE" and symbol == "INDIA VIX" and token:
                instruments[token] = {"key": "india_vix", "symbol": symbol, "exchange": "NSE"}
        for row in international:
            identity = (row.get("exchange"), row.get("tradingsymbol"))
            token = row.get("instrument_token")
            if identity in GLOBAL_INDICES and token:
                instruments[token] = {"key": GLOBAL_INDICES[identity], "symbol": identity[1], "exchange": identity[0]}
        for key, rows, exchange, name in (
            ("nifty_future", derivatives, "NFO", "NIFTY"),
            ("bank_future", derivatives, "NFO", "BANKNIFTY"),
            ("usdinr", currency, "CDS", "USDINR"),
            ("gold", commodities, "MCX", "GOLD"),
        ):
            row = nearest_future(rows, exchange, name, now, time(23, 30) if exchange == "MCX" else time(15, 30))
            if row:
                instruments[row["instrument_token"]] = {
                    "key": key, "symbol": row["tradingsymbol"], "exchange": exchange,
                    "expiry": expiry_date(row["expiry"]).isoformat(),
                }
        all_options = [row for row in list(derivatives) + list(bfo)
                       if row.get("exchange") in ("NFO", "BFO")
                       and row.get("name") in ("NIFTY", "BANKNIFTY", "SENSEX")
                       and row.get("instrument_type") in ("CE", "PE")
                       and row.get("instrument_token") and positive(row.get("strike"))
                       and live_expiry(row, now)]
        options = [row for row in derivatives if row.get("exchange") == "NFO"
                   and row.get("name") == "NIFTY" and row.get("instrument_type") in ("CE", "PE")
                   and row.get("instrument_token") and positive(row.get("strike")) and live_expiry(row, now)]
        if options:
            nearest = min(expiry_date(row["expiry"]) for row in options)
            options = [row for row in options if expiry_date(row["expiry"]) == nearest]
        with self.lock:
            self.instruments = instruments
            self.options = {row["instrument_token"]: row for row in options}
            self.all_options = {row["instrument_token"]: row for row in all_options}
            self.selected = {}
            self.quotes = {}
            self.last_quotes = {}
            self.last_selected = {}
        return list(instruments)

    def trade_options(self, symbol, side, spot, now):
        if not positive(spot) or symbol not in ("NIFTY", "BANKNIFTY", "SENSEX") or side not in ("CE", "PE"):
            return ()
        candidates = [row for row in self.all_options.values()
                      if row.get("name") == symbol and row.get("instrument_type") == side
                      and live_expiry(row, now)]
        if not candidates:
            return ()
        nearest = min(expiry_date(row["expiry"]) for row in candidates)
        candidates = [row for row in candidates if expiry_date(row["expiry"]) == nearest]
        return tuple(sorted(candidates, key=lambda row: (abs(row["strike"] - spot), row["strike"]))[:3])

    def select_options(self, spot, now):
        if not positive(spot):
            return set()
        with self.lock:
            pairs = {}
            for token, row in self.options.items():
                if live_expiry(row, now):
                    pairs.setdefault(row["strike"], {})[row["instrument_type"]] = token
            strikes = [strike for strike, sides in pairs.items() if set(sides) == {"CE", "PE"}]
            chosen = sorted(strikes, key=lambda strike: (abs(strike - spot), strike))[:OPTION_STRIKES]
            return {token for strike in chosen for token in pairs[strike].values()}

    def set_selected(self, tokens):
        with self.lock:
            self.selected = {token: self.options[token] for token in tokens if token in self.options}

    def set_last_quotes(self, quotes, selected, now, zone):
        with self.lock:
            accepted = {}
            for token, tick in quotes.items():
                if token not in self.instruments and token not in self.options:
                    continue
                stamp, price = tick.get("timestamp"), tick.get("last_price")
                if not isinstance(stamp, datetime) or not positive(price):
                    continue
                stamp = stamp.replace(tzinfo=zone) if stamp.tzinfo is None else stamp.astimezone(zone)
                if stamp > now or (now - stamp).days > 7:
                    continue
                previous = (tick.get("ohlc") or {}).get("close")
                accepted[token] = {"price": price, "previous": previous if positive(previous) else None,
                                   "at": stamp, "oi": tick.get("oi"), "depth": tick.get("depth")}
            for token, quote in accepted.items():
                if token not in self.last_quotes or quote["at"] >= self.last_quotes[token]["at"]:
                    self.last_quotes[token] = quote
            self.last_selected = {token: self.options[token] for token in selected if token in self.options}

    def last_snapshot(self, now):
        def result(value, change, detail, timestamps):
            stamps = [min(timestamps).isoformat(), max(timestamps).isoformat()]
            return {"status": "LAST", "value": value, "change_percent": change,
                    "detail": detail + " Zerodha last exchange snapshot: " + ", ".join(sorted(set(stamps))) + "."}

        with self.lock:
            cues = {}
            def last(token):
                quote = self.last_quotes.get(token)
                return quote if quote and 0 <= (now - quote["at"]).total_seconds() <= 7 * 86400 else None
            for token, meta in self.instruments.items():
                quote = last(token)
                if not quote or meta["key"] not in CUE_LABELS:
                    continue
                change = (quote["price"] / quote["previous"] - 1) * 100 if quote["previous"] else None
                expiry = f", expiry {meta['expiry']}" if "expiry" in meta else ""
                caveat = " Provider delay is unverified." if meta["exchange"] in ("GLOBAL", "NSEIX") else ""
                cues[meta["key"]] = result(quote["price"], change,
                    f"{CUE_LABELS[meta['key']]} ({meta['exchange']}:{meta['symbol']}){expiry}; last price, not live.{caveat}", [quote["at"]])
            by_key = {data["key"]: token for token, data in self.instruments.items()}
            basket = [last(by_key.get(symbol)) for symbol in BASKET]
            if (all(quote and quote["previous"] for quote in basket)
                    and len({quote["at"].date() for quote in basket}) == 1
                    and (max(quote["at"] for quote in basket) - min(quote["at"] for quote in basket)).total_seconds() <= 300):
                changes = [(quote["price"] / quote["previous"] - 1) * 100 for quote in basket]
                times = [quote["at"] for quote in basket]
                detail = "10 selected stocks, not full market breadth: " + ", ".join(BASKET) + "."
                cues["breadth"] = result(f"{sum(v > 0 for v in changes)} / {sum(v < 0 for v in changes)}",
                                         None, detail, times)
                cues["heavyweights"] = result(sum(changes) / len(changes), None,
                                               detail + " Equal-weight average change (%).", times)
            pairs = {}
            for token, row in self.last_selected.items():
                pairs.setdefault(row["strike"], {})[row["instrument_type"]] = last(token)
            if len(pairs) == OPTION_STRIKES and all(
                set(pair) == {"CE", "PE"} and all(
                    q and isinstance(q["oi"], (int, float)) and not isinstance(q["oi"], bool)
                    and math.isfinite(q["oi"]) and q["oi"] >= 0 for q in pair.values())
                for pair in pairs.values()
            ):
                quotes = [q for pair in pairs.values() for q in pair.values()]
                call_oi = sum(pair["CE"]["oi"] for pair in pairs.values())
                put_oi = sum(pair["PE"]["oi"] for pair in pairs.values())
                if (call_oi > 0 and len({q["at"].date() for q in quotes}) == 1
                        and (max(q["at"] for q in quotes) - min(q["at"] for q in quotes)).total_seconds() <= 300):
                    expiry = expiry_date(next(iter(self.last_selected.values()))["expiry"])
                    cues["pcr"] = result(put_oi / call_oi, None,
                        f"NIFTY expiry {expiry}, five nearest paired strikes; not full-chain PCR.",
                        [q["at"] for q in quotes])
            return cues

    def on_ticks(self, ticks, now, zone):
        with self.lock:
            for tick in ticks:
                token = tick.get("instrument_token")
                if token not in self.instruments and token not in self.selected:
                    continue
                stamp = tick.get("exchange_timestamp") or tick.get("timestamp")
                price = tick.get("last_price")
                if not isinstance(stamp, datetime) or not positive(price):
                    continue
                stamp = stamp.astimezone(zone)
                if not -3 <= (now - stamp).total_seconds() <= STALE_SECONDS:
                    continue
                previous_tick = self.quotes.get(token)
                if previous_tick and stamp < previous_tick["at"]:
                    continue
                previous = (tick.get("ohlc") or {}).get("close")
                self.quotes[token] = {
                    "price": price, "previous": previous if positive(previous) else None,
                    "at": stamp, "oi": tick.get("oi"), "depth": tick.get("depth"),
                }

    def snapshot(self, now, connected, index, preopen, prior):
        def unavailable(reason):
            return {"status": "UNAVAILABLE", "value": None, "change_percent": None, "detail": reason}

        def live(value, change, detail):
            return {"status": "LIVE", "value": value, "change_percent": change, "detail": detail}

        with self.lock:
            def fresh(token):
                quote = self.quotes.get(token)
                return quote if (connected and quote and
                                 -3 <= (now - quote["at"]).total_seconds() <= STALE_SECONDS) else None

            result = {}
            for key, label in CUE_LABELS.items():
                matches = [(token, data) for token, data in self.instruments.items() if data["key"] == key]
                quote = fresh(matches[0][0]) if matches else None
                if quote:
                    meta = matches[0][1]
                    change = (quote["price"] / quote["previous"] - 1) * 100 if quote["previous"] else None
                    expiry = f", expiry {meta['expiry']}" if "expiry" in meta else ""
                    detail = f"Zerodha {label}: {meta['exchange']}:{meta['symbol']}{expiry}; exchange {quote['at'].isoformat()}."
                    if meta["exchange"] in ("GLOBAL", "NSEIX"):
                        result[key] = {"status": "RECENT", "value": quote["price"], "change_percent": change,
                                       "detail": detail + " Recent provider timestamp; market-data delay is unverified."}
                    else:
                        result[key] = live(quote["price"], change, detail)
                else:
                    result[key] = unavailable(f"{label}: no recent exchange tick or instrument.")

            by_key = {data["key"]: token for token, data in self.instruments.items()}
            basket = [fresh(by_key[symbol]) if symbol in by_key else None for symbol in BASKET]
            if all(quote and quote["previous"] for quote in basket):
                changes = [(quote["price"] / quote["previous"] - 1) * 100 for quote in basket]
                advances = sum(change > 0 for change in changes)
                declines = sum(change < 0 for change in changes)
                detail = "Zerodha; 10 selected stocks, not full market breadth: " + ", ".join(BASKET)
                result["breadth"] = live(f"{advances} / {declines}", None, detail)
                result["heavyweights"] = live(sum(changes) / len(changes), None, detail + ". Equal-weight average change (%).")
            else:
                result["breadth"] = unavailable("10-stock proxy basket requires fresh quotes and prior closes for every member.")
                result["heavyweights"] = unavailable("10-stock equal-weight basket requires fresh quotes and prior closes for every member.")

            if preopen and prior and now.date().isoformat() == prior.get("current_day"):
                result["auction_gap"] = {
                    "status": "FROZEN", "value": (preopen / prior["close"] - 1) * 100, "change_percent": None,
                    "detail": "NIFTY last observed pre-open index tick versus prior close; not official auction indicative price.",
                }
            else:
                result["auction_gap"] = unavailable("Complete NIFTY pre-open coverage and a recent previous close are required.")

            pairs = {}
            for token, row in self.selected.items():
                pairs.setdefault(row["strike"], {})[row["instrument_type"]] = (row, fresh(token))
            if len(pairs) == OPTION_STRIKES and all(
                set(pair) == {"CE", "PE"} and all(
                    q and isinstance(q["oi"], (int, float)) and not isinstance(q["oi"], bool)
                    and math.isfinite(q["oi"]) and q["oi"] >= 0 for _, q in pair.values())
                for pair in pairs.values()
            ):
                call_oi = sum(pair["CE"][1]["oi"] for pair in pairs.values())
                put_oi = sum(pair["PE"][1]["oi"] for pair in pairs.values())
                expiry = expiry_date(next(iter(self.selected.values()))["expiry"])
                detail = f"Zerodha NIFTY nearest expiry {expiry}; put OI / call OI over {OPTION_STRIKES} nearest paired strikes, not full-chain PCR."
                result["pcr"] = live(put_oi / call_oi, None, detail) if call_oi > 0 else unavailable("Selected NIFTY call OI is zero.")
            else:
                result["pcr"] = unavailable("Five paired NIFTY strikes need recent CE and PE OI ticks.")

            result["iv"] = unavailable("ATM IV needs fresh NIFTY spot and a valid two-sided ATM option market.")
            if positive(index) and pairs:
                strike = min(pairs, key=lambda value: abs(value - index))
                pair = pairs[strike]
                if set(pair) == {"CE", "PE"}:
                    values = []
                    for side in ("CE", "PE"):
                        row, quote = pair[side]
                        depth = quote["depth"] if quote else None
                        buys = depth.get("buy", []) if isinstance(depth, dict) else []
                        sells = depth.get("sell", []) if isinstance(depth, dict) else []
                        bid = buys[0].get("price") if buys and isinstance(buys[0], dict) else None
                        ask = sells[0].get("price") if sells and isinstance(sells[0], dict) else None
                        expiry = expiry_date(row["expiry"])
                        years = (datetime.combine(expiry, time(15, 30), tzinfo=now.tzinfo) - now).total_seconds() / (365 * 86400)
                        if positive(bid) and positive(ask) and bid <= ask:
                            iv = black_scholes_iv((bid + ask) / 2, index, strike, years, side == "CE")
                            if iv is not None:
                                values.append(iv)
                    if len(values) == 2:
                        result["iv"] = live(sum(values) / 2, None, f"Estimated ATM CE/PE midpoint Black-Scholes IV (%); strike {strike}, expiry {expiry}, 6% annual rate, zero dividends.")
            return result
