# 后端安全/正确性/清理/架构 加固 — 2026-08-20 完成总结

按「安全 → 正确性 → 效率/清理 → 架构」路线，分 5 轮推进并逐轮验证后提交。

## 提交链（main）
- `cd87c75` fix(security): P0 安全止血 — CORS 白名单 + API 鉴权 + 错误中间件 + 输入校验
- `e91c1bb` fix(correctness): 主刷新自调度 + mock guid 稳定化（防 DB 无限增长）
- `3571f81` fix(robustness): 持仓写入与跟踪引擎 NaN/脏数据防御
- `9689ace` chore(cleanup): 移除未使用依赖 + 清理 96 个调试脚本与 playwright 缓存
- `b074674` refactor(arch): 抽取 CORS/JSON错误/鉴权中间件到 middleware.js

## Round 1 — 安全止血 (P0)
- index.js: CORS 从反射任意 Origin 改为显式白名单（默认 localhost:5173 + file://，生产需 ALLOWED_ORIGINS）
- 新增 requireAuth 中间件，所有 POST/DELETE 写接口（除只读 resolve）强制 x-api-key
- 全局错误中间件：畸形 JSON 返回 400 invalid_json；统一 500 兜底
- holdings 输入校验：stock_code 必须为 6 位、shares 正整数、拒绝 SQL 注入字符串
- ifind 路由加 requireAuth + 60s 限速
- 前端 env.ts 移除 TURSO_* 字段、vite.config.ts 移除 TURSO_ envPrefix（避免 token 泄漏到客户端）

## Round 2 — 正确性与健壮性
- 主刷新循环：固定 setInterval 改为自调度 setTimeout，每次重算 refreshIntervalSeconds（修复原 #17：启动后间隔永久不变，交易时段卡死 15min / 休市卡死 8h）
- news-collector.js: mock guid 从 Date.now() 改为基于 channel+title 的稳定哈希（mock 模式不再每次刷新生成新 guid 导致 DB 无限增长）
- db.js upsertHolding: shares 强制正整数、cost_basis 非负有限数，否则抛错（importHoldings 的 try/catch 跳过，不污染 DB）
- track-executor.ts computeTrackState: cur 非有限数时提前返回空结果，防 NaN 穿透到持仓

## Round 3 — 清理
- server/package.json 移除 undici / node-cron / node-fetch（实际未使用，调度用 setTimeout，fetch 用 Node22 全局）
- news-sources.js 移除 `import { fetch } from 'undici'`
- docs/verify 删除 96 个调试脚本/截图/JSON + playwright chrome-profile-r4 缓存目录（保留 3 个 .md 总结）
- server/ 删除 25 个遗留 probe/fix 脚本与 svc 日志（dev.sqlite 已被 .gitignore 忽略）
- 删除根目录误建文件 console.log('health

## Round 4 — 架构解耦
- 新建 server/src/middleware.js：集中 CORS/JSON错误/鉴权/ifind 限速锁
- index.js 调用 registerCorsAndParse(app) + requireAuth + ifindRateLimit，路由层只关注业务
- 系统本已按关注点分离：采集(news-collector/news-sources/telegram-rss/eastmoney/macro-news)、计算(track-executor/account-ledger/portfolio-analyzer/pyramid)、存储(db)、API(index)

## 验证
- 每轮后端重启 + 健康检查 200 + 写接口鉴权 + 错误中间件 400 实测通过
- vue-tsc type-check 在 R2 时 EXIT=0
- 现有持仓（000858/600036/600519）相关公告、宏观源、持仓 feed 均正常

## 遗留（非阻塞）
- A 类直接源（互动易/中标/订单）仍靠关键词近似，未接 Tushare（需付费）
- 新闻页「持仓标的关键词」编辑交互已落地；画像落 DB holding_profiles
- 多个未跟踪 .md 总结文档（用户知识资产）保留未提交
- dev.sqlite 运行时被后端锁定，正常（已 gitignore）
