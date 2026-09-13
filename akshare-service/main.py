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
import json
import os
import threading

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


# ============= 机构持仓结果缓存（抵御东方财富 dataapi 偶发超时） =============
# 痛点：stock_report_fund_hold 底层调东方财富 dataapi/zlsj/list，网络偶发
# Max retries exceeded → /hold 全报告期失败返回 502，导致「股票中意榜」间歇性空白。
# 方案：成功即落盘 JSON（内存+文件双缓存），全失败时回吐上次成功结果并标 stale=true，
# 前端照常渲染（数据带报告期标注，用户可知其为最近一次成功快照）。
_HOLD_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hold_cache.json")
_HOLD_CACHE: dict = {}
_CACHE_LOCK = threading.Lock()


def _load_hold_cache() -> None:
    global _HOLD_CACHE
    try:
        if os.path.exists(_HOLD_CACHE_FILE):
            with open(_HOLD_CACHE_FILE, "r", encoding="utf-8") as f:
                _HOLD_CACHE = json.load(f)
            logger.info("hold cache loaded: %d kind(s)", len(_HOLD_CACHE))
    except Exception as e:
        logger.warning("hold cache load failed: %s", e)
        _HOLD_CACHE = {}


def _save_hold_cache() -> None:
    try:
        with open(_HOLD_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_HOLD_CACHE, f, ensure_ascii=False)
    except Exception as e:
        logger.warning("hold cache save failed: %s", e)


# 单次 akshare 抓取上限（秒）。东方财富 dataapi 偶发挂起（SSL EOF / 无响应），
# 不设上限会拖垮整个 /hold（后端 20s 超时先到 → 股票中意榜空白）。超时即视为失败并回退缓存。
_HOLD_FETCH_TIMEOUT = 4


def _run_with_timeout(fn, timeout, *args, **kwargs):
    """在守护线程执行阻塞调用，timeout 秒后放弃（返回 (None, TimeoutError)）。"""
    box: dict = {}

    def _worker() -> None:
        try:
            box["v"] = fn(*args, **kwargs)
        except Exception as e:  # noqa: BLE001
            box["e"] = e

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        return None, TimeoutError(f"{getattr(fn, '__name__', 'call')} exceeded {timeout}s")
    if "e" in box:
        return None, box["e"]
    return box.get("v"), None


_load_hold_cache()


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
    # 清理列名：去首尾空白（akshare 部分列名尾部带空格导致前端取不到键）
    df = df.rename(columns=lambda c: c.strip() if isinstance(c, str) else c)
    recs = df.to_dict(orient="records")
    recs = [_sanitize(r) for r in recs]
    if limit:
        # akshare 返回多为升序（最早在前），取末尾 limit 条 = 最近 N 条，
        # 避免只截断出最早年份（如 F10 只剩 1998~2001，漏掉 2023+）
        recs = recs[-limit:]
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
            # 同花顺主要财务指标（含 2023~最新报告期，akshare 的
            # stock_financial_analysis_indicator 数据停在 2010，已弃用）
            df = ak.stock_financial_abstract_ths(symbol=code)
            if df is not None and len(df.columns) > 0:
                df = df.rename(columns={df.columns[0]: "日期"})
        else:
            # balance / cashflow / profit 三表走新浪源（东财 *_by_report_em 在
            # 当前 akshare 版本有解析 bug，返回 None），字段为「报告日 + 各科目」
            sina_symbol = ("sh" if code.startswith("6") else "sz") + code
            sina_map = {
                "balance": "资产负债表",
                "cashflow": "现金流量表",
                "profit": "利润表",
            }
            if kind not in sina_map:
                raise HTTPException(status_code=400, detail="unknown kind")
            df = ak.stock_financial_report_sina(stock=sina_symbol, symbol=sina_map[kind])
            # 统一首列为「日期」便于前端复用
            if df is not None and len(df.columns) > 0:
                df = df.rename(columns={df.columns[0]: "日期"})
        return {"ok": True, "code": code, "kind": kind, "count": len(df), "items": _df_to_records(df, limit)}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("f10 failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/sector-flow")
