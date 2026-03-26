"""
Risk Scanner API
----------------
Run: cd backend && uvicorn api:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import MetaTrader5 as mt5
from data_fetcher import score_symbol, FALLBACK_BALANCE_NGN
from typing import Optional
from pydantic import BaseModel

app = FastAPI(title="Pair Risk Scanner")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WATCHLIST = {
    "crypto": [
        "BTCUSDm", "ETHUSDm", "SOLUSDm", "XRPUSDm",
        "BNBUSDm", "ADAUSDm", "DOGEUSDm", "LTCUSDm",
        "MATICUSDm", "LINKUSDm",
    ],
    "forex": [
        "EURUSDm", "GBPUSDm", "USDJPYm", "USDCHFm",
        "AUDUSDm", "NZDUSDm", "USDCADm",
        "EURGBPm", "EURJPYm", "GBPJPYm",
    ],
    "metals": [
        "XAUUSDm", "XAGUSDm",
    ],
    "indices": [
        "US500m", "US30m",
    ],
}

CLASS_ADX_GATES = {
    "crypto":  {"amber": 30.0, "red": 50.0},
    "forex":   {"amber": 20.0, "red": 35.0},
    "metals":  {"amber": 25.0, "red": 40.0},
    "indices": {"amber": 25.0, "red": 40.0},
}

CLASS_LABELS = {
    "crypto": "Crypto",
    "forex": "Forex",
    "metals": "Metals",
    "indices": "Indices",
}


class ScanRequest(BaseModel):
    balance:        Optional[float] = None
    daily_loss_pct: Optional[float] = 0.02
    risk_pct:       Optional[float] = 0.01


def enrich(result: dict, asset_class: str, class_rank: int) -> dict:
    result["asset_class"] = asset_class
    result["class_label"] = CLASS_LABELS[asset_class]
    result["class_rank"]  = class_rank
    return result


@app.post("/scan")
def scan(req: ScanRequest = None):
    if req is None:
        req = ScanRequest()

    if not mt5.initialize():
        return {"error": f"MT5 connection failed: {mt5.last_error()}"}

    account        = mt5.account_info()
    bal            = req.balance or (account.balance if account and account.balance > 0 else FALLBACK_BALANCE_NGN)
    daily_loss_pct = req.daily_loss_pct or 0.02
    risk_pct       = req.risk_pct or 0.01

    all_results = []

    for asset_class, symbols in WATCHLIST.items():
        adx_gate     = CLASS_ADX_GATES[asset_class]
        class_results = []

        for sym in symbols:
            r = score_symbol(sym, bal, adx_gate=adx_gate, risk_pct=risk_pct, daily_loss_pct=daily_loss_pct)
            if "error" not in r:
                class_results.append(r)

        order = {"SAFE": 0, "MODERATE": 1, "RISKY": 2}
        class_results.sort(key=lambda x: (order.get(x["classification"], 3), -x["score"]))

        for i, r in enumerate(class_results, 1):
            all_results.append(enrich(r, asset_class, i))

    mt5.shutdown()
    return {
        "balance_ngn":    bal,
        "daily_limit_ngn": bal * daily_loss_pct,
        "risk_per_trade":  bal * risk_pct,
        "daily_loss_pct":  daily_loss_pct,
        "risk_pct":        risk_pct,
        "pairs": all_results,
        "summary": {
            "total":    len(all_results),
            "safe":     sum(1 for r in all_results if r["classification"] == "SAFE"),
            "moderate": sum(1 for r in all_results if r["classification"] == "MODERATE"),
            "risky":    sum(1 for r in all_results if r["classification"] == "RISKY"),
        }
    }


@app.get("/health")
def health():
    return {"status": "ok"}
