# A股正金字塔交易法-节节高 · 全量工程审计与架构方案

- **审计日期**：2026-09-15
- **审计范围**：整体代码、数据库、备份、CSV/Python 服务、前端五端（H5/微信/安卓/iOS/小程序）
- **代码规模**：后端 `server/src/` 9,194 行（26 文件）｜前端 `src/` 7,457 行（28 文件）｜Python `akshare-service/main.py` ~490 行
- **方法**：4 路并行专项审查（后端逻辑 / 安全 / 前端性能与埋点 / 数据库与死代码）+ 关键结论人工二次取证

## 0. 先澄清两个前提

| 你的表述 | 实际情况 |
|---|---|
| 「Flask」 | **本项目没有 Flask**。Python 侧是 `akshare-service/main.py`（**FastAPI** + uvicorn，端口 8800，仅开发期使用，生产不部署）。 |
| 「CSV」 | 仓库内**没有任何 `.csv` 文件**。CSV 仅存在于 `server/src/stock-service.ts`（导入持仓时的文本解析逻辑）与一个 `dist/` 构建产物。 |

---

## 0.1 结论摘要（TL;DR）

**必须先修的 3 件事（按严重度）**

1. **🔴 所有写接口无鉴权** — `API_KEY` 未配置，`middleware.js:42` 直接放行。能访问 :9999 的人可 `DELETE /api/portfolio/ledger` 清空账本、伪造持仓。
2. **🔴 密钥硬编码在 `.env`** — Turso 读写 JWT、`FXBAOGAO_API_KEY`、`LLM_API_KEY` 明文落盘（虽已 gitignore，但备份/截图/投屏即泄露）。**建议轮换 Turso token**。
3. **🟠 定时刷新可永久挂死** — `refreshAll` 无硬超时，macro 抓取无 `AbortSignal`；上游挂起 → `finally` 不执行 → 自调度定时器不再 re-arm → **新闻采集中途静默死亡，且 `refreshing` 永久为 true**。

**统计**：后端 0 CRITICAL / 1 HIGH / 6 MEDIUM / 3 LOW；安全 1 CRITICAL / 2 HIGH / 3 MEDIUM / 3 LOW；前端 2 HIGH / 6 MEDIUM / 4 LOW；DB 与死代码：2 张死表、1 个冗余字段、1 个死模块、可清理 ~292MB。

**验证过的好消息**：**无 SQL 注入**（全部 `?` 绑定参数）、**无 SSRF**、**无路径穿越**、**无 ReDoS**、**无前端 XSS**（无 `v-html`）。这些是常见高危项，代码质量在这里是过硬的。

---

## 1. 代码审查：逻辑漏洞与边界情况（Q1）

### HIGH
**[H1] 定时刷新无硬超时 → 采集循环可永久静默死亡**
`server/src/index.js:1533` + `news-collector.js:235` + `macro-news.js:29,65,96,124`
```js
const summary = await refreshAll({...});        // 无 deadline，finally 里才 re-arm 定时器
const r = await fetch(url, { headers: EM_HEADERS });  // macro 全部 fetch 无 AbortSignal
```
`Promise.all(...).catch()` 只能接 reject，接不住**挂起**。一旦上游 accept 后不响应 → `refreshAll` 永不 resolve → `finally` 不执行 → 定时器不再续排；同时 `refreshing=true` 卡死，后续手动刷新全部返回 429。
**修复**：`withDbTimeout(refreshAll(...), 60000)` 硬超时 + macro 步加 `AbortSignal.timeout(15000)`，超时即本轮回退、定时器照常续排。

### MEDIUM
| # | 位置 | 问题 | 触发条件 |
|---|---|---|---|
| M1 | `index.js:99,418-419` vs `1533` | `refreshing` 互斥锁**不覆盖** `scheduledRefresh`，手动+定时可并发双刷 | 用户手动刷新撞上定时刷新 |
| M2 | `index.js:893,902` | `listUnrefinedFxbaogao` 未 `.catch`（同函数其他 3 个都兜了）；且 `unrefined.length >= 0 ? ... : 0` 是**恒真死条件** | Turso 抖动 → 该接口 500 |
| M3 | `stock-service.ts:148` | CSV 解析 `cnNum(cell) === 0` 判名称失效：`cnNum("五粮液")` = `NaN`，`NaN===0` 为 false → 中文名被当成本价 | 粘贴「名称 成本 数量」格式，**中文股整行丢失** |
| M4 | `stock-service.ts:25,105` | 市场前缀只判 `6→sh` 否则 `sz`，漏 5/9/11/12 开头 | 510300(沪ETF)、9xxxxx(沪B)、11/12xxxx(沪债) 打成 `sz` → 取不到行情，导入失败 |
| M5 | `llm.ts:54` | `chatJson` 的 fetch 无超时/AbortSignal；`judgeFxbaogaoTitlesByLlm`（index.js:195 直接调用）未包超时 | LLM 端点挂起 → 每日任务永久 pending |
| M6 | `db.js:1244` | `upsertFxbaogaoReports` 的 batch 无逐行兜底（对比 `upsertNewsItems` db.js:319-336 有） | 单条脏行 → 整页 20 条原子回滚，每 15 分钟反复失败 |