def sector_flow():
    """行业板块主力资金流（资金流向 tab 数据源之一，akshare 供应商模式）。

    优先 akshare（东财 push2，正常网络环境可用）；本机 push2 被拦截时自动回退腾讯 getRank。
    输出统一为 TencentBoard 同构：{code,name,zljlr,zljlr_d5,zljlr_d20,lead_code,lead_name,lead_zdf}，
    净额单位统一为「万元」，并附带 window20 说明 d20 窗口（10日/20日），避免口径标注失真。
    """
    import requests as _rq

    def _col(df, name):
        for c in df.columns:
            if str(c).strip() == name or str(c).strip().startswith(name):
                return c
        return None

    def _to_wan(series):
        vals = []
        for x in series:
            try:
                if x is None or pd.isna(x):
                    continue
                vals.append(float(x))
            except (TypeError, ValueError):
                continue
        if not vals:
            return []
        if max(abs(v) for v in vals) > 1e8:
            return [round(v / 1e4, 2) for v in vals]  # 元 → 万元
        return [round(v, 2) for v in vals]

    try:
        # 今日 / 5日 / 10日 三个窗口，东财「主力净流入-净额」单位=元
        frames = {}
        for ind in ("今日", "5日", "10日"):
            df = ak.stock_sector_fund_flow_rank(indicator=ind, sector_type="行业资金流")
            if df is None or len(df) == 0:
                raise RuntimeError("akshare sector flow empty @ " + ind)
            frames[ind] = df.rename(columns=lambda c: str(c).strip() if isinstance(c, str) else c)
        base = frames["今日"]
        names = [str(x) for x in base["名称"].tolist()]
        leaders = [str(x) if x is not None else "" for x in (_col(base, "主力净流入-最大股") and base[_col(base, "主力净流入-最大股")].tolist() or [""] * len(base))]
        nets = {}
        for ind in ("今日", "5日", "10日"):
            c = _col(frames[ind], "主力净流入-净额")
            nets[ind] = _to_wan(frames[ind][c].tolist() if c else [])
        n = len(names)

        def pad(vals):
            vals = list(vals)
            return (vals + [0] * n)[:n]

        items = [
            {
                "code": f"BK{i+1:04d}",
                "name": names[i],
                "zljlr": pad(nets["今日"])[i],
                "zljlr_d5": pad(nets["5日"])[i],
                "zljlr_d20": pad(nets["10日"])[i],
                "lead_code": "",
                "lead_name": leaders[i],
                "lead_zdf": 0,
            }
            for i in range(n)
        ]
        return {"ok": True, "source": "akshare-em", "window20": "10日", "count": len(items), "items": items}
    except Exception as e:
        logger.warning("akshare sector-flow failed(%s), fallback tencent getRank", e)
        # 腾讯 getRank（本机实测可达，净额单位=万元）
        try:
            r = _rq.get(
                "https://proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank?board_type=hy&sort_type=price&direct=down&offset=0&count=50",
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://stockapp.finance.qq.com/"},
                timeout=12,
            )
            data = r.json()
            items = []
            for it in (data.get("data") or {}).get("rank_list") or []:
                def _n(v):
                    try:
                        return float(v)
                    except (TypeError, ValueError):
                        return 0.0
                lzg = it.get("lzg") or {}
                items.append({
                    "code": str(it.get("code", "")),
                    "name": str(it.get("name", "")).strip(),
                    "zljlr": round(_n(it.get("zljlr")), 2),
                    "zljlr_d5": round(_n(it.get("zljlr_d5")), 2),
                    "zljlr_d20": round(_n(it.get("zljlr_d20")), 2),
                    "lead_code": str(lzg.get("code", "")),
                    "lead_name": str(lzg.get("name", "")),
                    "lead_zdf": _n(lzg.get("zdf")),
                })
            if not items:
                raise RuntimeError("tencent getRank empty")
            return {"ok": True, "source": "tencent", "window20": "20日", "count": len(items), "items": items}
        except Exception as e2:
            logger.exception("sector-flow all failed")
            raise HTTPException(status_code=502, detail=f"akshare:{e} tencent:{e2}")


