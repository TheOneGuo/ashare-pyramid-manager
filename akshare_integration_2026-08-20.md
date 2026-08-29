# akshare 行情数据接入 — 2026-08-20

## 结论
uni-app 三端（小程序/安卓/iOS）**不能直接跑 Python/akshare**。数据必须经 Node 后端中转后以标准 HTTPS API 供给前端。采用「akshare 微服务（开发期）+ Node provider 抽象层」方案，上架前切到合规源只需改一处 `DATA_PROVIDER`。

## 架构
```
三端 → Node 9999 (/api/market/*) → provider 抽象层 → akshare-service :8800 → akshare
```
前端只调我们自己域名，不知数据来源；上架切 `compliant` provider 实现即可（接口契约不变）。

## 落地内容（commit 44c537c）
- `akshare-service/`（Python venv + FastAPI）：/hist /north /lhb /f10 四端点
- hist 因本机网络拦截东财 push2his.eastmoney.com，改用新浪源 `stock_zh_a_daily`（已实测可用）
- NaN/Inf/NaT 递归清洗保证 JSON 合规（踩坑：pandas replace 漏 NaN，改用递归 sanitize）
- `server/src/providers/index.ts`：getProvider() 按 env 切换
- `server/src/providers/akshare.ts`：内网 HTTP 调用，12s 超时
- `server/src/index.js`：/api/market/{hist,north,lhb,f10} 路由（只读，失败降级）
- `.gitignore` 排除 `.venv`/日志；README 写清上架切换路径与合规约束

## 验证
- akshare 1.18.92 + fastapi 0.141 + uvicorn 0.52 安装成功
- 四端点直连微服务全部 OK（hist 637 条/sina、north、lhb 83 条、f10 103 条）
- 经 Node 9999 调 /api/market/* 全链路 OK

## 合规边界（必须遵守）
- akshare 仅开发参考不可商用；本服务只跑开发/内部环境，不进生产库、不外发、不打包生产
- 上架商用前必须切到授权源（东财开放平台/腾讯证券开放平台/Tushare 商用版）

## 待办
- 前端页面接入 /api/market/*（历史K线图、北向、龙虎榜、F10 展示）——尚未做
- 缓存层（热点数据缓存，降频调微服务）
- 生产 HTTPS + 小程序域名白名单（上架前置）
