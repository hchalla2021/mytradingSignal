import os
import threading
from datetime import datetime, time, timedelta
from pathlib import Path
from time import monotonic, sleep
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from pydantic import BaseModel

try:
    from kiteconnect import KiteConnect, KiteTicker
except ImportError:
    KiteConnect = KiteTicker = None

TZ = ZoneInfo("Asia/Kolkata")
CREDENTIALS_FILE = Path(os.getenv(
    "MORNINGEDGE_BACKEND_ENV_FILE",
    Path(__file__).resolve().parents[1] / "backend" / ".env",
))
MAX_SPREAD_PCT = float(os.getenv("MORNINGEDGE_MAX_SPREAD_PCT", "1.0"))
FRESH_SECONDS = 10
# Exchange stamps come from another machine's clock; a few seconds of lead is skew, not a future-dated tick.
CLOCK_SKEW_SECONDS = 3
MAX_CANDIDATE_RISK = 3000
INDICES = {"NIFTY": ("NSE", "NIFTY 50"), "BANKNIFTY": ("NSE", "NIFTY BANK"),
           "SENSEX": ("BSE", "SENSEX")}
app = FastAPI(title="MorningEdge", version="1.0.0")


def load_kite_credentials(path=None):
    credentials = {}
    try:
        credentials_path = Path(path) if path is not None else CREDENTIALS_FILE
        for line in credentials_path.read_text(encoding="utf-8").splitlines():
            name, separator, value = line.partition("=")
            if separator and name.strip() in {"ZERODHA_API_KEY", "ZERODHA_ACCESS_TOKEN"}:
                credentials[name.strip()] = value.strip().strip("\"'")
    except OSError:
        return "", ""
    return credentials.get("ZERODHA_API_KEY", ""), credentials.get("ZERODHA_ACCESS_TOKEN", "")