### LOW
- `news-collector.js:68` 间隔恒 clamp 到 15min → `labelForInterval:361` 的 4 档策略分支永不成立，休市日也显示「交易时段·15分钟」（误导排查）。
- `news-collector.js:36` `HOLIDAY_CHECK_URL` 声明未用；`isTradeDayShanghai` 只判周一~周五，**国庆/春节等周内休市日仍高频轮询**。
- `track-executor.ts:90` `if (!cur) return done` 把价格 0 当「无步骤」（A股实时价不为 0，影响极小）。

### 边界情况（已验证无问题）
`pyramid.ts` 的除零已正确守卫（`:549,:557` `pct: cap ? … : 0`）。

---

## 2. 字段 / 规则描述不清晰（Q2）

| 位置 | 不清晰点 | 建议 |
|---|---|---|
| `db.js` SCHEMA | `fxbaogao_reports.source_range` **只写不读**（db.js:1217,1222 写入，全仓无 SELECT） | 明确为「预留元数据」或直接下线（见 Q8） |
| `research/index.vue:396-397` | `ALL_DATE_RANGES` 有两个条目同为 `value:'last1day'`（"最新"/"1天"） | 改名区分或删除重复键 |
| `news-collector.js:68` | 4 档轮询策略（DAYTIME/NIGHT/HOLIDAY/TRADING）实际全被压成 900s，策略名与行为不符 | 要么实现分档，要么删除策略名 |
| `researchClassifier` 重复 | 「先进生产力」分类器在 `research/index.vue:305-320` 与 `utils/researchClassifier.ts:4-27` **各写一份，关键词表还不一样** | 单一数据源，页面引用 util |
| `providers/index.ts:7,22` | 声明了 `compliant` provider 但**从未实现**，`DATA_PROVIDER` 默认 `akshare` | 补实现或从契约中移除，否则误导后续扩展 |
| `.env.example` | 只有 `FXBAOGAO_API_KEY`，**缺 `API_KEY`（鉴权）、`ALLOWED_ORIGINS`（CORS）、`NODE_ENV`** 三个关键项 | 补齐并在 README 注明必填 |
| 交易日规则 | 无节假日日历，交易日=周一~周五 | 引入交易日历（可用 `akshare tool_trade_date_hist_sina`） |

---

## 3. 未处理的异常场景（Q3）

| 场景 | 现状 | 后果 |
|---|---|---|
| 上游 HTTP 挂起（非报错） | 无 `AbortSignal`（macro-news / llm.ts） | 任务永久 pending，定时器不再续排（见 H1） |
| 网络超时/断连 | `write-guard.js` 有 spool 落盘重放 ✅ | 写路径已覆盖；**读路径**仅靠重试+缓存 |
| 批量写部分失败 | `upsertFxbaogaoReports` 整页回滚，无逐行兜底（M6） | 脏行污染整批 |
| 前端接口失败 | 5 个页面各自实现 try/catch，行为**不一致** | portfolio 静默 `console.warn` → 空白/陈旧无提示；research 设了 `allError` **但从不渲染**；news 失败后永远转「拉取中」 |
| uni-app `onShow` 首屏 | `portfolio/index.vue:920`、`news/index.vue:416` **无 `firstShow` 守卫**（research:1049 有） | `onShow` 早于 `onMounted` → **首进页面重复请求两次** |
| 嵌套 await 无保护 | `portfolio/index.vue:657-667` `uni.showModal.success` 内 `await analyzePortfolio()` 无 try/catch | 失败时 unhandled rejection，用户看不到任何错误 |
| 空数据 / 0 行 | 部分列表无空态 | 空白页 |

---

## 4. 数据埋点遗漏（Q4）

**现状：几乎没有埋点。** 全仓 grep `sentry|umeng|gtag|analytics|埋点|performance.` → 仅 `news/index.vue:305` 一处 `console.error` 和若干开发用 `console.log/warn`。

**缺失清单（建议补齐）**

| 类别 | 应埋内容 | 落点 |
|---|---|---|
| 错误 | 所有接口异常、unhandled rejection、组件错误边界 | `reportError()` → Sentry/自建 |
| 性能 | 页面首屏耗时、接口 P50/P95 延迟、金字塔计算耗时 | `reportTiming()` |
| 行为 | 分析持仓、新增计划、导入持仓、切 Tab、刷新研报 | `reportEvent()` |
| 业务 | 新闻采集成功率/每源条数、研报同步量、LLM 调用成功率与耗时 | 服务端日志 → metrics |
| 健康 | 定时器心跳、spool 积压量、Turso 连通性 | `/healthz` 暴露 |

**实施建议**：在统一请求层 `useApi` 的 catch 中统一调 `reportError`，在 `useAsync` 成功后调 `reportTiming`。

---

## 5. 执行效率（Q5）— 你问的 6 个子问题逐条回答

