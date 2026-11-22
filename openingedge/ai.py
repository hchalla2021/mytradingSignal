import json
import http.client
import logging
import math
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger("openingedge.ai")
API_URL = "https://api.anthropic.com/v1/messages"
ENV_KEYS = {
    "QUANTUMEDGE_AI_ENABLED", "QUANTUMEDGE_AI_MODEL", "QUANTUMEDGE_AI_ANTHROPIC_API_KEY",
    "AUTONOMIQ_PRO_ANTHROPIC_API_KEY", "QUANTUMEDGE_AI_MAX_OUTPUT_TOKENS", "QUANTUMEDGE_AI_TIMEOUT_SECONDS",
}


def load_config(path):
    values = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip() in ENV_KEYS:
                values[name.strip()] = value.strip().strip("\"'")
    except OSError:
        return None, "Backend environment file is unavailable."
    for key in ENV_KEYS:
        if key in os.environ:
            values[key] = os.environ[key]
    enabled = values.get("QUANTUMEDGE_AI_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
    key = (values.get("QUANTUMEDGE_AI_ANTHROPIC_API_KEY") or values.get("AUTONOMIQ_PRO_ANTHROPIC_API_KEY") or "").strip()
    model = values.get("QUANTUMEDGE_AI_MODEL", "claude-haiku-5-5").strip()
    if not enabled:
        return None, "Haiku is disabled in the backend environment."
    if not key:
        return None, "Anthropic API key is missing."
    if not model.startswith("claude-haiku-"):
        return None, "Configured AI model is not a Claude Haiku model."
    try:
        tokens = int(values.get("QUANTUMEDGE_AI_MAX_OUTPUT_TOKENS", "256"))
        timeout = float(values.get("QUANTUMEDGE_AI_TIMEOUT_SECONDS", "12"))
    except ValueError:
        return None, "Haiku token or timeout setting is invalid."
    if not 128 <= tokens <= 1000 or not math.isfinite(timeout) or not 1 <= timeout <= 30:
        return None, "Haiku token or timeout setting is outside supported bounds."
    return {"key": key, "model": model, "tokens": tokens, "timeout": timeout}, None


def review(config, evidence):
    expected = evidence["direction"]
    body = {
        "model": config["model"],
        "max_tokens": config["tokens"],
        "system": (
            "Assess the supplied pre-open index evidence only. This is not an order and no post-open "
            "breakout has been confirmed. Approve only the supplied direction or reject it. "
            "Do not invent missing data. Return only JSON with exactly action, confidence, reason. "
            "action must be BUY_CE, BUY_PE, or REJECT; confidence is a number from 0 to 100; "
            "reason is a short explanation."
        ),
        "messages": [{"role": "user", "content": json.dumps(evidence, separators=(",", ":"), allow_nan=False)}],
    }
    if config["model"] == "claude-haiku-5-5":
        body["thinking"] = {"type": "disabled"}
        body["output_config"] = {"effort": "low", "format": {
            "type": "json_schema",
            "schema": {"type": "object", "properties": {
                "action": {"type": "string", "enum": ["BUY_CE", "BUY_PE", "REJECT"]},
                "confidence": {"type": "number"},
                "reason": {"type": "string"},
            }, "required": ["action", "confidence", "reason"], "additionalProperties": False},
        }}
    request = Request(API_URL, data=json.dumps(body).encode("utf-8"), method="POST", headers={
        "Content-Type": "application/json",
        "anthropic-version": "2026-10-21" if config["model"] == "claude-haiku-5-5" else "2023-06-01",
        "x-api-key": config["key"],
    })
    try:
        with urlopen(request, timeout=config["timeout"]) as response:
            raw = response.read(100_001)
        if len(raw) > 100_000:
            raise ValueError("Response too large")
        payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get("stop_reason") != "end_turn":
            raise ValueError("Incomplete response")
        blocks = payload.get("content")
        if not isinstance(blocks, list):
            raise ValueError("Invalid response")
        text = "".join(block.get("text", "") for block in blocks
                       if isinstance(block, dict) and block.get("type") == "text"
                       and isinstance(block.get("text"), str)).strip()
        if text.startswith("```") and text.endswith("```"):
            text = text.partition("\n")[2][:-3].strip()
        result = json.loads(text)
        if not isinstance(result, dict) or set(result) != {"action", "confidence", "reason"}:
            raise ValueError("Invalid decision")
        confidence, action, reason = result["confidence"], result["action"], result["reason"]
        if (action not in (expected, "REJECT") or isinstance(confidence, bool)
                or not isinstance(confidence, (int, float)) or not math.isfinite(confidence)
                or not 0 <= confidence <= 100 or not isinstance(reason, str) or not reason.strip()):
            raise ValueError("Invalid decision fields")
        return {"state": "APPROVED" if action == expected else "REJECTED", "action": action,
                "confidence": confidence, "reason": reason.strip()[:180]}
    except HTTPError as exc:
        logger.warning("Haiku request failed with HTTP %s", exc.code)
        return {"state": "UNAVAILABLE", "action": None, "confidence": None, "reason": f"Haiku returned HTTP {exc.code}."}
    except (URLError, TimeoutError, OSError, http.client.HTTPException):
        logger.warning("Haiku request failed due to a network error")
        return {"state": "UNAVAILABLE", "action": None, "confidence": None, "reason": "Haiku network request failed."}
    except (ValueError, TypeError, OverflowError, UnicodeDecodeError):
        logger.warning("Haiku returned an invalid response")
        return {"state": "UNAVAILABLE", "action": None, "confidence": None, "reason": "Haiku returned an invalid response."}