@app.get("/north-daily")
def north_daily(limit: int = Query(15, description="返回条数")):
    """北向日度成交（沪深港通·北向合计）。优先 akshare(东财 datacenter)，失败回退直连 datacenter。

    输出：{date, dealAmtYi(亿), dealNum, lead, leadZdf}
    """
    import requests as _rq
    try:
        df = ak.stock_hsgt_hist_em(symbol="北向资金", period="每日")
        if df is None or len(df) == 0:
            raise RuntimeError("akshare north hist empty")
        df = df.rename(columns=lambda c: str(c).strip() if isinstance(c, str) else c)
        c_amt = "成交总额" if "成交总额" in df.columns else "成交净买额"
        dates = df["日期"].astype(str).tolist()
        amts = []
        for x in df[c_amt].tolist():
            try:
                amts.append(float(x) if x is not None and not pd.isna(x) else 0.0)
            except (TypeError, ValueError):
                amts.append(0.0)
        scale = 1e4 if (amts and max(abs(a) for a in amts) > 1e6) else 1.0  # 万元→亿 /1e4
        items = [
            {"date": dates[i][:10], "dealAmtYi": round(amts[i] / scale, 2), "dealNum": 0, "lead": "", "leadZdf": 0}
            for i in range(len(dates))
        ]
        items = items[-limit:][::-1]
        return {"ok": True, "source": "akshare-em", "count": len(items), "items": items}
    except Exception as e:
        logger.warning("akshare north-daily failed(%s), fallback datacenter", e)
        try:
            url = (
                "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEAL_HISTORY&columns=ALL"
                "&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=" + str(max(2, limit)) + "&pageNumber=1&source=WEB&client=WEB"
                "&filter=" + _rq.utils.quote('(MUTUAL_TYPE="005")')
            )
            j = _rq.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/"}, timeout=12).json()
            rows = (j.get("result") or {}).get("data") or []
            items = []
            for r in rows:
                try:
                    amt = float(r.get("DEAL_AMT")) if r.get("DEAL_AMT") is not None else 0.0
                except (TypeError, ValueError):
                    amt = 0.0
                try:
                    lzdf = round(float(r.get("LS_CHANGE_RATE")), 2) if r.get("LS_CHANGE_RATE") is not None else 0
                except (TypeError, ValueError):
                    lzdf = 0
                items.append({
                    "date": str(r.get("TRADE_DATE", ""))[:10],
                    "dealAmtYi": round(amt / 100, 2),  # 东财 DEAL_AMT 单位=百万元 → 亿
                    "dealNum": int(r.get("DEAL_NUM") or 0),
                    "lead": str(r.get("LEAD_STOCKS_NAME") or ""),
                    "leadZdf": lzdf,
                })
            if not items:
                raise RuntimeError("datacenter north empty")
            return {"ok": True, "source": "datacenter", "count": len(items), "items": items}
        except Exception as e2:
            logger.exception("north-daily all failed")
            raise HTTPException(status_code=502, detail=f"akshare:{e} datacenter:{e2}")


# 机构持仓报告期候选（新→旧）。季报披露存在滞后，逐个回退到有数据的报告期。
_HOLD_PERIODS = ["20260630", "20260331", "20251231", "20250630"]