### 5.1 「单一体量过大能否拆分」→ 能，且收益最大
| 文件 | 行数 | 拆分建议 |
|---|---|---|
| `research/index.vue` | 1350 | 抽 `<ReportBody>`（AI 精读块在 Tab1/Tab2 各抄一份：92-117 / 180-209）、日期范围、筛选器 |
| `portfolio/index.vue` | 1284 | 抽 持仓表 / 计划表 / 账本 / 分析面板 4 个子组件 |
| `news/index.vue` | 826 | 抽 快讯卡片 / 过滤器 |
| `market/index.vue` | 703 | 抽 指数卡 / 排行 |
| `server/src/index.js` | 1634 | **按域拆路由**：`routes/news.js` `routes/portfolio.js` `routes/research.js` `routes/fundflow.js` |
| `server/src/db.js` | 1799 | **按域拆仓储**：`repo/news.js` `repo/portfolio.js` `repo/research.js` + 统一 `client` |

### 5.2 「多处控制显示的执行代码能否合并」→ 能，**这是当前最该做的一件事**
实锤的**四份重复请求实现**：
- `src/api/portfolio.ts:276` → `jget` + `uni.request`
- `src/api/market.ts:62/73` → `fetch` + `build()`
- `src/api/fundflow.ts:66/73` → **与 market.ts 的 `build()` 逐字节相同**
- `src/pages/news/index.vue:191/292` → 内联 `uni.request`

且 `API_BASE` 在 4 处重复声明；loading/error/retry 块（各 20~30 行）在 5 个页面各写一遍。
**方案**：统一 `request()`（用 `uni.request` 包装，保证 H5/小程序/App 三端一致）+ `useAsync(fn)` composable。**以后改一处即可，不会漏改**。

### 5.3 「计算结果能否复用」→ 能
- `portfolio/index.vue:725-765` `loadPlans()` **每次 `onShow` 都重建 `byCode`/`byName` Map 并发起 N 个 `resolveStockCode` 并行网络请求** → 名称解析结果应缓存（仅缺失时请求）。
- `news/index.vue:257-269` `detectMatchedHoldings` 是 O(条数×持仓数)，且每次拉取重算 → 每次拉取预计算一次。
- `pyramid.ts:406-474` `lotsPlanV41` 约 320 步 × 4 价，单次 `computePlan` 可接受，**但需确认不在 render 循环内调用**。

### 5.4 「缓存机制能否后台同步运行」→ 当前**完全没有客户端缓存**
Portfolio / News 每次切 Tab（`onShow`）全量重拉；Research 每次重拉整表。
**唯一正面样板**：`fundflow/index.vue:123-125` 用 `if (!data.value)` 守卫。
**方案**：`useCache(key, ttl)` + **in-flight 去重** + **stale-while-revalidate**（先渲染缓存，后台刷新后替换）→ 切 Tab 秒开。

### 5.5 「各模块数据采集能否自动化 + 分散化」→ 当前无预取
只有 Research 触发了服务端同步（`ensureTodaySynced`，research:1029-1036）。
**方案**：App 启动/空闲时触发 `prefetchAll()`，预热 持仓/账本/资金流/研报列表；服务端侧把 15 分钟同步任务改为**按模块错峰**（避免同时打外部源）。

### 5.6 其他性能点
- 缺索引：`research_reports(broker)`（db.js:1143 `WHERE broker=?`）、`portfolio_plans(updated_at)`（db.js:1061 `ORDER BY`）。量小但应补。
- `fxbaogao_reports` 3 处热查询用 `org_name LIKE '%...%'`（db.js:1280/1521/1572）无法走索引 → 建议物化 `is_foreign` 标志 + 索引。

---

## 6. 安全检查（Q6）

### 🔴 CRITICAL — 所有写接口无鉴权
```js
// server/src/middleware.js:37,42
const API_KEY = process.env.API_KEY || '';
if (!API_KEY) return next();   // ← API_KEY 未配置 → 直接放行
```
`.env` / `server/.env` 中**均无 `API_KEY`**（已核实：只有 `FXBAOGAO_API_KEY`、`LLM_API_KEY`）。
**攻击面**：`DELETE /api/portfolio/ledger` 清空账本、`POST /api/portfolio/holdings` 伪造持仓、`DELETE /api/research/reports/:id` 删研报。:9999 无防火墙即可被任意访问。
**修复**：设置强 `API_KEY`；**生产环境未设置时启动即失败（fail-fast），而非仅 `console.warn`**（middleware.js:38-39 目前只警告）。

### 🟠 HIGH
1. **`.env:4` / `server/.env:3` 硬编码 Turso 读写 JWT** — 拿到即可从任意位置读写生产库。**建议立即轮换**。
2. **`server/.env:16,25` 硬编码 `FXBAOGAO_API_KEY`、`LLM_API_KEY`** — 配额盗用。建议轮换，改由密钥管理注入。（✅ 已确认二者均未被 git 跟踪，`.env` 已 gitignore，无 git 历史泄露）

### 🟡 MEDIUM
3. `middleware.js:7-9` — `ALLOWED_ORIGINS` 未设时 `DEV_CORS=true`，会反射 `null` origin（可被沙箱 iframe 伪造）。生产应 **fail-closed**。
4. `index.js:583,1272,640,1016` — POST body **无集中校验**（ledger 直接存 `payload`；holdings/import 无 shape/length 约束）。建议 zod 白名单校验键与类型。（SQL 已参数化，影响有限）
5. 无限流 — 仅 ifind 一个端点有限流；无全局限流 → 匿名刷 `/api/news/refresh` 可致资源耗尽/成本爆炸（叠加无鉴权更严重）。

