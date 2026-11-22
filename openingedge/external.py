import http.client
import json
import math
import os
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


FRED_KEY = "OPENINGEDGE_FRED_API_KEY"
MARKETAUX_KEY = "OPENINGEDGE_MARKETAUX_API_TOKEN"


def external_key(path, key):
    value = ""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            name, sep, raw = line.partition("=")
            if sep and name.strip() == key:
                value = raw.strip().strip("\"'")
    except OSError:
        if key not in os.environ:
            return "", "Backend environment file is unavailable."
    return os.environ.get(key, value).strip(), None


def fred_key(path):
    return external_key(path, FRED_KEY)


def marketaux_key(path):
    return external_key(path, MARKETAUX_KEY)


def marketaux_retry_after(exc, now):
    retry = now + timedelta(days=1)
    header = exc.headers.get("Retry-After") if exc.headers else None
    if header:
        try:
            if header.isdigit():
                requested = now + timedelta(seconds=int(header))
            else:
                requested = parsedate_to_datetime(header)
                if requested.tzinfo is None:
                    requested = requested.replace(tzinfo=timezone.utc)
            retry = max(retry, requested)
        except (ValueError, TypeError, OverflowError):
            retry = datetime.max.replace(tzinfo=timezone.utc)
    return retry.isoformat()


def fetch_marketaux(key):
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=24)
    params = urlencode({
        "api_token": key, "countries": "in", "filter_entities": "true",
        "must_have_entities": "true", "language": "en", "limit": 3,
        "published_after": start.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    request = Request("https://api.marketaux.com/v1/news/all?" + params,
                      headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read(500_001)
        if len(raw) > 500_000:
            raise ValueError("Response too large")
        payload = json.loads(raw)
        articles = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(articles, list) or len(articles) > 3:
            raise ValueError("Invalid articles")
        scores, timestamps, seen = [], [], set()
        for article in articles:
            if not isinstance(article, dict) or not isinstance(article.get("uuid"), str):
                continue
            if article["uuid"] in seen:
                continue
            seen.add(article["uuid"])
            try:
                published = datetime.fromisoformat(article["published_at"].replace("Z", "+00:00"))
                if published.tzinfo is None or not start <= published <= now:
                    continue
            except (KeyError, AttributeError, TypeError, ValueError):
                continue
            entities = article.get("entities")
            if not isinstance(entities, list):
                continue
            by_name = {}
            for entity in entities:
                if not isinstance(entity, dict) or entity.get("country") != "in":
                    continue
                name, score = entity.get("name"), entity.get("sentiment_score")
                if (isinstance(name, str) and name.strip() and not isinstance(score, bool)
                        and isinstance(score, (int, float)) and math.isfinite(score) and -1 <= score <= 1):
                    by_name.setdefault(name.strip().casefold(), score)
            if by_name:
                scores.append(sum(by_name.values()) / len(by_name))
                timestamps.append(published)
        if not scores:
            raise ValueError("No current scored articles")
        return {
            "status": "LAST", "value": sum(scores) / len(scores), "change_percent": None,
            "source_at": min(timestamps).isoformat(),
            "detail": f"Marketaux India-related entity news tone, {len(scores)} article(s), "
                      f"published {min(timestamps).isoformat()} to {max(timestamps).isoformat()}; "
                      "average of each article's mean entity sentiment (-1 to +1). "
                      "Small sample, not market-wide or index sentiment; not a trading signal.",
        }
    except HTTPError as exc:
        result = {"status": "UNAVAILABLE", "value": None, "change_percent": None,
                  "detail": f"Marketaux returned HTTP {exc.code}."}
        if exc.code == 429:
            result["retry_until"] = marketaux_retry_after(exc, now)
        return result
    except (URLError, TimeoutError, OSError, http.client.HTTPException):
        detail = "Marketaux network request failed; check connectivity and TLS trust."
    except (ValueError, KeyError, TypeError, OverflowError, UnicodeDecodeError):
        detail = "Marketaux returned invalid data or no scored articles in the last 24 hours."
    return {"status": "UNAVAILABLE", "value": None, "change_percent": None, "detail": detail}


def fetch_fred(key):
    params = urlencode({"series_id": "VIXCLS", "api_key": key, "file_type": "json",
                        "sort_order": "desc", "limit": 10})
    request = Request("https://api.stlouisfed.org/fred/series/observations?" + params,
                      headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read(100_001)
        if len(raw) > 100_000:
            raise ValueError("Response too large")
        payload = json.loads(raw)
        observations = payload.get("observations") if isinstance(payload, dict) else None
        if not isinstance(observations, list):
            raise ValueError("Missing observations")
        for row in observations:
            if not isinstance(row, dict) or row.get("value") == ".":
                continue
            observed = date.fromisoformat(row["date"])
            value = float(row["value"])
            if observed > datetime.now(timezone.utc).date() or not math.isfinite(value) or value <= 0:
                raise ValueError("Invalid observation")
            return {
                "status": "LAST", "value": value, "change_percent": None,
                "source_date": observed.isoformat(),
                "detail": f"CBOE VIX daily close {observed}; not live. Source: Chicago Board Options Exchange via FRED, "
                          "https://fred.stlouisfed.org/series/VIXCLS. Copyright 2016 CBOE, reproduced by FRED with permission.",
            }
        raise ValueError("No valid observation")
    except HTTPError as exc:
        detail = f"FRED returned HTTP {exc.code}."
    except (URLError, TimeoutError, OSError, http.client.HTTPException):
        detail = "FRED network request failed; check connectivity and TLS trust."
    except (ValueError, KeyError, TypeError, OverflowError, UnicodeDecodeError):
        detail = "FRED returned invalid or unavailable observations."
    return {"status": "UNAVAILABLE", "value": None, "change_percent": None, "detail": detail}
