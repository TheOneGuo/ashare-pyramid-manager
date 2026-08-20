"""
akshare 微服务（开发期专用）

用途：为 uni-app 三端（小程序/安卓/iOS）通过我们 Node 后端的 provider 抽象层，
提供 akshare 口径的数据（历史K线/北向资金/龙虎榜/F10）。
上线前会由合规数据源 provider 替换，前端 API 契约不变。

合规约束：akshare 仅开发参考不可商用——本服务只运行于开发/内部环境，
不进生产库、不外发、不打包进生产镜像。
"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import akshare as ak
import pandas as pd
import logging
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("akshare-service")

app = FastAPI(title="akshare-service", version="0.1.0")

# 仅允许同机 Node 后端调用（开发期）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发期，生产务必收窄
    allow_methods=["*"],
    allow_headers=["*"],
)


def _sanitize(v):
    """递归把任意对象里的 NaN/Inf/-Inf/NaT 清成 None，保证 JSON 合规。"""
    import math
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(v, (list, tuple)):
        return [_sanitize(x) for x in v]
    if isinstance(v, dict):
        return {k: _sanitize(val) for k, val in v.items()}
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d %H:%M:%S") if not pd.isna(v) else None
    if isinstance(v, str):
        return None if v.strip().lower() in ("", "nan") else v
    # numpy / pandas 标量（Int64、Float64、NaT 等）用 pd.isna 兜底
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return v


def _df_to_records(df: pd.DataFrame, limit: int = None):
    """DataFrame -> list[dict]，递归清洗 NaN/Inf/NaT，可选截断。"""
    if df is None or len(df) == 0:
        return []
    recs = df.to_dict(orient="records")
    recs = [_sanitize(r) for r in recs]
    if limit:
        recs = recs[:limit]
    return recs


@app.get("/health")
def health():
    return {"ok": True, "service": "akshare-service", "akshare": ak.__version__}


@app.get("/hist")
def hist(
    code: str = Query(..., description="6位A股代码，如 600519"),
    period: str = Query("daily", description="daily/weekly/monthly"),
    start: str = Query("20240101", description="YYYYMMDD"),
    end: str = Query("20500101", description="YYYYMMDD"),
    adjust: str = Query("qfq", description="qfq/hfq/空"),
    limit: int = Query(120, description="返回条数上限"),
):
    try:
        # 东财 stock_zh_a_hist 所用 push2his 域名在本机网络被拦截，改用新浪源 stock_zh_a_daily（稳定可用）
        # 新浪 symbol 格式：sh600519 / sz000858
        if code.startswith(("6", "9")):
            sina_symbol = "sh" + code
        else:
            sina_symbol = "sz" + code
        adj = adjust if adjust in ("qfq", "hfq") else ""
        df = ak.stock_zh_a_daily(symbol=sina_symbol, adjust=adj, start_date=start, end_date=end)
        return {"ok": True, "code": code, "source": "sina", "count": len(df), "items": _df_to_records(df, limit)}
    except Exception as e:
        logger.exception("hist failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/north")
def north(limit: int = Query(60, description="返回条数")):
    """北向资金（沪深港通）历史净流入。"""
    try:
        df = ak.stock_hsgt_fund_flow_summary_em()
        return {"ok": True, "count": len(df), "items": _df_to_records(df, limit)}
    except Exception as e:
        logger.exception("north failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/lhb")
def lhb(
    date: str = Query(..., description="YYYYMMDD，如 20260820"),
    limit: int = Query(50),
):
    """龙虎榜明细（按交易日）。"""
    try:
        df = ak.stock_lhb_detail_em(start_date=date, end_date=date)
        return {"ok": True, "date": date, "count": len(df), "items": _df_to_records(df, limit)}
    except Exception as e:
        logger.exception("lhb failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/f10")
def f10(
    code: str = Query(..., description="6位代码"),
    kind: str = Query("indicator", description="indicator/balance/cashflow/profit"),
    limit: int = Query(40),
):
    """基础财务（利润表/资产负债表/现金流量表）。"""
    try:
        if kind == "indicator":
            df = ak.stock_financial_analysis_indicator(symbol=code)
        elif kind == "balance":
            df = ak.stock_balance_sheet_by_report_em(symbol=code)
        elif kind == "cashflow":
            df = ak.stock_cash_flow_sheet_by_report_em(symbol=code)
        elif kind == "profit":
            df = ak.stock_profit_sheet_by_report_em(symbol=code)
        else:
            raise HTTPException(status_code=400, detail="unknown kind")
        return {"ok": True, "code": code, "kind": kind, "count": len(df), "items": _df_to_records(df, limit)}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("f10 failed")
        raise HTTPException(status_code=502, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8800, log_level="info")