### 🟢 LOW
6. `stock-service.ts:217-221` `writeTempFile` 的 `ext` 未净化（潜在路径穿越），但**全仓无调用者**（死代码，当前不可利用）→ 随死代码一并删除。
7. `server/package.json:19` `pdf-parse ^1.1.1` 有已知公告（import 副作用）；`stock-service.ts:193` 动态 import 会触发其调试行为。
8. `akshare-service/main.py:27-32` CORS `allow_origins=["*"]` — 但只绑 `127.0.0.1:8800` 且仅开发期，**切勿暴露到非本机**。

### ✅ 已验证安全（无需动作）
SQL 注入（全部 `?` 绑定）｜SSRF（频道为硬编码清单，PDF 域名白名单）｜路径穿越（`pdfCachePath` 强制 `Number(reportId)`）｜ReDoS（正则无嵌套量词）｜前端 XSS（无 `v-html`）

---

## 7. 生产环境冗余 / 过期弃用代码（Q7）

| 对象 | 证据 | 判定 |
|---|---|---|
| `server/src/news-sources.js`（Yahoo/BBC/HackerNews 源） | 全仓 **0 importers** | **死代码，可删** |
| `stock-service.ts:217-221` `writeTempFile` | 全仓 0 调用 | 死代码，可删（含 LOF 隐患） |
| 6 个前端零调用的路由 | `/api/news/sources`(408) `/api/news/refresh`(417) `/api/track/state`(452) `/api/research/fxbaogao/summary`(890) `/api/research/fxbaogao/job-status`(958) `/api/ifind/health`(1391) | 疑似管理/调试端点，**删除前需产品确认**（可能带外调用） |
| `compliant` provider | `providers/index.ts:7,22` 声明，**从未实现** | 未完成功能（非死代码）→ 补齐或移除契约 |
| `turso_pull.sqlite3.bak` | 22M 陈旧快照 | 可删（见 Q8） |
| `akshare-service/__pycache__` | 12K | 可删（自动再生） |
| `server/data/fxbaogao-pdfs` | **270M / 130 文件** | PDF 缓存，可由 `pdf_url` 重新下载 → 可清理 |
| `eastmoney.js` `macro-news.js` `sina-live.js` `telegram-rss.js` | news-collector.js:19-23 引用 | **在用，勿删** |
| TODO/FIXME | 仅 `news-sources.js:18`（注释，非待办） | 无需动作 |

---

## 8. 数据库冗余字段、过期备份与精简方案（Q8）

### 8.1 表清单与现状
| 表 | 行数 | 状态 |
|---|---|---|
| `fxbaogao_reports` | 12,980 | 在用（研报索引） |
| `news_items` | 4,433 | 在用 |
| `fxbaogao_ai` | 444 | 在用（AI 精读） |
| `news_sources` | 22 | 在用 |
| `portfolio_recommendations` | 16 | 在用 |
| `research_reports` | 13 | 在用 |
| `fxbaogao_daily_download` | 12 | 在用 |
| `holding_profiles` / `portfolio_holdings` / `portfolio_plans` | 3 / 3 / 4 | 在用 |
| `portfolio_ledger_events` | 1 | 在用 |
| `research_stock_reports` | 2 | 在用 |
| **`research_items`** | **0** | ❌ **无任何读写函数**（仅 SCHEMA + 迁移脚本 + README 提及） |
| **`portfolio_snapshots`** | **0** | ❌ **无任何读写函数** |

### 8.2 冗余字段
**`fxbaogao_reports.source_range`** — db.js:1217/1222 写入，**全仓无 SELECT**。只写不读。

### 8.3 精简方案（按「零数据损失 + 可逆」排序，均不影响功能）

| 步骤 | 动作 | 风险 | 可逆性 |
|---|---|---|---|
| 1 | 删 `turso_pull.sqlite3.bak`（22M） | 零（远端可重拉） | 可逆 |
| 2 | 删 `akshare-service/__pycache__`（12K） | 零 | 自动再生 |
| 3 | 清理 `server/data/fxbaogao-pdfs`（270M，130 文件） | 零（可由 `pdf_url` 重下） | 可逆 |
| 4 | 删 `server/src/news-sources.js` | 零（0 引用） | 可逆（git） |
| 5 | 删 `stock-service.ts` `writeTempFile` | 零（0 调用） | 可逆（git） |
| 6 | **从 SCHEMA 移除 `research_items` + `portfolio_snapshots`**（db.js:72-100 及索引 86/100），并加迁移删表 | **零（两表均 0 行）** | 可逆（重加 SCHEMA） |
| 7 | 下线 `fxbaogao_reports.source_range`（db.js:184/1217/1222） | 零（无读取方） | 可逆 |
| 8 | 补索引 `research_reports(broker)`、`portfolio_plans(updated_at)` | 零 | 可逆 |
| 9 | （可选）物化 `fxbaogao_reports.is_foreign` 替代 `org_name LIKE '%…%'` | 低 | 需验证 |

