"""Permanent AQTE execution read model and owner-requested monthly Excel exports."""

import calendar
import copy
import hashlib
import io
import json
import math
import re
import sqlite3
import time
from contextlib import closing
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Font, PatternFill

from services.aqte_engine import IST

MONTH_PATTERN = r"^[1-9][0-9]{3}-(0[1-9]|1[0-2])$"
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
LEGACY_REASON = "Detailed entry evidence was not recorded for this older execution."
STATUS_NAMES = {
    "ENTRY_UNKNOWN": "Submission unverified", "ENTRY_PENDING": "Pending fill",
    "OPEN": "Pending fill", "PARTIALLY_FILLED": "Partially filled",
    "PROTECTION_UNKNOWN": "Filled - protection unverified",
    "PROTECTION_PENDING": "Filled - protection pending",
    "PROTECTED": "Open - protected", "EXIT_PENDING": "Exit pending",
    "CLOSED": "Exited", "EXIT_UNVERIFIED": "Exit unverified",
    "CANCELLED": "Cancelled - no fill", "REJECTED": "Rejected - no fill",
    "UNVERIFIED": "Broker outcome unverified",
}


def strategy_name(strategy):
    if not strategy:
        return "Strategy not recorded"
    scalp = re.fullmatch(r"quick_scalp_(\d+(?:\.\d+)?)", strategy)
    return f"Quick Scalp ({scalp[1]}-point target)" if scalp else strategy.replace("_", " ").title()


def capture_context(signal, strategy, entry):
    scalp = str(strategy).startswith("quick_scalp")
    reasons = list(signal.get("reasons") or [])
    if scalp:
        reasons = [reason for reason in reasons if not reason.startswith("Quick scalp:")]
        reasons.insert(0, f'Quick scalp: target +{entry["points"]:g} premium points; '
                          f'cost-adjusted reward/risk {entry["reward_risk"]:.2f}')
    return dict(strategy_name=strategy_name(strategy),
                entry_engine="AQTE Independent Morning Engine" if signal.get("source") == "morning"
                else "AQTE Scalp Rules" if scalp else "AQTE Swing Rules",
                reason="; ".join(reasons) or "Detailed entry evidence unavailable",
                supporting_engines=[engine["name"] for engine in signal.get("engines", [])
                                    if engine.get("status") == "SATISFIED"
                                    and engine.get("side") == signal["decision"][-2:]
                                    and engine.get("authority") != "SHADOW"],
                confidence=signal.get("confidence"), captured_at=time.time(),
                **({"morning_evidence": copy.deepcopy(signal.get("evidence")),
                    "morning_rules": copy.deepcopy(signal.get("rules"))}
                   if signal.get("source") == "morning" else {}))


