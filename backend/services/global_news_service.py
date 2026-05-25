"""Global Impact Radar — news fetching & India-impact analysis service."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import html
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
import pytz

tf = None  # TensorFlow disabled - numpy softmax fallback used (faster startup)

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# ---------------------------------------------------------------------------
# Impact signal definitions
# ---------------------------------------------------------------------------
SIGNAL_META: Dict[str, Dict[str, str]] = {
    "STRONG_BULLISH":    {"label": "Strong Bullish",    "color": "#10b981", "icon": "🚀"},
    "BULLISH":           {"label": "Bullish",            "color": "#34d399", "icon": "📈"},
    "NEUTRAL":           {"label": "Neutral",            "color": "#f59e0b", "icon": "➡️"},
    "BEARISH":           {"label": "Bearish",            "color": "#f87171", "icon": "📉"},
    "STRONG_BEARISH":    {"label": "Strong Bearish",     "color": "#ef4444", "icon": "🔴"},
    "HIGH_VOLATILITY":   {"label": "High Volatility",    "color": "#a78bfa", "icon": "⚡"},
    "MARKET_CRASH":      {"label": "Market Crash Alert", "color": "#dc2626", "icon": "💥"},
    "SECTOR_RALLY":      {"label": "Sector Rally",       "color": "#06b6d4", "icon": "🏆"},
    "RISK_OFF":          {"label": "Risk-Off Sentiment", "color": "#fb923c", "icon": "🛡️"},
    "NO_IMPACT":         {"label": "No Major Impact",    "color": "#64748b", "icon": "📰"},
}

# ---------------------------------------------------------------------------
# Keyword → (signal, score_delta, sectors, reason)
# ---------------------------------------------------------------------------
_RULES: List[Dict[str, Any]] = [
    # ── US Fed / Central Banks ──────────────────────────────────────────────
    {"kw": ["fed rate cut", "federal reserve cut", "rate cut", "dovish fed", "pivot rate", "fed pause"],
     "signal": "STRONG_BULLISH", "score": 85,
     "sectors": ["Banking", "IT", "Realty"], "reason": "Lower US rates → FII inflows & INR stability"},

    {"kw": ["fed rate hike", "rate hike", "hawkish fed", "tighten monetary", "50bps hike", "75bps hike"],
     "signal": "BEARISH", "score": 35,
     "sectors": ["Banking", "Realty", "Auto"], "reason": "Rate hike tightens global liquidity, FII outflows"},

    {"kw": ["rbi rate cut", "rbi cuts", "rbi monetary", "repo rate cut"],
     "signal": "STRONG_BULLISH", "score": 88,
     "sectors": ["Banking", "NBFC", "Realty", "Auto"], "reason": "RBI rate cut boosts credit growth & equities"},

    {"kw": ["rbi rate hike", "rbi hikes", "repo rate hike", "rbi hawkish"],
     "signal": "BEARISH", "score": 32,
     "sectors": ["Banking", "Realty"], "reason": "Higher repo rate compresses banking margins"},

    # ── Inflation / CPI ──────────────────────────────────────────────────────
    {"kw": ["cpi inflation", "inflation surges", "inflation spike", "inflation hits", "core inflation"],
     "signal": "BEARISH", "score": 38,
     "sectors": ["FMCG", "Consumer"], "reason": "High inflation signals rate hikes & margin pressure"},

    {"kw": ["inflation eases", "inflation cools", "inflation falls", "disinflation", "inflation below"],
     "signal": "BULLISH", "score": 70,
     "sectors": ["FMCG", "Banking"], "reason": "Cooling inflation supports rate-cut expectations"},

    # ── Crude Oil ──────────────────────────────────────────────────────────
    {"kw": ["crude oil spikes", "crude surges", "oil price spikes", "brent surges", "oil above 100", "opec cuts"],
     "signal": "BEARISH", "score": 28,
     "sectors": ["Aviation", "OMC", "Paint"], "reason": "India imports ~85% of oil — trade deficit widens"},

    {"kw": ["crude falls", "oil price drops", "crude declines", "brent falls", "oil below 70", "opec supply"],
     "signal": "BULLISH", "score": 72,
     "sectors": ["Aviation", "OMC", "FMCG", "Logistics"], "reason": "Lower crude reduces India's import bill"},

    # ── US Markets ──────────────────────────────────────────────────────────
    {"kw": ["us market rally", "s&p rally", "nasdaq surges", "dow jones surges", "us stocks surge", "wall street rally"],
     "signal": "BULLISH", "score": 68,
     "sectors": ["IT", "Pharma"], "reason": "Positive US sentiment lifts global risk appetite"},

    {"kw": ["us market crash", "s&p crash", "nasdaq crash", "dow crash", "us stocks plunge", "wall street sell"],
     "signal": "STRONG_BEARISH", "score": 20,
     "sectors": ["IT", "Metals", "Pharma"], "reason": "Global risk-off, FII selling in emerging markets"},

    {"kw": ["us recession", "recession fears", "recession risk", "economic slowdown us"],
     "signal": "RISK_OFF", "score": 30,
     "sectors": ["IT", "Metals", "Auto"], "reason": "US recession hits IT exports and global demand"},

    # ── FII/DII ──────────────────────────────────────────────────────────────
    {"kw": ["fii buying", "fii inflows", "foreign inflows", "fpi buying", "fii net buyer"],
     "signal": "BULLISH", "score": 72,
     "sectors": ["Large Cap", "Banking", "IT"], "reason": "FII buying adds institutional liquidity"},

    {"kw": ["fii selling", "fii outflows", "foreign outflows", "fpi selling", "fii net seller"],
     "signal": "BEARISH", "score": 35,
     "sectors": ["Large Cap", "Banking", "IT"], "reason": "FII selling puts pressure on indices"},

    # ── Geopolitical / War ───────────────────────────────────────────────────
    {"kw": ["war declared", "military attack", "missile strike", "armed conflict", "troops invade", "bombing"],
     "signal": "MARKET_CRASH", "score": 10,
     "sectors": ["All Markets"], "reason": "Geopolitical shock triggers panic selling globally"},

    {"kw": ["geopolitical tension", "war fears", "conflict escalate", "military tensions", "border tensions"],
     "signal": "STRONG_BEARISH", "score": 22,
     "sectors": ["Defence", "Oil & Gas"], "reason": "Risk-off due to geopolitical uncertainty"},

    {"kw": ["ceasefire", "peace deal", "conflict resolved", "tensions ease", "diplomatic resolution"],
     "signal": "BULLISH", "score": 75,
     "sectors": ["All Markets"], "reason": "Geopolitical de-escalation boosts risk appetite"},

    # ── Currency / INR ───────────────────────────────────────────────────────
    {"kw": ["inr falls", "rupee weakens", "dollar surges", "usd inr high", "rupee hits low"],
     "signal": "BEARISH", "score": 38,
     "sectors": ["IT", "Pharma", "Import"], "reason": "Weak INR raises import costs but aids IT exports"},

    {"kw": ["inr strengthens", "rupee gains", "dollar weakens", "usd falls"],
     "signal": "BULLISH", "score": 65,
     "sectors": ["Aviation", "OMC", "Import"], "reason": "Strong INR lowers import costs & attracts FII"},

    # ── Bond Yields ──────────────────────────────────────────────────────────
    {"kw": ["bond yield spikes", "10yr yield surges", "yield above 5", "treasury yield surge", "yields soar"],
     "signal": "BEARISH", "score": 33,
     "sectors": ["Banking", "Realty", "NBFC"], "reason": "Higher yields compete with equities for capital"},

    {"kw": ["bond yield falls", "yields decline", "yield curve", "bond rally", "treasury rally"],
     "signal": "BULLISH", "score": 68,
     "sectors": ["Banking", "Realty"], "reason": "Falling yields make equities more attractive"},

    # ── China / Emerging Markets ─────────────────────────────────────────────
    {"kw": ["china market crash", "china slowdown", "china recession", "china growth miss", "evergrande"],
     "signal": "BEARISH", "score": 35,
     "sectors": ["Metals", "Chemicals"], "reason": "China slowdown hits global commodity demand"},

    {"kw": ["china stimulus", "china recovery", "china gdp beats", "china growth"],
     "signal": "BULLISH", "score": 65,
     "sectors": ["Metals", "IT"], "reason": "China recovery boosts global commodity prices"},

    # ── Tech / Semiconductor / AI ────────────────────────────────────────────
    {"kw": ["nvidia earnings", "tech earnings beat", "ai boom", "semiconductor rally", "tech rally"],
     "signal": "SECTOR_RALLY", "score": 75,
     "sectors": ["IT", "Tech"], "reason": "Strong tech outlook lifts Indian IT sector"},

    {"kw": ["tech layoffs", "tech earnings miss", "semiconductor shortage", "ai slowdown"],
     "signal": "BEARISH", "score": 38,
     "sectors": ["IT", "Tech"], "reason": "Tech sector weakness impacts Indian IT stocks"},

    # ── Gold / Commodities ───────────────────────────────────────────────────
    {"kw": ["gold surges", "gold rally", "gold all time high", "safe haven demand"],
     "signal": "RISK_OFF", "score": 40,
     "sectors": ["Gold ETF"], "reason": "Gold rally signals risk-off — equities may underperform"},

    {"kw": ["gold falls", "gold drops", "gold declines", "risk on"],
     "signal": "BULLISH", "score": 65,
     "sectors": ["Equities"], "reason": "Falling gold signals risk-on shift to equities"},

    # ── GDP / Economic Data ──────────────────────────────────────────────────
    {"kw": ["gdp beats", "gdp growth", "strong economic", "jobs data strong", "nfp beats", "payroll surges"],
     "signal": "BULLISH", "score": 70,
     "sectors": ["Broad Market"], "reason": "Strong macro data boosts global growth outlook"},

    {"kw": ["gdp misses", "gdp contraction", "economic weakness", "jobs miss", "nfp miss", "unemployment rises"],
     "signal": "BEARISH", "score": 35,
     "sectors": ["Broad Market"], "reason": "Weak economic data raises recession concerns"},

    # ── India-specific ───────────────────────────────────────────────────────
    {"kw": ["budget india", "union budget", "fiscal stimulus india", "india capex"],
     "signal": "STRONG_BULLISH", "score": 85,
     "sectors": ["Infra", "PSU", "Defence"], "reason": "Government spending boosts India capex sectors"},

    {"kw": ["india gst", "gst collections", "india tax revenue"],
     "signal": "BULLISH", "score": 65,
     "sectors": ["Broad Market"], "reason": "Strong GST signals healthy consumption"},

    {"kw": ["monsoon deficit", "drought india", "rainfall below normal"],
     "signal": "BEARISH", "score": 38,
     "sectors": ["FMCG", "Agri", "Rural"], "reason": "Poor monsoon dampens rural demand & agri output"},

    {"kw": ["monsoon good", "normal monsoon", "above normal rainfall"],
     "signal": "BULLISH", "score": 68,
     "sectors": ["FMCG", "Agri", "Rural"], "reason": "Good monsoon boosts rural economy & consumption"},

    # ── High Volatility catch-all ────────────────────────────────────────────
    {"kw": ["vix spikes", "fear index", "market volatility", "circuit breaker", "trading halt"],
     "signal": "HIGH_VOLATILITY", "score": 45,
     "sectors": ["Options", "F&O"], "reason": "High volatility — options premium elevated"},
]

# ---------------------------------------------------------------------------
# RSS feed sources
# ---------------------------------------------------------------------------
_RSS_FEEDS: List[Dict[str, str]] = [
    {"name": "Moneycontrol Markets", "url": "https://www.moneycontrol.com/rss/MCtopnews.xml"},
    {"name": "Moneycontrol Business", "url": "https://www.moneycontrol.com/rss/business.xml"},
    {"name": "Reuters Business",    "url": "https://feeds.reuters.com/reuters/businessNews"},
    {"name": "Reuters World",       "url": "https://feeds.reuters.com/Reuters/worldNews"},
    {"name": "Economic Times Mkts", "url": "https://economictimes.indiatimes.com/markets/rss.cms"},
    {"name": "LiveMint Markets",    "url": "https://www.livemint.com/rss/markets"},
    {"name": "CNBC Top News",       "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html"},
    {"name": "CNBC World News",     "url": "https://www.cnbc.com/id/100727362/device/rss/rss.html"},
    {"name": "Yahoo Finance",       "url": "https://finance.yahoo.com/news/rssindex"},
    {"name": "MarketWatch Top",     "url": "https://feeds.content.dowjones.io/public/rss/mw_topstories"},
    {"name": "TradingEconomics",    "url": "https://api.tradingeconomics.com/rss?f=all"},
    {"name": "SEBI Press",          "url": "https://www.sebi.gov.in/sebirss.xml"},
    {"name": "RBI Press",           "url": "https://www.rbi.org.in/Scripts/RSSFeeds.aspx?Id=1"},
    {"name": "PIB India",           "url": "https://pib.gov.in/newsite/rss.aspx"},
    {"name": "FT Markets",          "url": "https://www.ft.com/rss/home/uk"},
    {"name": "Business Standard",   "url": "https://www.business-standard.com/rss/markets-106.rss"},
    # Zerodha Pulse — HTML aggregator covering NDTV Profit, ET Markets, The
    # Hindu Business, Moneycontrol, Finshots and more. High signal density for
    # Indian markets. Uses the `pulse` parser branch in _fetch_feed.
    {"name": "Zerodha Pulse",       "url": "https://pulse.zerodha.com/", "parser": "pulse"},
]

_FETCH_TIMEOUT = 8.0
_CACHE_TTL_SECS = 120          # 2 minutes — push cadence for WS clients
_MAX_ITEMS_PER_FEED = 8
_MAX_PULSE_ITEMS = 40          # Pulse aggregates many publishers — allow more
_MAX_TOTAL_ITEMS = 64

_SOURCE_PRIORITY: Dict[str, int] = {
    "Moneycontrol Markets": 12,
    "Moneycontrol Business": 11,
    "Economic Times Mkts": 11,
    "CNBC Top News": 10,
    "CNBC World News": 9,
    "Reuters Business": 10,
    "Reuters World": 9,
    "LiveMint Markets": 9,
    "SEBI Press": 11,
    "RBI Press": 11,
    "PIB India": 8,
    "Yahoo Finance": 7,
    "MarketWatch Top": 7,
    "TradingEconomics": 8,
    "Business Standard": 8,
    "FT Markets": 7,
    # Pulse items keep their publisher name ("Pulse · NDTV Business"); see
    # _pulse_source_priority for prefix-based lookup in _refresh().
    "Zerodha Pulse": 13,
}

# Pulse items carry source names like "Pulse · NDTV Business"; treat all Pulse
# items as top-priority regardless of the publisher suffix.
_PULSE_SOURCE_PREFIX = "Pulse · "
_PULSE_PRIORITY = 13

_ML_TOKENS = [
    "rate", "cut", "hike", "inflation", "recession", "rally", "crash", "war", "fii", "selling",
    "buying", "volatility", "vix", "stimulus", "gdp", "jobs", "oil", "yield", "rbi", "fed",
]
_ML_WEIGHTS = [
    2.0, 6.0, -7.0, -5.0, -6.0, 5.0, -10.0, -9.0, 4.0, -4.5,
    4.5, -6.0, -6.5, 4.0, 3.0, 2.0, -3.0, -3.5, 4.0, -1.0,
]


def _impact_tier(signal: str, score: int) -> str:
    extremity = abs(score - 50)
    if signal in ("HIGH_VOLATILITY", "MARKET_CRASH", "RISK_OFF"):
        return "volatility"
    if signal == "NO_IMPACT" or extremity < 8:
        return "low"
    if extremity >= 20:
        return "high"
    return "medium"


def _tensorflow_refine_score(title: str, description: str, base_score: int) -> int:
    """Optional TensorFlow refinement for impact score.

    Uses a tiny keyword vector + tensor dot-product as a low-latency ML pass.
    If TensorFlow is unavailable, returns the rule-engine score unchanged.
    """
    if tf is None:
        return base_score

    text = (title + " " + description).lower()
    features = [float(text.count(token)) for token in _ML_TOKENS]
    try:
        feature_tensor = tf.constant(features, dtype=tf.float32)
        weight_tensor = tf.constant(_ML_WEIGHTS, dtype=tf.float32)
        raw = tf.tensordot(feature_tensor, weight_tensor, axes=1)
        adjusted = float(tf.clip_by_value(base_score + raw, 0.0, 100.0).numpy())
        return int(round(adjusted))
    except Exception:
        return base_score


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _classify(title: str, description: str) -> Dict[str, Any]:
    """Return signal, score, sectors, reason by matching keywords."""
    text = (title + " " + description).lower()

    best_score = 50
    best_signal = "NO_IMPACT"
    best_sectors: List[str] = []
    best_reason = "No significant India-specific market impact detected"

    for rule in _RULES:
        for kw in rule["kw"]:
            if kw in text:
                if rule["score"] > best_score or rule["score"] < (100 - best_score):
                    # Prefer more extreme (bullish or bearish) signals
                    if abs(rule["score"] - 50) > abs(best_score - 50):
                        best_score = rule["score"]
                        best_signal = rule["signal"]
                        best_sectors = rule.get("sectors", [])
                        best_reason = rule.get("reason", "")
                break  # first matching kw in this rule is enough

    confidence = min(95, max(30, int(abs(best_score - 50) * 1.8 + 30)))
    return {
        "signal": best_signal,
        "score": best_score,
        "confidence": confidence,
        "sectors": best_sectors,
        "reason": best_reason,
    }


def _parse_rss(xml_text: str, source_name: str) -> List[Dict[str, Any]]:
    """Parse RSS XML and return list of items."""
    items: List[Dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items

    # Handle both RSS 2.0 and Atom
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    channel = root.find("channel")
    if channel is not None:
        raw_items = channel.findall("item")
    else:
        raw_items = root.findall("atom:entry", ns) or root.findall("entry")

    for item in raw_items[:_MAX_ITEMS_PER_FEED]:
        title_el = item.find("title")
        link_el = item.find("link")
        desc_el = item.find("description") or item.find("summary")
        pub_el = item.find("pubDate") or item.find("published") or item.find("updated")

        title = (title_el.text or "").strip() if title_el is not None else ""
        link = (link_el.text or "").strip() if link_el is not None else ""
        desc = (desc_el.text or "").strip() if desc_el is not None else ""
        pub = (pub_el.text or "").strip() if pub_el is not None else ""

        # Atom <link href="...">
        if not link and link_el is not None:
            link = link_el.get("href", "")

        if not title:
            continue

        # Strip HTML tags and decode entities for clean display
        desc_clean = html.unescape(re.sub(r'<[^>]+>', '', desc)).strip()

        uid = hashlib.md5(title.encode()).hexdigest()[:12]
        analysis = _classify(title, desc)
        analysis["score"] = _tensorflow_refine_score(title, desc_clean, analysis["score"])
        analysis["confidence"] = min(98, max(30, int(abs(analysis["score"] - 50) * 1.8 + 30)))
        tier = _impact_tier(analysis["signal"], analysis["score"])
        items.append({
            "id": uid,
            "title": title,
            "description": desc_clean[:200] if desc_clean else "",
            "link": link,
            "published": pub,
            "source": source_name,
            "impact_tier": tier,
            **analysis,
        })
    return items


async def _fetch_feed(client: httpx.AsyncClient, feed: Dict[str, str]) -> List[Dict[str, Any]]:
    try:
        resp = await client.get(
            feed["url"],
            timeout=_FETCH_TIMEOUT,
            headers={"User-Agent": "Mozilla/5.0 (compatible; TradingBot/1.0)"},
            follow_redirects=True,
        )
        if resp.status_code == 200:
            parser = feed.get("parser", "rss")
            if parser == "pulse":
                return _parse_pulse_html(resp.text)
            return _parse_rss(resp.text, feed["name"])
    except Exception as exc:
        logger.debug("Feed fetch failed [%s]: %s", feed["name"], exc)
    return []


# ---------------------------------------------------------------------------
# Zerodha Pulse HTML scraper (https://pulse.zerodha.com/)
# ---------------------------------------------------------------------------
# Pulse aggregates Indian market news from many publishers (NDTV Profit,
# Economic Times, The Hindu Business, Moneycontrol, Finshots, ...). Each item
# carries the original publisher name, so we preserve it as `source` and let the
# normal classification/impact-tier pipeline filter the high/medium/volatility
# items for the Global Impact Radar UI.
_PULSE_ITEM_RE = re.compile(
    r'<li[^>]*class="[^"]*\bbox\b[^"]*\bitem\b[^"]*"[^>]*>(.*?)</li>',
    re.S | re.I,
)
_PULSE_TITLE_RE = re.compile(
    r'<h2[^>]*class="[^"]*title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
    re.S | re.I,
)
_PULSE_DESC_RE = re.compile(
    r'<div[^>]*class="[^"]*desc[^"]*"[^>]*>(.*?)</div>',
    re.S | re.I,
)
_PULSE_DATE_RE = re.compile(
    r'<span[^>]*class="[^"]*date[^"]*"[^>]*(?:title="([^"]*)")?[^>]*>(.*?)</span>',
    re.S | re.I,
)
_PULSE_FEED_RE = re.compile(
    r'<span[^>]*class="[^"]*feed[^"]*"[^>]*>(.*?)</span>',
    re.S | re.I,
)


def _clean_html(snippet: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", snippet or "")).strip()


def _parse_pulse_html(html_text: str) -> List[Dict[str, Any]]:
    """Parse Pulse by Zerodha homepage HTML into normalized news items."""
    items: List[Dict[str, Any]] = []
    for raw in _PULSE_ITEM_RE.findall(html_text):
        title_m = _PULSE_TITLE_RE.search(raw)
        if not title_m:
            continue
        link = html.unescape(title_m.group(1)).strip()
        title = _clean_html(title_m.group(2))
        if not title:
            continue

        desc_m = _PULSE_DESC_RE.search(raw)
        desc_clean = _clean_html(desc_m.group(1)) if desc_m else ""

        date_m = _PULSE_DATE_RE.search(raw)
        published = ""
        if date_m:
            published = (date_m.group(1) or _clean_html(date_m.group(2)) or "").strip()

        feed_m = _PULSE_FEED_RE.search(raw)
        publisher = _clean_html(feed_m.group(1)) if feed_m else ""
        # "— NDTV Business" → "NDTV Business"
        publisher = re.sub(r"^[\u2014\u2013\-\s]+", "", publisher).strip() or "Pulse"
        source_name = f"Pulse · {publisher}"

        uid = hashlib.md5(f"pulse::{title}".encode()).hexdigest()[:12]
        analysis = _classify(title, desc_clean)
        analysis["score"] = _tensorflow_refine_score(title, desc_clean, analysis["score"])
        analysis["confidence"] = min(98, max(30, int(abs(analysis["score"] - 50) * 1.8 + 30)))
        tier = _impact_tier(analysis["signal"], analysis["score"])

        items.append({
            "id": uid,
            "title": title,
            "description": desc_clean[:200],
            "link": link,
            "published": published,
            "source": source_name,
            "impact_tier": tier,
            **analysis,
        })
        if len(items) >= _MAX_PULSE_ITEMS:
            break
    return items


# ---------------------------------------------------------------------------
# Service singleton
# ---------------------------------------------------------------------------

class GlobalNewsService:
    def __init__(self):
        self._cache: Optional[List[Dict[str, Any]]] = None
        self._last_fetch: float = 0.0
        self._lock = asyncio.Lock()
        self._heat_score: int = 50
        self._task: Optional[asyncio.Task] = None
        self._ws_clients: set = set()  # active WebSocket connections
        self._feed_failures: Dict[str, int] = {}
        self._feed_retry_until: Dict[str, float] = {}

    def _feed_is_cooled_down(self, feed_name: str) -> bool:
        retry_until = self._feed_retry_until.get(feed_name)
        if retry_until is None:
            return False
        if time.monotonic() >= retry_until:
            self._feed_retry_until.pop(feed_name, None)
            self._feed_failures.pop(feed_name, None)
            return False
        return True

    def _register_feed_result(self, feed_name: str, ok: bool, error_text: str = "") -> None:
        if ok:
            self._feed_failures.pop(feed_name, None)
            self._feed_retry_until.pop(feed_name, None)
            return

        failure_count = self._feed_failures.get(feed_name, 0) + 1
        self._feed_failures[feed_name] = failure_count

        normalized = error_text.lower()
        is_dns_failure = "getaddrinfo failed" in normalized or "name or service not known" in normalized
        if failure_count >= 2 or is_dns_failure:
            cooldown_seconds = 300 if is_dns_failure else min(900, 60 * failure_count)
            self._feed_retry_until[feed_name] = time.monotonic() + cooldown_seconds
            logger.info(
                "Pausing feed [%s] for %ds after %d consecutive failure(s)",
                feed_name,
                cooldown_seconds,
                failure_count,
            )

    async def start(self):
        self._task = asyncio.create_task(self._loop())
        asyncio.create_task(self._refresh())
        logger.info("GlobalNewsService started")

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def broadcast(self) -> None:
        """Push the current snapshot to every connected WebSocket client."""
        if not self._ws_clients:
            return
        snap = self.get_snapshot()
        dead: set = set()
        for ws in list(self._ws_clients):
            try:
                await ws.send_json(snap)
            except Exception:
                dead.add(ws)
        self._ws_clients -= dead

    async def _loop(self):
        while True:
            await asyncio.sleep(_CACHE_TTL_SECS)
            try:
                await self._refresh()
            except Exception as exc:
                logger.warning("GlobalNewsService refresh error: %s", exc)

    async def _refresh(self):
        async with self._lock:
            all_items: List[Dict[str, Any]] = []
            eligible_feeds = [feed for feed in _RSS_FEEDS if not self._feed_is_cooled_down(feed["name"])]
            if not eligible_feeds:
                logger.debug("GlobalNews refresh skipped: all feeds are in cooldown")
                return

            async with httpx.AsyncClient() as client:
                tasks = [_fetch_feed(client, f) for f in eligible_feeds]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for feed, result in zip(eligible_feeds, results):
                    if isinstance(result, list):
                        all_items.extend(result)
                        self._register_feed_result(feed["name"], ok=True)
                    else:
                        self._register_feed_result(feed["name"], ok=False, error_text=str(result))

            # Deduplicate by id, limit total
            seen: set[str] = set()
            unique: List[Dict[str, Any]] = []
            for item in all_items:
                if item["id"] not in seen:
                    seen.add(item["id"])
                    unique.append(item)

            # Sort by impact extremity first, then source priority, then confidence.
            def _src_priority(src: str) -> int:
                if src.startswith(_PULSE_SOURCE_PREFIX):
                    return _PULSE_PRIORITY
                return _SOURCE_PRIORITY.get(src, 0)

            unique.sort(
                key=lambda x: (
                    abs(x["score"] - 50),
                    _src_priority(x.get("source", "")),
                    x.get("confidence", 0),
                ),
                reverse=True,
            )
            self._cache = unique[:_MAX_TOTAL_ITEMS]
            self._last_fetch = asyncio.get_running_loop().time()

            # Compute heat score (avg extremity across top items)
            if self._cache:
                total = sum(abs(i["score"] - 50) for i in self._cache)
                self._heat_score = min(100, int(50 + total / max(len(self._cache), 1)))
            else:
                self._heat_score = 50

            n = len(self._cache or [])
            if n == 0:
                logger.warning(
                    "GlobalNews refresh completed but ALL %d feeds returned 0 items. "
                    "RSS feeds may be unreachable or blocked.", len(_RSS_FEEDS)
                )
            else:
                logger.info("GlobalNews refreshed: %d items, heat=%d", n, self._heat_score)
        # Broadcast outside the lock so get_snapshot() is not blocked
        if self._ws_clients:
            asyncio.create_task(self.broadcast())

    def get_snapshot(self) -> Dict[str, Any]:
        items = self._cache or []
        high_impact_count = sum(1 for i in items if i.get("impact_tier") == "high")
        medium_impact_count = sum(1 for i in items if i.get("impact_tier") == "medium")
        volatility_count = sum(1 for i in items if i.get("impact_tier") == "volatility")
        bullish_count  = sum(1 for i in items if i["signal"] in ("STRONG_BULLISH", "BULLISH", "SECTOR_RALLY"))
        bearish_count  = sum(1 for i in items if i["signal"] in ("STRONG_BEARISH", "BEARISH", "MARKET_CRASH", "RISK_OFF"))
        neutral_count  = len(items) - bullish_count - bearish_count

        overall = "NEUTRAL"
        if bullish_count > bearish_count + 1:
            overall = "BULLISH" if bullish_count < bearish_count * 2 else "STRONG_BULLISH"
        elif bearish_count > bullish_count + 1:
            overall = "BEARISH" if bearish_count < bullish_count * 2 else "STRONG_BEARISH"

        return {
            "items": items,
            "heat_score": self._heat_score,
            "overall_signal": overall,
            "bullish_count": bullish_count,
            "bearish_count": bearish_count,
            "neutral_count": neutral_count,
            "high_impact_count": high_impact_count,
            "medium_impact_count": medium_impact_count,
            "volatility_count": volatility_count,
            "total": len(items),
            "last_updated": datetime.now(IST).isoformat(),
            "signal_meta": SIGNAL_META,
        }


_instance: Optional[GlobalNewsService] = None


def get_global_news_service() -> GlobalNewsService:
    global _instance
    if _instance is None:
        _instance = GlobalNewsService()
    return _instance