> ✅ **执行状态（2026-09-15 17:10，提交 `74b13f0`）**：步骤 1/2/3/4/5/6/7 均已执行完毕。
> - 远端 Turso：`DROP TABLE research_items`、`DROP TABLE portfolio_snapshots`、
>   `ALTER TABLE fxbaogao_reports DROP COLUMN source_range`（执行前带「行数必须为 0」安全闸复核）。
> - 结果：表 14 → **12 张**，`fxbaogao_reports` 16 → **15 列**，回收磁盘约 **292MB**。
> - 功能验证：后端以新代码重启后 `SQL_PARSE_ERROR` 归零；`/api/health`、`/api/news`、`/api/holdings`、
>   `/api/research/fxbaogao/summary` 全部 200；数据持续增长（`news_items` 4433→4909、
>   `fxbaogao_reports` 12980→13025）；spool 积压 333→274（重放正常）；测试 80/80 通过。
> - 步骤 8（补索引）、9（物化 `is_foreign`）仍为**建议项，未执行**。

### 8.4 备份现状
- `turso_pull.sqlite3`（30M）= 远端镜像，**已 gitignore，未入库** ✅
- `.bak`（22M）= 陈旧手工快照 → **过期备份，可删**
- **缺失**：远端 Turso 无任何自动化备份/时间点恢复策略 → 建议加定时 `scripts/pull_turso.py` 快照 + 保留 N 份轮转。

---

## 9. 可维护性 / 可拓展性 / 代码拆分（Q9）

### 9.1 现有优点（应保留）
- `providers/` 已做数据源抽象层 ✅
- `write-guard.js` spool + 重试，写路径有韧性 ✅
- `db.js` SCHEMA 为单一事实来源 + 4 个幂等 `ALTER TABLE` 迁移（只增不删）✅
- SQL 全参数化 ✅

### 9.2 需改进
| 问题 | 改进 |
|---|---|
| `index.js` 1634 行 / `db.js` 1799 行 单体 | 按域拆路由 + 仓储（见 5.1） |
| 无配置校验 | 启动时用 zod 校验 env，**缺失关键项即 fail-fast**（当前无鉴权只 warn 就是教训） |
| 无健康检查 | 加 `/healthz`（存活）/`/readyz`（Turso 连通 + spool 积压） |
| 无优雅关闭 | 加 `SIGTERM` 处理：停定时器 → 排空队列 → 关 HTTP |
| 前端 5 页各自造轮子 | 统一 `request`/`useAsync`/`useCache`（见 5.2） |
| 测试仅 1 个套件 37 例 | 见第 11 节 |

### 9.3 三端（手机/网页/App）快速加载
1. **路由级代码分包**：uni-app 分包加载（小程序主包 2MB 限制），`research`/`portfolio`/`fundflow` 拆子包。
2. **组件级懒加载**：大页面内子组件用异步组件。
3. **数据层**：`useCache` + `prefetchAll()`（5.4/5.5），首屏只取首屏数据。
4. **算法层**：`pyramid.ts` 721 行可拆为 `atr.ts` / `plan.ts` / `fees.ts`，配合分包按需加载。
5. **构建层**：`dist/` 已 412K；建议开 gzip/brotli + CDN，小程序端开启「按需注入」和「用时注入」。

---

## 10. 后端架构设计方案（Q10）

### 10.1 现状诊断
单进程 Express 单体（:9999）同步直连 Turso，进程内 `setTimeout` 自调度（新闻 30s、同步 15min），内存缓存 + 文件 spool，无队列、无鉴权、无健康检查、无优雅关闭，egress 强依赖代理（Clash 7897，历史上多次"挂死"）。

**核心风险**：① 计算与调度耦合在 API 进程 —— 定时任务挂起会拖死整个 API；② 无鉴权；③ 无队列 —— 失败即依赖 spool 文件，无法跨进程恢复；④ 单点 —— 无 supervisor（launchd 尚未启用）。

### 10.2 目标架构（分层 + 进程分离）

```
                       ┌──────────────────────────────┐
   客户端(H5/小程序/App) │  CDN / 静态资源 (分包 + gzip) │
                       └──────────────┬───────────────┘
                                      │ HTTPS
                       ┌──────────────▼───────────────┐
                       │   BFF / API 层 (Express)      │
                       │  · 鉴权(API_KEY/JWT) 必启      │
                       │  · 限流 / CORS 白名单 fail-close│
                       │  · zod 入参校验                │
                       │  · /healthz /readyz           │
                       └──────────────┬───────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
   ┌──────────▼─────────┐  ┌──────────▼─────────┐  ┌──────────▼─────────┐
   │  Service 层         │  │  Job/Worker 层      │  │  Cache 层           │
   │  news/portfolio/    │  │  (独立进程, 可重启)  │  │  LRU + TTL          │
   │  research/fundflow  │  │  · 队列(BullMQ/     │  │  stale-while-       │
   │  · 纯业务, 可单测   │  │    DB-backed)       │  │  revalidate         │
   └──────────┬─────────┘  │  · 分布式锁防重入    │  │  · 后台预热         │
              │            │  · 每任务硬超时+退避 │  └──────────┬─────────┘
              │            └──────────┬───────────┘             │
              │                       │                        │
   ┌──────────▼───────────────────────▼────────────────────────▼─────────┐
   │  Data Access 层 (Repository)                                          │
   │  · 统一 libSQL client（代理注入/turso-fetch.js）                       │
   │  · Outbox/Spool：写失败落盘 → 后台重放（幂等）                         │
   │  · 读写分离：读走缓存 + 硬超时；写走 batch + 重试                      │
   └──────────────────────────────┬───────────────────────────────────────┘
                                  │
   ┌──────────────────────────────▼───────────────────────────────────────┐
   │  External Providers（抽象层，已有 providers/）                          │
   │  akshare(8800) / eastmoney / telegram-rss / sina / fxbaogao / LLM      │
   │  · 统一: 超时 + 重试退避 + 熔断 + 降级 + 指标                          │
   └───────────────────────────────────────────────────────────────────────┘
                                  │
                          ┌───────▼────────┐
                          │  Turso (libSQL) │
                          └────────────────┘
```