class MorningMarketEngine:
    def __init__(self, clock=None):
        self.clock = clock or (lambda: datetime.now(TZ))
        self.lock = threading.RLock()
        self.ticks = {}
        self.previous_closes = {}
        self.preopen = {name: [] for name in INDICES}
        self.opening = {name: [] for name in INDICES}
        self.instruments = {}
        self.error = None
        self.reason = "Waiting for real Kite market data."
        self.signal = {"decision": "wait", "reason": self.reason, "symbol": None,
                       "contract": None, "entry": None, "stop": None, "trailing_stop": None}
        self.subscribe = None
        self._day = None

    def _reset_for_day(self):
        day = self.clock().date().isoformat()
        if self._day != day:
            self.preopen = {name: [] for name in INDICES}
            self.opening = {name: [] for name in INDICES}
            self.ticks = {}
            self.previous_closes = {}
            self.signal = {"decision": "wait", "reason": "Collecting today's market data.",
                           "symbol": None, "contract": None, "entry": None,
                           "stop": None, "trailing_stop": None}
            self._day = day

    def ingest_instruments(self, rows):
        self.instruments = {}
        for row in rows:
            exchange, symbol = row.get("exchange"), row.get("tradingsymbol")
            token = row.get("instrument_token")
            if exchange and symbol and token:
                self.instruments[(exchange, symbol)] = row

    @staticmethod
    def _stamp(value):
        if isinstance(value, datetime):
            # KiteTicker builds naive timestamps with fromtimestamp(), i.e. in this process's timezone, not IST.
            return value.astimezone(TZ)
        return datetime.now(TZ)

    def on_ticks(self, ticks):
        with self.lock:
            self._reset_for_day()
            now = self.clock()
            for tick in ticks:
                token = tick.get("instrument_token")
                raw_ts = tick.get("exchange_timestamp") or tick.get("timestamp")
                if token is None or raw_ts is None or tick.get("last_price") is None:
                    continue
                ts = self._stamp(raw_ts)
                if (now - ts).total_seconds() > FRESH_SECONDS or ts > now + timedelta(seconds=CLOCK_SKEW_SECONDS):
                    continue
                self.ticks[token] = {"price": tick.get("last_price"), "timestamp": ts,
                                     "depth": tick.get("depth") or {}}
                if tick.get("ohlc", {}).get("close"):
                    self.previous_closes[token] = float(tick["ohlc"]["close"])
                if ts.date() != now.date():
                    continue
                for name, (exchange, symbol) in INDICES.items():
                    ins = self.instruments.get((exchange, symbol))
                    if not ins or ins["instrument_token"] != token:
                        continue
                    if time(9, 0) <= ts.time() < time(9, 8):
                        self.preopen[name].append((ts, float(tick["last_price"])))
                    if time(9, 15) <= ts.time() < time(9, 20):
                        self.opening[name].append((ts, float(tick["last_price"])))
            self._evaluate()

    def _valid_tick(self, token):
        tick = self.ticks.get(token)
        return tick if tick and (self.clock() - tick["timestamp"]).total_seconds() <= FRESH_SECONDS else None

    def _option_quote(self, instrument):
        tick = self._valid_tick(instrument["instrument_token"])
        if not tick:
            return None, "Option quote missing or stale."
        depth = tick.get("depth", {})
        bids, asks = depth.get("buy", []), depth.get("sell", [])
        if not bids or not asks or not tick["price"] or float(tick["price"]) <= 0:
            return None, "Option bid/ask unavailable."
        bid, ask = float(bids[0].get("price", 0)), float(asks[0].get("price", 0))
        if bid <= 0 or ask < bid or (ask - bid) / ask * 100 > MAX_SPREAD_PCT:
            return None, "Option spread exceeds limit or quote is invalid."
        return {"bid": bid, "ask": ask, "ltp": float(tick["price"])}, None

    def _select_contract(self, index):
        venue = "BFO" if index == "SENSEX" else "NFO"
        candidates = [i for i in self.instruments.values()
                      if i.get("name") == index and i.get("instrument_type") == "CE"
                      and i.get("exchange") == venue
                      and i.get("expiry") and i["expiry"] >= self.clock().date()]
        if not candidates:
            return None, "No listed CE contracts found."
        expiry = min(i["expiry"] for i in candidates)
        candidates = [i for i in candidates if i["expiry"] == expiry]
        spot = float(self.ticks[self.instruments[INDICES[index]]["instrument_token"]]["price"])
        contract = min(candidates, key=lambda i: abs(float(i["strike"]) - spot))
        if self.subscribe:
            self.subscribe(contract["instrument_token"])
        quote, reason = self._option_quote(contract)
        return (contract, None) if quote else (None, reason)

    def _evaluate(self):
        now = self.clock()
        if not (time(9, 20) <= now.time() < time(15, 0)):
            self.reason = "Waiting for the completed opening range or outside the signal window."
            self.signal = {"decision": "wait", "reason": self.reason, "symbol": None,
                           "contract": None, "entry": None, "stop": None, "trailing_stop": None}
            return
        for required in ("NIFTY", "BANKNIFTY", "SENSEX"):
            pre = self.preopen[required]
            opening = self.opening[required]
            if not pre or pre[0][0].time() > time(9, 1) or pre[-1][0].time() < time(9, 7):
                self.reason = f"Actual {required} pre-open coverage is incomplete."
                self.signal = {"decision": "wait", "reason": self.reason, "symbol": None,
                               "contract": None, "entry": None, "stop": None, "trailing_stop": None}
                return
            if not opening or opening[0][0].time() > time(9, 16) or opening[-1][0].time() < time(9, 19):
                self.reason = f"Actual {required} opening-range coverage is incomplete."
                self.signal = {"decision": "wait", "reason": self.reason, "symbol": None,
                               "contract": None, "entry": None, "stop": None, "trailing_stop": None}
                return
        for name in ("NIFTY", "BANKNIFTY", "SENSEX"):
            ins = self.instruments.get(INDICES[name])
            pre = self.preopen[name]
            opening = self.opening[name]
            pre_complete = (pre and pre[0][0].time() <= time(9, 1)
                            and pre[-1][0].time() >= time(9, 7))
            range_complete = (opening and opening[0][0].time() <= time(9, 16)
                              and opening[-1][0].time() >= time(9, 19))
            if not ins or not pre_complete or not range_complete:
                continue
            tick = self._valid_tick(ins["instrument_token"])
            if not tick or now.time() < time(9, 20):
                continue
            high = max(p for _, p in self.opening[name])
            spot = float(tick["price"])
            if spot <= high:
                continue
            contract, reason = self._select_contract(name)
            if reason:
                self.reason = reason
                self.signal["reason"] = reason
                continue
            quote, reason = self._option_quote(contract)
            if reason:
                self.reason = reason
                self.signal["reason"] = reason
                continue
            lot = int(contract.get("lot_size") or 0)
            if lot <= 0 or (quote["ask"] * lot * .20) > MAX_CANDIDATE_RISK:
                self.reason = "One-lot setup exceeds the planned per-trade risk limit."
                self.signal["reason"] = self.reason
                continue
            self.reason = f"{name} opening-range breakout qualified; no order was placed."
            self.signal = {
                "decision": "candidate CE",
                "reason": self.reason,
                "symbol": name,
                "contract": contract["tradingsymbol"],
                "entry": quote["ask"],
                "stop": quote["ask"] * .8,
                "trailing_stop": None,
            }
            return
        self.reason = "Waiting for a fresh index breakout and valid ATM CE quote."
        self.signal = {"decision": "wait", "reason": self.reason, "symbol": None,
                       "contract": None, "entry": None, "stop": None, "trailing_stop": None}

    def status(self, feed_enabled, feed_state):
        with self.lock:
            now = self.clock()
            indices, open_range = {}, {}
            for name, (exchange, symbol) in INDICES.items():
                ins = self.instruments.get((exchange, symbol))
                tick = self._valid_tick(ins["instrument_token"]) if ins else None
                price = tick["price"] if tick else None
                history = self.preopen[name]
                prior = self.previous_closes.get(ins["instrument_token"]) if ins else None
                samples = self.opening[name] or history
                indices[name] = {"price": price, "change": price - prior if price is not None and prior else None,
                                 "change_percent": ((price / prior - 1) * 100) if price is not None and prior else None,
                                 "status": "LIVE" if tick else "unavailable",
                                 "timestamp": tick["timestamp"].isoformat() if tick else None,
                                 "history": [sample for _, sample in samples[-30:]]}
                vals = [p for _, p in self.opening[name]]
                range_complete = (history and vals and self.opening[name][0][0].time() <= time(9, 16)
                                  and self.opening[name][-1][0].time() >= time(9, 19))
                complete = now.time() >= time(9, 20) and bool(range_complete)
                open_range[name] = {"high": max(vals) if vals else None,
                                    "low": min(vals) if vals else None, "complete": complete}
            entry_window = time(9, 0) <= now.time() < time(9, 8)
            complete = all(
                self.preopen[n]
                and self.preopen[n][0][0].time() <= time(9, 1)
                and self.preopen[n][-1][0].time() >= time(9, 7)
                for n in INDICES
            ) and now.time() >= time(9, 8)
            reasons = []
            if not all(load_kite_credentials()):
                reasons.append("Kite API key or access token is missing from the backend environment file.")
            if self.error:
                reasons.append(self.error)
            if not complete:
                reasons.append("Actual pre-open ticks are incomplete.")
            return {"feed_enabled": feed_enabled, "feed_status": feed_state,
                    "trade_enabled": False, "can_enable_trading": False,
                    "block_reasons": reasons, "armed": False, "entry_window": entry_window,
                    "reason": self.reason, "error": self.error,
                    "stage": self._stage(now), "session_stage": self._stage(now),
                    "indices": indices, "preopen": {"started_at": "09:00", "ended_at": "09:08",
                    "complete": complete, "ticks": sum(len(self.preopen[n]) for n in INDICES),
                    "ticks_by_symbol": {n: len(self.preopen[n]) for n in INDICES}},
                    "opening_range": open_range, "signal": self.signal}

    @staticmethod
    def _stage(now):
        t = now.time()
        if t < time(9, 0):
            return "pre_session"
        if t < time(9, 8):
            return "pre_open"
        if t < time(9, 15):
            return "opening"
        if t < time(9, 20):
            return "opening_range"
        if t < time(15, 30):
            return "live"
        return "closed"