def numeric(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None


def execution_record(raw, observed_at):
    contract = raw.get("contract") or {}
    context = raw.get("execution_context") or {}
    entry_at, exit_at = numeric(raw.get("entry_at")), numeric(raw.get("exit_at"))
    at = entry_at or exit_at or observed_at
    identity = raw.get("id") or "legacy-" + hashlib.sha256(
        json.dumps(raw, sort_keys=True, allow_nan=False).encode()).hexdigest()[:20]
    filled = max(raw.get("filled") or 0, raw.get("broker_filled_quantity") or 0)
    price = numeric(raw.get("entry_price"))
    price = price if price and price > 0 else None
    exit_price = numeric(raw.get("exit_price"))
    pnl = numeric(raw.get("net_pnl")) if exit_at and not raw.get("exit_unverified") else None
    status = raw.get("state") or "UNVERIFIED"
    if exit_at:
        status = "EXIT_UNVERIFIED" if raw.get("exit_unverified") else "CLOSED"
    elif raw.get("broker_status") in ("CANCELLED", "REJECTED") and not filled:
        status = raw["broker_status"]
    elif raw.get("broker_status") == "PARTIALLY_FILLED":
        status = "PARTIALLY_FILLED"
    elif filled and status in ("ENTRY_UNKNOWN", "ENTRY_PENDING", "OPEN"):
        status = "PROTECTION_UNKNOWN"
    return dict(
        id=identity, at=at, updated_at=observed_at, entry_at=entry_at, exit_at=exit_at,
        time_basis="Entry" if entry_at else "Exit (entry time not recorded)" if exit_at else "Journal",
        symbol=raw.get("symbol") or "Not recorded",
        trading_symbol=contract.get("trading_symbol") or "Not recorded", exchange=contract.get("exchange"),
        side="BUY", quantity=raw.get("quantity") or filled, filled=filled,
        entry_price=price, exit_price=exit_price, net_pnl=pnl,
        return_pct=round((exit_price - price) / price * 100, 4)
        if exit_at and price and exit_price and not raw.get("exit_unverified") else None,
        status=status, status_name=STATUS_NAMES.get(status, status.replace("_", " ").title()),
        status_reason=raw.get("status_message") or raw.get("error"),
        strategy=raw.get("strategy"), strategy_name=context.get("strategy_name") or strategy_name(raw.get("strategy")),
        entry_engine=context.get("entry_engine") or "Not recorded",
        reason=context.get("reason") or LEGACY_REASON,
        supporting_engines=list(context.get("supporting_engines") or []),
        confidence=context.get("confidence"), evidence_at=context.get("captured_at"),
        entry_id=str(raw["entry_id"]) if raw.get("entry_id") is not None else None,
        protect_id=str(raw["protect_id"]) if raw.get("protect_id") is not None else None,
        initial_stop=numeric(raw.get("initial_stop")), stop=numeric(raw.get("stop")), target=numeric(raw.get("target")),
        exit_reason=raw.get("exit_reason") or raw.get("exit_requested"),
    )


def save_execution(db, raw, observed_at, *, replace=True):
    record = execution_record(raw, observed_at)
    conflict = ("DO UPDATE SET at=excluded.at,payload=excluded.payload" if replace else "DO NOTHING")
    db.execute(f"INSERT INTO live_executions(id,at,payload) VALUES(?,?,?) ON CONFLICT(id) {conflict}",
               (record["id"], record["at"], json.dumps(record, allow_nan=False)))


def bootstrap_executions(db, state, *, force=False):
    """Recover old intents (including unfilled orders), then prefer actual saved fills."""
    version = state.get("execution_history_version", 0)
    if type(version) is not int or version not in (0, 1):
        raise ValueError("Unsupported execution history version")
    if version == 1 and not force:
        return
    pending = None
    last_at = time.time()
    for at, kind, payload in db.execute(
        "SELECT at,kind,payload FROM live_audit WHERE kind IN "
        "('ENTRY_INTENT','ENTRY_ACK','ENTRY_UNCERTAIN','ENTRY_UNFILLED','ENTRY_FINISHED','LIVE_CLOSED','EMERGENCY_FLAT') "
        "ORDER BY id"
    ):
        data = json.loads(payload)
        last_at = at
        if kind == "ENTRY_INTENT":
            if pending:
                save_execution(db, pending, at, replace=False)
            proposal, tag = data["proposal"], data["tag"]
            if not re.fullmatch(r"[0-9a-f]{16}E", tag):
                raise ValueError("Invalid execution intent tag in AQTE journal")
            pending = dict(id=tag[:-1], symbol=proposal["symbol"], contract=proposal["contract"],
                           strategy=proposal.get("strategy"), execution_context=proposal.get("execution_context"),
                           quantity=proposal["entry"]["quantity"], entry_at=at, state="ENTRY_UNKNOWN", filled=0)
        elif kind == "ENTRY_ACK" and pending:
            pending.update(entry_id=str(data["order_id"]), state="ENTRY_PENDING")
        elif kind == "ENTRY_UNCERTAIN" and pending:
            pending.update(state="ENTRY_UNKNOWN")
        elif kind == "ENTRY_UNFILLED" and pending:
            pending.update(broker_status=data["status"], status_message=data.get("reason"))
        elif kind == "ENTRY_FINISHED" and pending:
            save_execution(db, pending, at, replace=False)
            pending = None
        elif kind == "LIVE_CLOSED":
            save_execution(db, data["trade"], at, replace=False)
            pending = None
        elif kind == "EMERGENCY_FLAT":
            if data.get("execution"):
                save_execution(db, data["execution"], at, replace=False)
            elif pending:
                pending["state"] = "UNVERIFIED"
                save_execution(db, pending, at, replace=False)
            pending = None
    if pending:
        save_execution(db, pending, last_at, replace=False)
    for trade in state["trades"]:
        save_execution(db, trade, trade.get("exit_at") or last_at)
    if state.get("active"):
        save_execution(db, state["active"], time.time())
    state["execution_history_version"] = 1


def month_filter(month):
    if month is None:
        return "", ()
    if not re.fullmatch(MONTH_PATTERN, month):
        raise ValueError("Month must be YYYY-MM")
    year, number = map(int, month.split("-"))
    start = datetime(year, number, 1, tzinfo=IST).timestamp()
    return "WHERE at>=? AND at<?", (start, start + calendar.monthrange(year, number)[1] * 86400)

def day_filter(ist_day):
    if ist_day is None:
        return "", ()
    try:
        parsed = datetime.strptime(ist_day, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("Day must be a valid YYYY-MM-DD date") from exc
    if parsed.strftime("%Y-%m-%d") != ist_day:
        raise ValueError("Day must be a valid YYYY-MM-DD date")
    start = datetime(parsed.year, parsed.month, parsed.day, tzinfo=IST).timestamp()
    return "WHERE at>=? AND at<?", (start, start + 86400)


def read_connection(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=10)


def read_executions(path, month=None, limit=4, offset=0, ist_day=None):
    if month is not None and ist_day is not None:
        raise ValueError("Choose either a month or a day filter")
    clause, values = month_filter(month) if month is not None else day_filter(ist_day)
    with closing(read_connection(path)) as db:
        db.execute("BEGIN")
        total = db.execute(f"SELECT COUNT(*) FROM live_executions {clause}", values).fetchone()[0]
        rows = [json.loads(row[0]) for row in db.execute(
            f"SELECT payload FROM live_executions {clause} ORDER BY at DESC,id DESC LIMIT ? OFFSET ?",
            (*values, limit, offset))]
    return dict(rows=rows, total=total, offset=offset, limit=limit, month=month, generated_at=time.time())


def export_executions(path, month):
    clause, values = month_filter(month)
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet("Executions")
    headers = [
        "Time (IST)", "Instrument", "Side", "Requested Qty", "Filled Qty", "Net P&L (INR, estimated)",
        "P&L % (gross)", "Status", "Strategy / Entry Reason", "Entry Engine", "Supporting Engines (advisory)",
        "Entry Reason", "Rule Score (not probability)", "Entry Price", "Exit Price", "Exit Time (IST)",
        "Broker Entry Order ID", "Broker SL / Exit Order ID", "AQTE Execution ID",
        "Initial SL", "Last SL / TSL", "Target", "Exit Reason", "Broker / Status Detail", "Time Basis",
    ]
    sheet.freeze_panes = "A2"
    for column, width in {"A": 22, "B": 30, "H": 28, "I": 36, "J": 24, "K": 44, "L": 85,
                          "P": 22, "Q": 24, "R": 26, "S": 25, "W": 24, "X": 48, "Y": 32}.items():
        sheet.column_dimensions[column].width = width

    def cells(values, header=False):
        for value in values:
            if isinstance(value, str):
                value = re.sub(r"[\x00-\x08\x0b-\x0c\x0e-\x1f]", " ", value)
            cell = WriteOnlyCell(sheet, value=value)
            if isinstance(value, str):
                cell.data_type = "s"  # Broker strings and order IDs must never become Excel formulas/numbers.
            if header:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = PatternFill("solid", fgColor="16324F")
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            yield cell

    def stamp(value):
        return datetime.fromtimestamp(value, IST).strftime("%Y-%m-%d %H:%M:%S") if value is not None else None

    sheet.append(list(cells(headers, header=True)))
    count = 0
    with closing(read_connection(path)) as db:
        for payload, in db.execute(f"SELECT payload FROM live_executions {clause} ORDER BY at,id", values):
            row = json.loads(payload)
            sheet.append(list(cells([
                stamp(row["at"]), row["trading_symbol"], row["side"], row["quantity"], row["filled"],
                row["net_pnl"], row["return_pct"], row["status_name"], row["strategy_name"], row["entry_engine"],
                ", ".join(row["supporting_engines"]), row["reason"], row["confidence"], row["entry_price"],
                row["exit_price"], stamp(row["exit_at"]), row["entry_id"], row["protect_id"], row["id"],
                row["initial_stop"], row["stop"], row["target"], row["exit_reason"], row["status_reason"], row["time_basis"],
            ])))
            count += 1
    sheet.auto_filter.ref = f"A1:Y{count + 1}"
    notes = workbook.create_sheet("Report Notes")
    for line in [
        ("Report", "AQTE execution history"), ("Month (IST, by entry time)", month), ("Executions", count),
        ("Generated (IST)", stamp(time.time())),
        ("Retention", "Continuous history. Downloading or changing months never deletes journal records."),
        ("Status", "Last saved broker-reconciled status; submission acknowledgement is not a fill."),
        ("P&L", "Closed-trade net P&L uses estimated charges, not contract notes. Open/unverified P&L is blank."),
        ("Evidence", "Entry reasons are captured before submission. Older missing evidence is explicitly marked."),
        ("Engines", "Scalp/swing rules originate entries. Supporting engines are advisory, not separate executors."),
    ]:
        notes.append(line)
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()