### 10.3 关键设计点（针对已暴露的真实故障）

**① 进程分离（解决 H1「定时挂死拖死 API」）**
API 进程**只做请求处理**；所有定时任务搬进独立 `worker` 进程（可用 BullMQ + Redis，或轻量 DB-backed 队列）。Worker 崩溃不影响 API；API 重启不影响采集。

**② 每个任务硬超时 + 自愈续排**
```js
await withTimeout(runJob('news'), 60_000, { onTimeout: 'abort+reschedule' })
```
任何任务超时即中止并**照常 re-arm 下一次**，杜绝"定时器静默死亡"。所有外部 fetch 强制 `AbortSignal.timeout(15_000)`。

**③ 分布式锁 / 单飞**
用 DB 表或 Redis 锁 `job:<name>`，手动刷新与定时刷新互斥（修 M1）。

**④ Outbox 模式（升级现有 spool）**
写失败 → 落 outbox 表（而非散落 `.jsonl`）→ worker 带退避重放 + 幂等键 + 死信告警。

**⑤ 缓存与预热**
`stale-while-revalidate`：命中即返回旧值并后台刷新；`prefetchAll()` 在启动/空闲预热各模块。

**⑥ 韧性（针对 Turso 走代理的不稳定）**
统一 `turso-fetch.js` 代理注入；读路径硬超时+重试+缓存降级；写路径 batch+重试+outbox；`/readyz` 暴露 Turso 连通性与 spool 积压。

**⑦ 可观测性**
结构化日志（pino）+ `reportError`/`reportEvent`/`reportTiming`（对应 Q4）+ `/healthz` `/readyz`。

**⑧ 安全基线**
`API_KEY` 必填（生产缺失即启动失败）、CORS 白名单 fail-closed、zod 入参校验、全局限流、密钥走环境变量/密钥管理、**轮换已硬编码的 3 个密钥**。

**⑨ 部署与自愈**
`launchd`（macOS）/ systemd（Linux）/ PM2 托管 + `Restart=on-failure`；配置 `--max-old-space-size`；优雅关闭（SIGTERM → 停调度 → 排空 → 关连接）。

### 10.4 落地路线（建议分 4 期）
| 期 | 内容 | 风险 |
|---|---|---|
| **P0（立即）** | 配 `API_KEY` + 生产 fail-fast；轮换 3 个硬编码密钥；`refreshAll` 硬超时 + macro/llm 加 AbortSignal；补 `firstShow` 守卫 | 低 |
| **P1（1~2 周）** | 统一 `request`/`useAsync`/`useCache`；拆 `index.js` 路由 + `db.js` 仓储；补埋点；补索引 | 中 |
| **P2（2~4 周）** | 引入 worker 进程 + 队列 + 分布式锁；outbox 替代 spool；provider 熔断降级；优雅关闭 + healthz | 中 |
| **P3（按需）** | 前端分包/懒加载；`pyramid.ts` 算法分包；fxbaogao 物化 `is_foreign` | 低 |

---

## 11. 对抗性测试（Q：全量对抗性测试）

### 11.1 现状
`jest.config.js` + **唯一测试套件** `src/utils/pyramid.test.ts`（290 行，**37 例全通过**）。覆盖率严重不足：后端 9,194 行、前端 7,457 行**几乎无自动化覆盖**。

### 11.2 `pyramid.test.ts` 已识别的边界缺口（对抗性用例应补）
| 缺口 | 预期行为 | 现状 |
|---|---|---|
| `computePlan` `p0 <= 0` / `capital <= 0` | 应返回 `too_expensive` 而非崩溃 | 未覆盖 |
| `atr = null` / `atr = 0` | `null/p0` 静默得 0，低估风险 | 未覆盖 |
| `breakevenAmount` `denomFull <= 0` | 返回 `Infinity` | 未覆盖 |
| `computeAtr14` 输入 `NaN` / 缺 `high`/`low` | pyramid.ts:323-327 **无守卫** → NaN 扩散 | 未覆盖 |
| `computeAtr14` 缺 `prev_close` | TR=0 失真（部分数据源无此字段） | 未覆盖 |
| `tpList[0] < lastStop`「止盈空间不足」 | 应给提示 | 未覆盖 |
| `validateFeeRate(NaN)` | 应拒绝 | 未覆盖 |