ENGINE = MorningMarketEngine()
KITE_SOCKET = None
FEED_ENABLED = True
FEED_STATE = "connecting"
FEED_LOCK = threading.RLock()
FEED_GENERATION = 0
# Credentials the current feed generation connected with; None until start_feed has read them.
FEED_CREDENTIALS = None
FEED_DOWN_SINCE = None
FEED_SUPERVISOR_SECONDS = 15
FEED_RETRY_MIN_SECONDS = 60
FEED_RETRY_MAX_SECONDS = 900
FEED_RETRY_SECONDS = FEED_RETRY_MIN_SECONDS


def _feed_error_message(reason):
    detail = str(reason)
    if "403" in detail or "Forbidden" in detail:
        return (
            "Kite rejected the market-data WebSocket (403 Forbidden). "
            "MorningEdge reads ZERODHA_ACCESS_TOKEN from the shared backend/.env file and "
            "reconnects automatically when that token changes. Log in to Zerodha to save "
            "today's token there, or turn the feed OFF and ON to retry immediately."
        )
    return f"Kite feed error: {detail}"


def _fail_feed(generation, message):
    global FEED_STATE
    with FEED_LOCK:
        if generation is None or generation == FEED_GENERATION:
            ENGINE.error = message
            FEED_STATE = "error"