@app.get("/hold")
def hold(
    kind: str = Query("fund", description="fund=基金持仓 / qfii=QFII持仓 / sb=社保持仓"),
    limit: int = Query(60, description="返回条数上限"),
):
    """机构持仓个股（资金流向「股票中意榜」数据源）。

    基于 akshare stock_report_fund_hold（新浪源，本机实测可达）：
    返回股票代码/简称/持有家数/持股总数/持股市值/持股变化(增仓|减仓|新进)/变动数值/变动比例。
    报告期为季报口径（滞后披露，响应内回传 report_date 供前端如实标注）。
    """
    sym_map = {"fund": "基金持仓", "qfii": "QFII持仓", "sb": "社保持仓"}
    if kind not in sym_map:
        raise HTTPException(status_code=400, detail=f"unknown kind: {kind}")
    symbol = sym_map[kind]

    def _prio(x):
        s = str(x)
        if s == "新进":
            return 0
        if s == "增仓":
            return 1
        if s == "不变":
            return 2
        if s == "减仓":
            return 3
        return 4

    last_err = None
    for period in _HOLD_PERIODS:
        try:
            df, err = _run_with_timeout(ak.stock_report_fund_hold, _HOLD_FETCH_TIMEOUT, symbol=symbol, date=period)
            if err is not None:
                last_err = err
                logger.warning("hold %s @%s failed: %s", kind, period, err)
                continue
            if df is None or len(df) == 0:
                continue
            df = df.rename(columns=lambda c: str(c).strip() if isinstance(c, str) else c).copy()
            # 数据完整度：该报告期若「持股变化」列几乎全空（新报告期常见），回退到上一期
            chg_col = "持股变化"
            if chg_col in df.columns:
                notna_ratio = df[chg_col].notna().sum() / max(1, len(df))
            else:
                notna_ratio = 0.0
            if notna_ratio < 0.3:
                logger.warning("hold %s @%s 持股变化缺失(%.0f%%), 回退上一报告期", kind, period, notna_ratio * 100)
                continue
            # 增仓/新进优先，其次按变动数值绝对值降序（更能代表"中意"）
            try:
                df["_prio"] = df[chg_col].map(_prio)
                df["_chg"] = pd.to_numeric(df.get("持股变动数值"), errors="coerce").fillna(0).abs()
                df = df.sort_values(["_prio", "_chg"], ascending=[True, False]).drop(columns=["_prio", "_chg"])
            except Exception:
                logger.warning("hold sort fallback for %s/%s", kind, period)
                df = df.sort_values("持股市值", ascending=False)
            # 注意：此处取「前」limit 条（_df_to_records 的 limit 取末尾，适用于升序原始数据）
            items = _sanitize(df.head(limit).to_dict(orient="records"))
            # 成功即写入缓存（内存+磁盘），供东方财富超时时的兜底回吐
            with _CACHE_LOCK:
                _HOLD_CACHE[kind] = {
                    "report_date": period,
                    "source": "akshare-sina",
                    "items": items,
                    "ts": time.time(),
                }
                _save_hold_cache()
            return {
                "ok": True,
                "kind": kind,
                "symbol": symbol,
                "report_date": period,
                "source": "akshare-sina",
                "count": len(items),
                "items": items,
            }
        except Exception as e:
            last_err = e
            logger.warning("hold %s @%s failed: %s", kind, period, e)
    # 全报告期失败：东方财富偶发超时 → 回吐上次成功结果（标 stale），避免「股票中意榜」空白
    with _CACHE_LOCK:
        cached = _HOLD_CACHE.get(kind)
    if cached and cached.get("items"):
        age_h = (time.time() - cached.get("ts", 0)) / 3600
        logger.warning("hold %s all periods failed, serve stale cache (%.1fh old)", kind, age_h)
        return {
            "ok": True,
            "kind": kind,
            "symbol": symbol,
            "report_date": cached["report_date"],
            "source": cached.get("source", "akshare-sina"),
            "count": len(cached["items"]),
            "items": cached["items"],
            "stale": True,
            "stale_age_hours": round(age_h, 1),
        }
    logger.exception("hold all periods failed")
    raise HTTPException(status_code=502, detail=str(last_err))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8800, log_level="info")