### 11.3 建议补充的测试层次
1. **算法层**（已有 37 例 → 补齐上表 + 属性测试：随机输入不产生 NaN/Infinity）
2. **API 层**：用 supertest 对 Express 起测试实例，覆盖鉴权（无 key 应 401）、入参校验（超长/畸形 body 应 400）、限流
3. **数据层**：对 `db.js` 用临时 SQLite 跑 CRUD + 批量写部分失败的兜底
4. **契约层**：前端 `api/*.ts` 与后端路由的一致性检查（防止"路由改了前端没改"）
5. **混沌**：注入 Turso 超时/代理失效，验证 spool 重放与降级不丢写

---

## 12. 同步状态与后续

- **GitHub**：审计开始时 `main` = `origin/main` = `e75eeb2`，**ahead=0 / behind=0**（本地无领先提交）。
- **Turso**：本地镜像 `turso_pull.sqlite3` 已于 2026-09-15 15:45 全量刷新至与远端一致（14 张表行数逐一比对通过，`fxbaogao_reports` 12,980）。
- **本次修复与测试完成后**，将产生新的本地提交并推送 `origin/main`；远端 schema/数据变更（Q8 步骤 6/7）需你确认后再执行。

---

## 13. 审计后新发现并修复：libSQL `execute({sql})` 缺 `args` 导致语句静默失败

**现象**：启动日志 `cleanupStaleAnnouncements: Cannot convert undefined or null to object`。

**根因**：`@libsql/client` 内部 `stmtToHrana`（`hrana.js:249`）对 `stmt.args` 执行 `Object.entries()`。
以**对象形式**调用 `client.execute({ sql })` 却未提供 `args` 时，`args` 为 `undefined` → 抛 `TypeError`。
字符串形式 `client.execute(sql)` 不受影响（内部会补 `args: []`）。

**危害远超日志噪音** —— 全仓扫描 24 个文件共 **6 处**，且全部被 `try/catch` 静默吞掉：

| 位置 | 函数 | 后果 |
|---|---|---|
| db.js:584 | `migrateHoldingsColumns` | 持仓表补列（current_price/pnl/pnl_pct）**从未执行** |
| db.js:600 | `migratePlansColumns` | 计划表补列（last_price/last_price_at）**从未执行** |
| db.js:611 | `migrateNewsContent` | 新闻表补 content 列 **从未执行** |
| db.js:618 | `migrateNewsContent` | content 空值回填 summary **从未执行** |
| db.js:1760/1761 | `cleanupStaleAnnouncements` | 清理脏公告的两条 DELETE **从未执行** |

即：**旧库若缺列，永远补不上**；脏公告永远清不掉。属于"被 catch 吞掉的真实功能失效"。

**修复**：6 处一律补 `args: []`，并在原处加注释固化该坑；错误日志截断由 80 放宽到 200 字符。

**验证**：重启后日志由 `skipped` → `done`；`SQL_PARSE_ERROR` 0、`Cannot convert` 0；
三张表列完整无缺失；`news_items` 4909→4451（清理函数首次生效，删除 458 条旧版脏公告行，属预期）；测试 80/80。

**防范建议（已实施，见下节）**：① 统一封装 `exec(sql, args = [])` 包装器，禁止直接写 `execute({sql})`；
② 迁移类 `catch` 不应无条件静默，至少 `console.warn` 出 `e.message`，避免同类问题再次隐身。

---

## 14. 落地：统一 `exec()` 包装器 + CI 强制校验（同日追加）

**`exec(sql, args = [])`**（`db.js`）：全仓 64 处 `client.execute(...)` 已全部改为 `exec(...)`。
包装器同时接受 `exec(sql)`、`exec(sql, args)`、`exec({sql, args})`、`exec({sql})` 四种写法，
**且对「漏传 args」天然免疫**（兜底 `[]`），使上述 bug 从结构上不可能再现。

**强制约束**：项目无 ESLint，故新增 `server/scripts/check-no-raw-execute.mjs`，
扫描 `server/src` 内的裸 `.execute(`，仅允许 `db.js` 中包装器自身那一次；
已挂到 `npm run check:db`，可接入 CI。
经反向验证：注入一处裸调用即被拦截并 `exit 1`（干净时 `exit 0`）。

**迁移 catch 不再无条件静默**：`migrateHoldingsColumns` / `migratePlansColumns` /
`migrateNewsContent` 现区分「duplicate column（幂等成功，静默）」与「其他错误（warn 出 message）」；
`execRetry` 也改为复用 `exec(sql, args)`。

**回归验证**：6 个接口全绿；`SQL_PARSE_ERROR`/`Cannot convert`/`TypeError` 均 0；
`cleanup: done`；spool 持续下降（333→214）；`news_items` 4451→4712 证明写入正常；测试 80/80。

---

## 15. 落地：spool 目录定位错误修复 —— `%20` 幽灵目录（同日追加）

**现象**：健康检查 `news_write_spool.pending` 长期停在 214 条 / 6.5MB，
但项目内 `server/.spool/` 根本不存在该文件。

**根因**：`write-guard.js` 用 `path.dirname(new URL(import.meta.url).pathname)` 求目录。
`import.meta.url` 是已百分号编码的 file URL，`.pathname` 会原样保留 `%20`，
于是 `fs.mkdirSync(dir, { recursive: true })` 在本机真实目录之外
**另建了一张字面量带 `%20` 的幽灵目录树**：