def start_feed(generation=None):
    global KITE_SOCKET, FEED_STATE, FEED_CREDENTIALS
    with FEED_LOCK:
        if not FEED_ENABLED or (generation is not None and generation != FEED_GENERATION):
            return
        FEED_STATE = "connecting"
    api_key, access_token = load_kite_credentials()
    with FEED_LOCK:
        if generation is not None and generation != FEED_GENERATION:
            return
        FEED_CREDENTIALS = (api_key, access_token)
    if not api_key or not access_token or KiteConnect is None or KiteTicker is None:
        _fail_feed(generation, "Kite API key or access token missing from the backend environment file, or kiteconnect unavailable.")
        return
    try:
        kite = KiteConnect(api_key=api_key)
        kite.set_access_token(access_token)
        catalog = []
        for exchange in ("NSE", "BSE", "NFO", "BFO"):
            catalog.extend(kite.instruments(exchange))
        ENGINE.ingest_instruments(catalog)
        tokens = [ENGINE.instruments[k]["instrument_token"] for k in INDICES.values()
                  if k in ENGINE.instruments]
        if not tokens:
            _fail_feed(generation, "No index instrument tokens resolved from Kite catalog.")
            return
        with FEED_LOCK:
            if not FEED_ENABLED or (generation is not None and generation != FEED_GENERATION):
                return
            socket = KiteTicker(api_key, access_token)
            KITE_SOCKET = socket
        def subscribe_option(token):
            socket.subscribe([token])
            socket.set_mode(KiteTicker.MODE_FULL, [token])
        ENGINE.subscribe = subscribe_option
        socket.on_ticks = lambda ws, ticks: ENGINE.on_ticks(ticks)
        def on_connect(ws, response):
            global FEED_STATE
            if generation is not None and generation != FEED_GENERATION:
                ws.close()
                return
            ws.subscribe(tokens)
            ws.set_mode(KiteTicker.MODE_FULL, tokens)
            FEED_STATE = "connected"
        socket.on_connect = on_connect
        def on_close(ws, code, reason):
            global FEED_STATE
            if generation is None or generation == FEED_GENERATION:
                FEED_STATE = "off" if not FEED_ENABLED else "disconnected"
                if FEED_ENABLED:
                    ENGINE.error = _feed_error_message(reason)
        def on_error(ws, code, reason):
            global FEED_STATE
            if generation is None or generation == FEED_GENERATION:
                FEED_STATE = "error"
                ENGINE.error = _feed_error_message(reason)
        socket.on_close = on_close
        socket.on_error = on_error
        socket.connect(threaded=True)
    except Exception as exc:
        _fail_feed(generation, f"Kite feed initialization failed: {type(exc).__name__}")


