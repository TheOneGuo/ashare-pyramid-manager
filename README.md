# 节节高 · A 股正金字塔仓位管理器

> uni-app 三端一体（微信小程序 + Android + iOS）的 A 股仓位管理工具，基于正金字塔加仓算法 + ATR 自适应止损。

## 三 Tab 功能

1. **新闻** —— 财经快讯，30s 自动刷新（已接入 Turso 远程数据库 + Yahoo/BBC 真实 RSS 源）
2. **研报** —— AI 研报解读（开发中）
3. **持仓** —— AI 持仓分析（金字塔算法已移植到 TS，37/37 单测通过）

## 后端

`server/` —— Node.js + Express + libSQL/Turso

```bash
cd server
export TURSO_DATABASE_URL="libsql://your-db.turso.io"
export TURSO_AUTH_TOKEN="eyJ..."
export NEWS_SOURCE_MODE=real
node src/index.js
# → http://localhost:9999/api/news
# → http://localhost:9999/preview/  (多端预览)
```

### API

| 路径 | 说明 |
|---|---|
| `/api/health` | 健康检查（返回 db mode） |
| `/api/news?limit=30&since=ts` | 财经新闻（30s 轮询） |
| `/preview/` | 多端响应式预览页（iOS/Android/折叠屏/微信小程序） |

### 已对接 Turso 远程 DB

- DB 名：`ashare-pyramid-server`（TheOneGuo/aws-ap-northeast-1）
- 表：`news_items`, `research_items`, `portfolio_snapshots`
- 真实模式已抓取 40+ 条 Yahoo Finance + BBC Business 写入远程

## 多端预览

`preview/index.html` —— 同一台机器上看 24 个设备的实时预览：

- iOS（4 款 iPhone 直板机）
- Android（6 个品牌 × 2-3 款热销直板机）
- Android 折叠屏（华为 Mate X5 / 小米 MIX Fold 3 / OPPO Find N3 / vivo X Fold3 / 荣耀 Magic V2/Vs3）
- 微信小程序（9 款机型 + 完整微信外壳：状态栏+胶囊+导航栏+49px tabbar）

**单选设备 + 横竖屏下拉 + 分辨率下拉**（微信小程序无横竖屏切换）。预览页指向 `http://localhost:9000/` 的 uni-app H5 dev server。

## 算法核心

`src/utils/pyramid.ts` —— Python `pyramid_atr_engine.py` 完整 544 行移植版：

- 4 档加仓（4:3:2:1 手数比，几何间隔加仓）
- ATR 自适应止损 5%-8%
- 加仓间隔：主板 10%-12% / 20% 板上浮 15%-20%
- 四档止盈 158%-192%
- A 股完整费率（佣金 + 过户费 + 卖出印花税 + 最低 5 元佣金分段求解）
- 板块涨跌停限制（主板 ±10%、创业/科创 ±20%、北交所 ±30%、ST ±5%）
- 科创板 200 股一手
- 单标的资金分配上沿 = 可分配余额，下沿 = 0
- 投入率 92%、封顶 94%、剩余 6%-10% 区间目标

37/37 单测通过（`npm test`）。

## 跑通方式

```bash
npm install
npm run dev:h5              # → http://localhost:9000/  H5 dev
npm run dev:mp-weixin       # → 微信小程序开发工具打开 dist/dev/mp-weixin
npm run test                # 跑算法单测
npm run type-check          # TypeScript 类型检查
```

## 关键约束

- uni-app Vue 3 一码三端
- **akshare 等第三方库仅作开发参考，不可商用**
- **Turso / GitHub token 禁止 commit / 截图 / 写入 .env 入仓**
- AI 解读功能仅做信息聚合，不构成投资建议
- 算法核心版权归原项目 `ashare-heatmap-horizon-platform` 致谢

## 原项目源码定位

`C:\Users\TheOne\WorkBuddy\2026-06-13-12-43-21\ashare-heatmap-horizon-platform\heatmap_app\`

- `pyramid_atr_engine.py` 544 行 → 移植为 `src/utils/pyramid.ts`
- `position_strategy.py` → 持仓分析编排
- `telegram_news.py` → 新闻采集（思路）
- `report_parser.py` + `research_task_runner.py` → 研报 30s 轮询任务
- `collectors/` 数据源采集整套