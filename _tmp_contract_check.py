import json
import sys
from pathlib import Path

sys.path.insert(0, r"C:\Tradings\mytradingSignal\backend")
base = Path(r"C:\Tradings\mytradingSignal\backend\data\instrument_catalog")
for p in sorted(base.glob("*.json")):
    d = json.loads(p.read_text(encoding="utf-8"))
    print(p.name, "day=", d.get("day"), "rows=", len(d.get("rows", [])))

rows = []
for ex in ("NFO", "BFO"):
    p = base / f"{ex}.json"
    if p.exists():
        rows += json.loads(p.read_text(encoding="utf-8"))["rows"]

from services.contract_manager import ContractManager  # noqa: E402

class FakeKite:
    pass

import services.contract_manager as cm  # noqa: E402

class StubCatalog:
    def get(self, kite, exchange, now=None):
        return [r for r in rows if r.get("exchange") == exchange]

cm.instrument_catalog = StubCatalog()
manager = ContractManager(FakeKite())
for symbol in ("NIFTY", "BANKNIFTY", "SENSEX"):
    futs = []
    for r in rows:
        ts = str(r.get("tradingsymbol", "")).upper()
        if r.get("instrument_type") == "FUT" and ts.startswith(symbol):
            futs.append((ts, r.get("instrument_token"), r.get("expiry"), r.get("exchange")))
    futs.sort(key=lambda x: str(x[2]))
    print(f"\n{symbol}: candidates (sorted by real expiry):")
    for f in futs[:6]:
        print("   ", f)
    all_contracts = manager.get_all_contracts(symbol)
    print("  ContractManager near ->", all_contracts.get("near"))
    print("  ContractManager next ->", all_contracts.get("next"))