```
~/Library/Application%20Support/TRAE%20SOLO%20CN/ModularData/ai-agent/
  work-mode-projects/6a92a62cb233b16022eba6b2/server/.spool/news-write-pending.jsonl
```

**危害**（隐蔽但实质性）：
1. 「写失败不丢数据」这条兜底实际落在开发者看不见、也不会去检查的位置，
   一旦需要人工干预补写（spool 超 500 行上限会丢最旧记录）根本无从下手；
2. 污染用户 `~/Library` 目录（6.5MB 且持续增长）；
3. 路径依赖：部署到无空格路径（Linux 容器）时表现正常，本地开发反而是坏的，
   属于「只在开发机复现」的典型坑，难以通过线上现象定位。

**修复**：改用 `node:url` 的 `fileURLToPath`（与 `index.js` / `fxbaogao.ts` 已有写法统一）。
全仓复扫确认仅此一处，其余 4 处 `import.meta.url` 均已是正确写法。

**数据保全**：先把 214 条积压批次 `cp` 到 `server/.spool/`，
md5 校验一致（`1203b495…`，214 行）后才删除源文件，再用 `rmdir -p`
逐级清理空目录（`rmdir` 遇非空自动停止，同级的 discord 数据未被触碰）。

**验证**：重启后 `pending` 从 214 自动降到 184（启动即成功补写 30 批），
证明新路径读写均正常；9 个接口全 200；幽灵目录未再生；
`check:db` 通过、jest 80/80。已推送 `6c948c1`。

---

## 16. 落地：前端统一 request() 层 + useCache 缓存 + 启动预取（Q5）

**问题**：三套请求写法并存——`api/market.ts`/`fundflow.ts` 裸 `fetch`、
`api/portfolio.ts` 自带 `jget()`、`pages/news` 裸 `uni.request`。
其中**裸 fetch 是跨端真 bug**：微信小程序端没有 `fetch`，行情页与资金流页在微信端直接不可用。

**新增 `src/utils/`**：
| 文件 | 职责 |
|---|---|
| `request.ts` | 统一走 `uni.request`（三端通用）：URL 拼接、超时（默认 15s）、重试、HTTP 状态校验、错误归一化 |
| `useCache.ts` | TTL 缓存 + 单飞去重 + 容量上限 200（防内存无界增长）+ 前缀失效 + 预取 |
| `cacheConfig.ts` | 缓存键/TTL 单一来源（避免 `api ↔ prefetch` 循环依赖） |
| `prefetch.ts` | App 启动静默预热只读接口 |

**重试策略**：`GET` 默认重试 1 次（幂等），写操作默认 0（避免重复提交）；
只有「网络失败 / 超时 / 5xx」才重试，4xx 不重试（重试也不会变对）；
错误优先透传服务端 `error` 字段，而不是干巴巴的 `HTTP 500`。

**改造**：`api/portfolio.ts` 47 处 `jget()` 整体改名 `request()`（参数语义不变，零逻辑改动）；
持仓/角色字典接入缓存，写操作后 `invalidate()` 防脏读。

**顺带修**：`src/utils/env.ts` 有 11 个已入库的 `U+FFFD` 乱码字节，一并修掉；
`jest.config.js` 补 `@/` 别名映射（否则测试无法 import 项目内模块）。

**测试**：新增 33 条（request 15 + useCache 18），含对抗性场景——
非法 JSON、4xx 不重试、写操作不重试、失败不写缓存（否则永远卡在失败的 Promise 上）、
容量淘汰、非 uni 环境兜底。全量 **113/113**，`vue-tsc` **0 错误**。

---

## 17. 落地：3 个索引 + 物化 `fxbaogao_reports.is_foreign`（Q8）

**索引**（均已确认有实际查询支撑）：
- `research_reports(broker, created_at DESC)` —— 一鱼两吃：既服务
  `WHERE broker=? ORDER BY created_at DESC`，又是 `countResearchReportsGrouped`
  的覆盖索引，可**避免回表读取体积巨大的 `raw_text` 全文列**。
- `portfolio_plans(updated_at DESC)` —— `listPlans()` 固定该排序。
- `fxbaogao_reports(is_foreign, ai_status)`。

**`is_foreign` 物化**：此前「是否外资」在查询期用 **39 个 `org_name LIKE` 拼 OR** 判定：
无法走索引、每次全表扫 + 逐行 39 次字符串匹配；同一表达式在 `ORDER BY` 里出现两次，
每次查询要多传 **78 个绑定参数**；排序表达式只能 filesort。现改为写入时算一次存列，
三处查询直接用该列。实测回填 **1940 / 13056** 条。

**⚠️ 踩坑记录（值得记住）**：`CREATE INDEX ... ON fxbaogao_reports(is_foreign, ...)`
**不能写进 SCHEMA**。SCHEMA 先于迁移执行，存量库当时还没有这列，
会报 `no such column` 被 `initDb` 的 catch 静默吞掉——**结果是索引在存量库上永远建不上**，
只有新库才有。正确做法是在迁移里加列之后再建索引。
（这印证了 §14「迁移类 catch 别无条件静默」的必要性：静默让问题又隐身了一次。）
