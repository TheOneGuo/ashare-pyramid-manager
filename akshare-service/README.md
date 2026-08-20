# akshare 行情数据微服务（开发期专用）

为 uni-app 三端（微信小程序 / Android / iOS）通过 Node 后端 provider 抽象层，提供 akshare 口径的行情数据。

## 架构

```
小程序 / 安卓 / iOS（uni-app）
        │  HTTPS（仅我们自己的域名，进小程序白名单）
        ▼
Node 后端 9999（现有，鉴权/聚合/缓存）
        │  GET /api/market/{hist,north,lhb,f10}
        │  内网 HTTP → provider 抽象层（server/src/providers/）
        ▼
akshare-service :8800（本目录，Python/FastAPI）  ← 开发期
        │
        ▼
akshare（历史K线/北向/龙虎榜/F10）
```

**上架切换**：把 `DATA_PROVIDER` 从 `akshare` 改为 `compliant`，在 `server/src/providers/` 实现同一 `MarketProvider` 接口（对接东财开放平台 / 腾讯证券开放平台 / Tushare 商用版等授权源）。前端与 Node 路由契约不变，无需改动前端代码。

## 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/market/hist?code=600519&period=daily&start=20240101&end=20500101&adjust=qfq&limit=120` | 历史K线（新浪源，东财 push2his 本机网络拦截故走新浪） |
| GET | `/api/market/north?limit=60` | 北向资金（沪深港通净流入） |
| GET | `/api/market/lhb?date=20260819&limit=50` | 龙虎榜明细 |
| GET | `/api/market/f10?code=600519&kind=indicator&limit=40` | 财务（indicator/balance/cashflow/profit） |

## 本地启动

```powershell
cd akshare-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install akshare fastapi uvicorn
.\start.ps1          # 或 .\.venv\Scripts\python.exe main.py
```

健康检查：http://127.0.0.1:8800/health