def supervise_feed(now=None):
    """Reconnect once today's token lands in backend/.env, or when a failed feed stays down.

    Restarting the process instead would discard the in-memory pre-open ticks for the day.
    """
    global KITE_SOCKET, FEED_STATE, FEED_GENERATION, FEED_CREDENTIALS, FEED_DOWN_SINCE, FEED_RETRY_SECONDS
    now = monotonic() if now is None else now
    credentials = load_kite_credentials()
    with FEED_LOCK:
        if not FEED_ENABLED:
            FEED_DOWN_SINCE = None
            return False
        if FEED_STATE == "connected":
            FEED_DOWN_SINCE = None
            FEED_RETRY_SECONDS = FEED_RETRY_MIN_SECONDS
        elif FEED_DOWN_SINCE is None:
            FEED_DOWN_SINCE = now
        token_changed = (all(credentials) and FEED_CREDENTIALS is not None
                         and credentials != FEED_CREDENTIALS)
        stalled = FEED_DOWN_SINCE is not None and now - FEED_DOWN_SINCE >= FEED_RETRY_SECONDS
        if not token_changed and not stalled:
            return False
        # Back off retries with unchanged credentials so an expired token is not hammered all night.
        FEED_RETRY_SECONDS = (FEED_RETRY_MIN_SECONDS if token_changed
                              else min(FEED_RETRY_SECONDS * 2, FEED_RETRY_MAX_SECONDS))
        FEED_GENERATION += 1
        generation = FEED_GENERATION
        socket, KITE_SOCKET = KITE_SOCKET, None
        FEED_STATE = "connecting"
        FEED_CREDENTIALS = None
        FEED_DOWN_SINCE = now
        ENGINE.error = None
        ENGINE.subscribe = None
    if socket:
        socket.close()
    threading.Thread(target=start_feed, daemon=True, name="morningedge-kite",
                     args=(generation,)).start()
    return True


def _supervise_forever():
    while True:
        sleep(FEED_SUPERVISOR_SECONDS)
        try:
            supervise_feed()
        except Exception as exc:
            ENGINE.error = f"Feed supervisor error: {type(exc).__name__}"


@app.on_event("startup")
def startup():
    threading.Thread(target=start_feed, daemon=True, name="morningedge-kite",
                     args=(FEED_GENERATION,)).start()
    threading.Thread(target=_supervise_forever, daemon=True, name="morningedge-supervisor").start()


@app.get("/health")
def health():
    return {"ok": True, "service": "morningedge", "feed": FEED_STATE}


@app.get("/api/status")
def status():
    return ENGINE.status(FEED_ENABLED, FEED_STATE)


class FeedControl(BaseModel):
    enabled: bool

    class Config:
        extra = "forbid"


@app.post("/api/feed/control")
def feed_control(request: FeedControl):
    global FEED_ENABLED, FEED_STATE, FEED_GENERATION, KITE_SOCKET
    global FEED_CREDENTIALS, FEED_DOWN_SINCE, FEED_RETRY_SECONDS
    with FEED_LOCK:
        if request.enabled == FEED_ENABLED:
            return {"feed_enabled": FEED_ENABLED, "feed_status": FEED_STATE, "trade_enabled": False}
        FEED_GENERATION += 1
        generation = FEED_GENERATION
        FEED_ENABLED = request.enabled
        socket = KITE_SOCKET
        KITE_SOCKET = None
        FEED_STATE = "connecting" if request.enabled else "off"
        FEED_CREDENTIALS = None
        FEED_DOWN_SINCE = None
        FEED_RETRY_SECONDS = FEED_RETRY_MIN_SECONDS
        ENGINE.error = None
        if not request.enabled:
            with ENGINE.lock:
                ENGINE.ticks.clear()
                ENGINE.subscribe = None
                ENGINE.reason = "Waiting for live market data."
                ENGINE.signal = {"decision": "wait", "reason": ENGINE.reason, "symbol": None,
                                 "contract": None, "entry": None, "stop": None, "trailing_stop": None}
        else:
            threading.Thread(target=start_feed, daemon=True, name="morningedge-kite",
                             args=(generation,)).start()
    if not request.enabled and socket:
        socket.close()
    return {"feed_enabled": FEED_ENABLED, "feed_status": FEED_STATE, "trade_enabled": False}
