# 资金流向（资金动态）· 增量 PRD

**项目**：ashare-pyramid-manager（A 股正金字塔仓位管理器 · 节节高）
**作者**：software-product-manager（许清楚）
**接收方**：team-lead → 架构师 / 工程师 / QA
**基线版本**：远端 `a69fc43`（2026-09-01 同步，fe(fxbaogao+ui) 折叠屏双栏与设计还原）；本地 HEAD `87b976c`
**范围**：仅 H5 第 4 个 tab 替换为「资金动态」；微信小程序 / Android / iOS 本期不在范围
**文档版本**：**v1.1**  ·  2026-09-01

---

## 修订记录

| 版本 | 日期 | 变更摘要 | 影响范围 |
|------|------|----------|----------|
| v1.0 | 2026-09-01 | 初版。定义 4 类资金（共同增仓/公募基金/超级平准/超级外资）、Sankey 桑基图、板块增仓榜、股票中意榜；含「合伙人解锁」付费占位体系与「关闭动情」色彩开关；设计 token 沿用深蓝 #0D1B2A 体系。 | 全文档 |
| **v1.1** | **2026-09-01** | **1) 设计规范改版**：主背景由深蓝 `#0D1B2A` → 墨黑 `#0b0b0d`；项目自有色统一用 `$app-*`（`$uni-*` 仅为 uni-app 插件兼容保留）；涨跌色固定 `$app-up #FF4D4F` / `$app-down #00B578`；排版圆角间距改用 `$radius-*` / `$spacing-*`；新增 `@mixin fold-wide`（700–1400px）折叠屏双栏规范。<br>**2) 删除全部合伙人功能**：Sankey 左列「合伙人解锁 ⭐」节点、Sankey 下紫色 CTA、榜单 rank 1 锁定卡、注脚文案、`PartnerModal.vue`、`$fund-partner` 紫变量、schema `locked` 字段、相关验收项——**一处不留**。<br>**3) 内容全部开放**：榜单每组 3 个名次**全部展示真实数据**（板块名 / 个股名+代码+占比），无任何锁定占位；保留「查看更多」「全部榜单 >>」入口。<br>**4) 删除「关闭动效」开关**：紫色 toggle 整体砍掉，schema `muted` 字段删除，不再有 grayscale / brightness 降饱和。<br>**5) 底部「机会大师」广告 banner**：v1.1 曾判定保留占位；**v1.2 已改判删除**（见下）。 | §1.3 / §1.4 / §2 / §3 / §4.4 / §4.7 / **§5 全章重写** / §6 / §7 / §8 / §9 / §10 / §11 |
| **v1.2** | **2026-09-01** | **主理人拍板：《机会大师》属外部产品推广，与本项目无关，删除**。底部两处推广元素一并移除：①「还有其他想法?」紫色渐变 CTA（含"去《机会大师》火火看看"导流文案）②「机会大师」广告 banner。`BottomCta.vue` 从文件清单删除；相关验收项改为负向校验（页面无任何机会大师推广元素）；页面最后内容块 = 股票中意榜。详见 §3.1 / §5.6 / §6.5 / §8.1 / §9.2 / §10 / §11.1。 | §2(US-8) / §3.1 / §5.6 / §6.5 / §7.3 / §8 / §8.1 / §9.2 / §10 / §11.1 |

> **v1.1 全文自查声明**：已确认无「合伙人」「locked」「关闭动[情/效]」「grayscale」「brightness」「#7B61FF」字样残留（本节修订记录中的说明性引用除外）。

---

## 1. 背景 & 目标

### 1.1 现状
- 当前 H5 的第 4 个 tab 为「行情」（`pages/market/index.vue`），主要展示 K 线 / 北向 / 龙虎榜 / F10，定位是单股深度查询工具。
- 已有的 4 个 tab：新闻 / 研报 / 持仓 / **行情**。

### 1.2 替换目标
将 H5 第 4 个 tab 从「行情」改为「**资金动态**」（页面导航标题"资金动态"），提供**结构化的主力资金 / 政策资金 / 公募 / 外资四类资金对板块和个股的增仓画像**。这是从"单股查询工具"升级到"市场资金面雷达"的关键一步。

### 1.3 产品价值
1. **直接服务正金字塔策略**：增仓比例是金字塔加仓最重要的择时信号之一——主理人的 `pyramid_atr_engine.ts` 已经考虑了首笔价、加仓间距，但没有接入"哪些板块/股票正在被主力加仓"这一前置信号。本 tab 是金字塔决策链的上游。
2. **替代散落工具**：用户原本需要切到同花顺 / 东方财富的资金流向页查 4 个分类数据，现在在一个 tab 内一屏看完。
3. **信息完整开放**：榜单 Top 3 **全部展示真实数据**，用户一次看全，不设任何锁定门槛，最大化决策效率与体验完整性。
4. **承接折叠屏新形态**：复用上游 `a69fc43` 已落地的 `fold-wide` 双栏能力，在 700–1400px 折叠屏/平板上左右分栏展示，直板机保持单栏零改动。

### 1.4 非目标（不在本期做）
- 个股深度详情页跳转（点击「查看更多」仅 toast 占位）
- 跨端同步（先 H5）
- 后端爬虫 / 真实数据采集（v1 mock）
- 任何付费 / 会员 / 权限门槛功能

---

## 2. 用户故事

> 格式：Given（前置条件） / When（动作） / Then（结果）

### US-1 主理人快速看板块资金面
> **Given** 主理人打开 H5 进入第 4 个 tab「资金动态」，
> **When** 默认显示"共同增仓"分类，
> **Then** 顶部 hero 卡片显示「资金增仓比例 / 资金主力&准主力」标题、4 类资金子 tab（默认"共同增仓"高亮）、日期 banner；中段呈现一张桑基图——左列 4 类资金节点 → 右列 3-4 个板块节点，彩带宽度≈资金强度。

### US-2 切换资金类型
> **Given** 主理人在子 tab 区域点击「公募基金」，
> **When** 子 tab 切换动画结束，
> **Then** 整页数据（Sankey + 板块榜 + 股票榜）刷新为公募基金的近 1 日 / 近 5 日增仓视图；URL query `?type=public_fund` 同步；刷新按钮回到 idle 态。

### US-3 看板块增仓榜 Top 3（全开放）
> **Given** 主理人在任意资金分类下浏览到"板块增仓榜 (近 5 日)"区块，
> **When** 进入视区，
> **Then** 显示 3 大组（公募 💧 / 超级平准 🌊 / 超级外资 🔥），每组一行 3 列（rank 1/2/3）；**3 个名次全部为真实数据**——每个卡片显示板块名 + 下方"增仓比例 +X.XXX%"灰色小字 + 右侧"查看更多"。

### US-4 看股票中意榜 Top 3（全开放）
> **Given** 主理人在「股票中意榜 (近 5 日)」区块，
> **When** 滚动到此区块，
> **Then** 与板块榜同结构，**3 个名次全部为真实数据**，每个卡片显示「板块名 / 代码 / +占比%」三行 + 右侧"查看更多"。

### US-5 点击「更多」tab
> **Given** 主理人在子 tab 行点击「更多」，
> **When** 触发点击，
> **Then** 弹出 toast「即将开放」，1.5s 后自动消失；当前选中的资金类型不变。

### US-6 加载 / 错误态
> **Given** 主理人在弱网或接口异常时进入页面，
> **When** 接口超时（>5s）或返回 5xx，
> **Then** 显示错误卡：「加载失败 · 点击重试」+ 重新加载按钮；空数据时显示「暂无数据 · 请稍后再来」。

### US-7 刷新数据
> **Given** 主理人在资金动态页，
> **When** 下拉页面 / 点击 hero 右侧 🔍 旁的小刷新按钮，
> **Then** 整页重新拉取数据，刷新按钮旋转 360° 完成；期间子 tab 不可切换（避免请求竞态）。

### US-8 折叠屏双栏（v1.1 新增）
> **Given** 主理人在折叠屏展开态（视口宽 700–1400px）打开资金动态页，
> **When** 页面渲染完成，
> **Then** 布局切换为左右双栏——左栏承载 Hero + 子 tab + 日期 banner + Sankey + Sankey CTA，右栏承载板块增仓榜 + 股票中意榜；直板机（<700px）仍为单栏纵向堆叠，UI 零改动。（v1.2 注：底部推广 CTA/banner 已删，无跨栏元素）

---

## 3. 范围

### 3.1 In-scope（v1.1 必做）

| # | 功能 | 备注 |
|---|------|------|
| 1 | H5 第 4 个 tab 从「行情」→「资金动态」 | `pages.json` tabBar 替换；`pages/market` 路由保留注册但移出 tabBar |
| 2 | 4 类资金子 tab + "更多" 占位 | 4 个固定 tab + 1 个 more placeholder（toast「即将开放」） |
| 3 | 顶部 hero 卡：标题 + 副标 + 🔍 | 固定文案 |
| 4 | 日期 banner：「以下流动为资金的【近1日】增仓比例 (更新时间: 08-31)」 | 时间格式 `MM-DD`，最近交易日 |
| 5 | Sankey 桑基图区块（4 资金 → 3-4 板块） | 彩带宽度=资金强度，颜色=资金类型；**左列仅 4 个真实资金节点** |
| 6 | Sankey 下 CTA：「以上板块/股票资金面有明显加仓的」+ 「查看完整名单」链接 | 仅文字+链接，**无按钮** |
| 7 | 板块增仓榜 (近 5 日)：3 组 × 3 列 | **3 个名次全为真实数据**（板块名 + 增仓比例 + 查看更多） |
| 8 | 股票中意榜 (近 5 日)：3 组 × 3 列 | **3 个名次全为真实数据**（板块名 / 代码 / 占比 + 查看更多） |
| 9 | 加载态 / 空态 / 错误态 | 复用现有 `mk-empty` / `mk-err` 模式 |
| 10 | 下拉刷新 | 复用 `enablePullDownRefresh: true` |
| 11 | 「查看更多」/「全部榜单 >>」入口 | toast「即将开放」占位 |
| 12 | **折叠屏 / 平板双栏布局**（`fold-wide` 700–1400px） | v1.1 新增，见 §5.6 |

> **v1.2 变更**：原 #9「底部'还有其他想法?'紫色渐变 CTA」与 #10「底部'机会大师'广告 banner」——两者均属《机会大师》外部产品推广导流，**主理人拍板：一并删除，不做**（见 §8.1）。

### 3.2 Out-of-scope（本期不做）

- **任何付费 / 会员 / 合伙人 / 权限门槛功能**（v1.1 已整体移除）
- 个股深度详情页（点「查看更多」仅 toast 占位）
- 微信小程序 / Android / iOS 三端适配（仅 H5）
- 真实后端爬虫 / 4 类资金的实时数据接入（v1 mock，详见 §4）
- 跨子 tab 的拖拽排序 / 自定义配置
- 国际化（i18n）
- 暗色 / 亮色主题切换（项目本身已是深色，不再做亮色）
- AI 解读 / LLM 总结
- 桌面端（>1400px）专项布局（v1 用 max-width 容器居中兜底）

---

## 4. 数据需求（关键）

### 4.1 数据真实性原则（硬性约束，v1.1 不变）
> **用户硬性要求**：v1 所有展示数据必须真实可信；如评估后确认没有合规的免费实时接口，必须明确标注 v1 为 mock，并提供 mock 数据生成策略保证截图稳定。**不允许编造数据但 UI 标注为"实时"**。
>
> 具体落地：页面 banner 下方须显著标注「数据为示意 · v1 mock」灰色小字。

### 4.2 4 类资金的实际语义映射（产品 ↔ 公开接口）

| 产品标签 | 实际语义 | 最接近的公开免费接口 | 实时性 |
|----------|----------|---------------------|--------|
| **共同增仓** | 北向 + 主力资金 + 偏股基金的合集（产品聚合概念） | 无直接对应，需自定义聚合 | ❌ 无 |
| **公募基金** | 偏股公募基金近 1 周 / 近 1 月持仓变化 | 东方财富基金持仓变更（季度披露） | ⚠️ 滞后 15-90 天 |
| **超级平准** | 中央汇金 / 中国国新 / 中国诚通 ETF + 大股东增持 | 中央汇金 ETF 持仓 + 大股东增持公告 | ⚠️ 月度 / 公告驱动 |
| **超级外资** | 沪深港通北向资金 + QFII 净流入 | `stock_individual_fund_flow_rank`（大单/超大单代理） | ✅ 分钟级 |

**核实时间**：2026-09-01
**核实方式**：WebSearch "AKShare 资金流向 板块 增仓比例" / "超级平准 A股 资金 流向 板块"
**核实结论**：
- AKShare `stock_sector_fund_flow_rank` 只给"超大单/大单/中单/小单/主力" 5 档分类，对应产品标签需要二次聚合。
- "超级平准" 是产品侧对"类平准基金（中央汇金/国新/诚通）"的口语化称呼，没有免费公开实时 API。
- "公募基金" 持仓变更滞后严重（季报披露），不适合做"近 1 日增仓"。

### 4.3 决策：**v1 全量 MOCK**
理由：
1. 4 类资金的实时精确数据**无合规免费来源**；
2. 强行接 4 个付费 API 成本 > 产品价值（v1 仅 H5）；
3. 架构师应实现 `FUND_FLOW_MODE` 环境变量开关，默认 `mock`，预留 `eastmoney` / `partner` 两个未来接口位；
4. mock 数据 schema 与真实数据**字段 1:1 对齐**（见 §4.4），未来切换模式零前端改动。

### 4.4 数据 Schema（字段定义）

> **v1.1 变更**：已**删除** `SectorNode.locked` / `StockItem.locked`（不再有锁定态）与 `FundFlowResp.muted`（不再有色彩开关）。`rank` 字段保留（1/2/3），但 3 个名次均返回真实数据。

```typescript
// src/api/fundflow.ts（仅作字段定义参考，具体 TS 接口由架构师细化）

// 资金类型枚举
type FundType = 'joint' | 'public_fund' | 'stabilization' | 'foreign'
// joint = 共同增仓, public_fund = 公募基金,
// stabilization = 超级平准, foreign = 超级外资

// 单个板块节点
interface SectorNode {
  code: string           // 行业/概念代码（东财 BK0000 格式）
  name: string           // "民营企业" / "热泵" / "热门概念三"
  pct: number            // 近 1 日增仓比例 (%)，正负值
  pct5d?: number         // 近 5 日增仓比例 (%)，板块榜使用
  rank?: number          // 在榜内排名 1-3（3 个名次均为真实数据）
}

// 单个资金节点
interface FundNode {
  type: FundType
  name: string           // "公募基金"
  emoji: string          // 💧 / 🌊 / 🔥 / ⭐
  color: string          // 桑基图彩带颜色（取自 $fund-* 系列）
  totalPct: number       // 该类资金今日总增仓比例
}

// 桑基图连线（资金 → 板块）
interface SankeyEdge {
  fund: FundType
  sectorCode: string
  pct: number            // 彩带强度（宽度比例）
  direction: 'in' | 'out' // in=流入板块，out=流出
}

// 单只个股
interface StockItem {
  code: string           // 6 位代码
  name: string           // "MLCC"
  sector: string         // 所属板块名
  pct: number            // 占比 %
  rank: number           // 1-3（3 个名次均为真实数据）
}

// 主接口响应
interface FundFlowResp {
  ok: boolean
  source: 'mock' | 'eastmoney' | 'partner'
  asOf: string           // 更新时间 YYYY-MM-DD HH:mm
  activeType: FundType
  hero: {
    title: string        // "资金增仓比例"
    subtitle: string     // "资金主力&准主力"
  }
  funds: FundNode[]                    // 4 类资金
  sankey: { left: FundNode[]; right: SectorNode[]; edges: SankeyEdge[] }
  sectors: Record<FundType, SectorNode[]>  // 每个资金类型下 Top 3 板块（全真实数据）
  stocks:  Record<FundType, StockItem[]>   // 每个资金类型下 Top 3 个股（全真实数据）
  error?: string
}
```

### 4.5 Mock 数据生成策略

**目标**：截图稳定（同一日期同一资金类型 → 同一结果）+ 数值合理（看起来像真的）。

**算法**（架构师实现细节）：
- 固定种子 = `${YYYY-MM-DD}_${fundType}` → 用 `seedrandom` / 简单 mulberry32 生成
- **板块池**：从本地已存在的概念种子（参考 `server/src/research-report.ts` 已有的板块池）和 akshare 的真实行业列表各取 30 个，混合
- **个股池**：取已存在的 100 只真实股票（代码 + 名称 + 板块）作为种子，确保代码可识别
- **数值范围**：
  - 板块 pct：`-7.00% ~ +5.00%`（参考图 +1.50% / -2.84% / -6.59% 等数值）
  - 个股占比：`0.05% ~ 20.00%`（参考图 18.741% / 0.268% / 7.087%）
  - Sankey 彩带强度：`0 ~ 100`，按比例缩放成 px
- **每类资金返回 3 条完整记录**：`sectors[fundType].length === 3` 且 `stocks[fundType].length === 3`（v1.1 全开放，不再有占位缺口）
- **日期 banner**：取最近一个 A 股交易日（简单周末 + 节假日过滤即可），格式 `MM-DD`
- **每日 03:00 重生成**：cron 任务或 lazy 计算（首次请求时按"今日"生成）

### 4.6 预留真实数据接入点
后端架构师应预留：
- `server/src/providers/fund-collector.ts`（参考 `providers/akshare.ts`）
- `FUND_FLOW_MODE` 环境变量（`mock` / `eastmoney` / `partner`）
- 未来真实模式时，从以下源拼装：
  - `eastmoney` 模式：`stock_individual_fund_flow_rank`（个股）+ `stock_sector_fund_flow_rank`（板块） + `push2.eastmoney.com` 北向
  - `partner` 模式：付费 API（如恒生电子、Wind、Choice）

### 4.7 API 设计

```
GET /api/fundflow?type=joint|public_fund|stabilization|foreign&asOf=YYYY-MM-DD
→ FundFlowResp（见 §4.4）

GET /api/fundflow/health
→ { ok, mode, lastUpdate, cacheHitRate }
```

后端缓存策略：5 分钟 TTL（参考 `cache.ts` 已有实现）。

---

## 5. UI 设计规范（融入改版后体系）

> **v1.1 全章重写**。设计 token 已随上游 `a69fc43` 改版，以 `src/styles/theme.scss` 与 `src/styles/breakpoints.scss` 现行值为唯一事实来源。

### 5.0 Token 使用总原则
- **项目自有色统一使用 `$app-*`**（`src/styles/theme.scss`）。
- `src/uni.scss` 的 `$uni-*` 内置变量**仍在**，但仅为 uni-app 插件市场三方组件兼容保留；**新业务代码不得引用 `$uni-*` 取色**。
- 排版 / 圆角 / 间距统一使用 `$radius-*` / `$spacing-*` 系列。

### 5.1 颜色映射

| 用途 | 取值 | 变量 | 说明 |
|------|------|------|------|
| **页面主背景** | `#0b0b0d` | `$app-bg` | **墨黑**（v1.1 由深蓝改版） |
| 卡片背景 | `#152739` | `$app-card-bg` | |
| 主文字 | `#F5F5F7` | `$app-text` | |
| 灰色文字 | `#8A8A8E` | `$app-text-muted` | |
| 反色文字 / 深蓝块 | `#0D1B2A` | `$app-text-inverse` | ⚠️ 仅作文字/局部色块，**不再用作页面背景** |
| 金色强调（rank 编号、标题装饰） | `#D4AF37` | `$app-accent` | 主金 |
| 金色柔和态 | `rgba(212,175,55,0.35)` | `$app-accent-soft` | |
| 边框 | `rgba(212, 175, 55, 0.18)` | `$app-border` | |
| **红涨** | `#FF4D4F` | `$app-up` | A 股约定，占比 chip / 涨跌幅 |
| **绿跌** | `#00B578` | `$app-down` | A 股约定，占比 chip / 涨跌幅 |
| 警示 | `#F0AD4E` | `$app-warn` | |
| 错误 | `#DD524D` | `$app-error` | |

**4 类资金专属色**（新增，写入 `src/styles/theme.scss` 末尾）：

| 资金类型 | emoji | 色值 | 变量名 | 说明 |
|----------|-------|------|--------|------|
| 共同增仓 | 🔀 | `#D4AF37` | `$fund-joint` | 复用 `$app-accent` 值（聚合概念用品牌金） |
| 公募基金 | 💧 | `#F0AD4E` | `$fund-public` | 暖黄，复用 `$app-warn` 值 |
| 超级平准 | 🌊 | `#26D0CE` | `$fund-stab` | 青色，新增 |
| 超级外资 | 🔥 | `#FF7A45` | `$fund-foreign` | 橙红，新增 |

> ⚠️ **涨跌色 vs 资金色的区分（重要）**：`$app-up #FF4D4F`（红）与 `$fund-foreign #FF7A45`（橙红）视觉接近。
> **规则**：**涨跌幅 / 占比数值 chip 一律用 `$app-up` / `$app-down`**；**资金彩带、图标、组头仅用 `$fund-*`**。两者不得混用，避免用户把"外资资金色"误读为"上涨"。

### 5.2 排版 / 间距 / 圆角

| 元素 | 取值 | 变量 |
|------|------|------|
| 卡片圆角 | `$radius-lg` = 20rpx | `$radius-lg` |
| 小卡 / chip 圆角 | `$radius-sm` = 8rpx | `$radius-sm` |
| 按钮 / pill 圆角 | 999rpx | 局部常量 `$radius-pill: 999rpx`（本页新增局部变量） |
| 弹窗顶角圆角 | `$radius-xl` = 28rpx | `$radius-xl` |
| 区块间距 | `$spacing-lg` = 32rpx | `$spacing-lg` |
| 卡片内边距 | `$spacing-md` = 24rpx | `$spacing-md` |
| 元素内间距 | `$spacing-base` = 16rpx | `$spacing-base` |
| 紧密间距 | `$spacing-sm` = 8rpx | `$spacing-sm` |
| 标题字号 | 44rpx / 700 | 局部常量（与 portfolio `mk-title` 一致） |
| 副标字号 | `$uni-font-size-sm` = 24rpx | 尺寸类可继续用 `$uni-font-size-*` |
| 正文字号 | `$uni-font-size-base` = 28rpx | 同上 |
| 占比 chip 字号 | 22rpx | 局部常量 `.ff-chip` |

> 说明：`$uni-font-size-*` 属**尺寸**变量而非颜色变量，可继续引用；颜色类一律走 `$app-*` / `$fund-*`。

### 5.3 子 tab 组件

**模式参考**：
- `src/pages/market/index.vue` 的 `mk-source-chip`（K线/北向/龙虎榜/F10 横排）
- `src/pages/portfolio/index.vue` 中的子 tab 写法

**本期新组件**：`<FundSubTabs :active="activeType" @change="onChange" />`
- props: `active: FundType`, `tabs: FundType[]`（默认 4 个）
- slots: `right` 用于右侧「更多」自定义内容
- emit: `change(type: FundType)`

**样式要点**：
- 横排滚动：`overflow-x: auto`
- 激活态：金色下划线 4rpx（`$app-accent`），文字变 `$app-text`
- 非激活：`$app-text-muted`
- 背景：透明（页面背景 `$app-bg`），hover 用 `$app-card-bg`
- 「更多」：与 tab 同字号，`$app-text-muted` 色，点击 toast「即将开放」

### 5.4 Sankey 组件（关键决策）

> **架构师需要决策**：见 §8 待确认问题。

**方案对比**：

| 方案 | 优势 | 劣势 | 推荐度 |
|------|------|------|--------|
| **A. 纯 SVG（Sankey 自绘）** | 跨端一致；可缩放；样式可控；零依赖 | 需手写布局算法（节点对齐、彩带 bezier） | ⭐⭐⭐⭐ |
| **B. d3-sankey（d3.js 子集）** | 现成算法 + 配色 | 包体积 +50KB；小程序端不兼容 | ⭐⭐ |
| **C. Canvas 2D** | 性能好；可交互 | 字号模糊；H5 端 OK 但截图文字不利 | ⭐⭐ |
| **D. CSS flex 简易版** | 轻量；H5 完美 | 严格说不是 Sankey（不能表达多对多），最多 4×4 简单版 | ⭐⭐⭐（备选） |

**推荐**：**A. 纯 SVG 自绘**（参考图结构固定为 4 资金 → 4 板块 + 4 资金 → 3 板块，简单 bezier 即可）

**布局算法**（产品侧定义，架构师实现）：
- 左列节点（资金）：固定 **4 个**，垂直均分（v1.1：仅 4 个真实资金类型，无额外节点）
- 右列节点（板块）：3-4 个，垂直均分
- 彩带：从左侧资金节点右边缘 → 右侧板块节点左边缘，用 `C` bezier 曲线
- 宽度：`width = max(2px, pct / maxPct * 80px)`
- 颜色：`$fund-*` 对应色 → 同色 0.4 透明度渐变
- 节点文字：左侧右对齐 + 12rpx，右侧左对齐 + 12rpx，色 `$app-text`
- 百分比 chip：节点右侧 `$spacing-sm`，背景 `$app-card-bg`，圆角 `$radius-sm`，字号 22rpx，**文字色按正负取 `$app-up` / `$app-down`**
- 容器背景：透明（继承页面 `$app-bg`）；如需卡片感则用 `$app-card-bg` + `$app-border`

**兼容策略**：H5 用 SVG；小程序端可用 `<image>` 内嵌 SVG 字符串或用 Canvas 2D 兜底（v1 不要求）。

### 5.5 4 类资金 Icon

**推荐：复用 emoji**（与参考图一致），无需切图：
- 共同增仓：`🔀` (U+1F500)
- 公募基金：`💧` (U+1F4A7)
- 超级平准：`🌊` (U+1F30A)
- 超级外资：`🔥` (U+1F525)
- 更多（扩展 tab）：`⋯` (U+22EF) 或省略

**字号**：28rpx，与正文对齐；激活态放大到 32rpx。

**备选**：若跨端需要统一外观（emoji 在 Android 不同厂商表现差异），可切图（24×24 PNG）。**v1 直接用 emoji，备选未来切换**。

### 5.6 响应式与折叠屏（v1.1 新增）

**断点体系**（`src/styles/breakpoints.scss`）：

| 变量 / mixin | 范围 | 语义 |
|--------------|------|------|
| `$bp-sm` | 400rpx | 小屏机 |
| `$bp-md` | 600rpx | 折叠屏 / 大屏机 |
| `$bp-lg` | 900rpx | 平板 |
| `$bp-xl` | 1200rpx | 桌面 |
| **`@mixin fold-wide`** | **700px – 1400px（H5 视口 px）** | **折叠屏 / 平板双栏** |

> **`fold-wide` 原理**：uni-app 的 rpx 按屏宽等比缩放，折叠屏上同值 rpx 会物理放大近 2 倍，所以折叠屏要「复直板机物理尺寸（px）+ 左右双栏」。**直板机（< 700px）不命中该 mixin，UI 零改动**。

**资金动态页双栏布局规范**：

| 视口 | 布局 | 说明 |
|------|------|------|
| **< 700px**（直板机） | **单栏纵向堆叠** | Hero → 子 tab → 日期 banner → Sankey → Sankey CTA → 板块增仓榜 → 股票中意榜（v1.2：底部推广 CTA/banner 已删，榜单为最后内容块）。**与 v1.0 一致，UI 零改动** |
| **700px – 1400px**（折叠屏展开 / 平板竖屏） | **左右双栏** | 见下 |
| **> 1400px**（桌面） | 沿用双栏 + `max-width: 1200rpx` 容器居中 | v1 兜底方案，不做专项设计 |

**双栏详细切分（700–1400px）**：

```
┌──────────────────────────────────────────────────────┐
│  Hero（资金增仓比例 + 副标 + 🔍）      [全宽 sticky]  │
│  子 tab（4 类资金 + 更多）              [全宽 sticky]  │
│  日期 banner                            [全宽]        │
├────────────────────────┬─────────────────────────────┤
│  左栏（约 58%）         │  右栏（约 42%）              │
│  ┌──────────────────┐  │  ┌───────────────────────┐  │
│  │  Sankey 桑基图    │  │  │  板块增仓榜 (近 5 日)  │  │
│  │  (4 资金→N 板块)  │  │  │  💧/🌊/🔥 × 3 名次     │  │
│  └──────────────────┘  │  └───────────────────────┘  │
│  ┌──────────────────┐  │  ┌───────────────────────┐  │
│  │  Sankey CTA       │  │  │  股票中意榜 (近 5 日)  │  │
│  │  (文案+查看名单)   │  │  │  💧/🌊/🔥 × 3 名次     │  │
│  └──────────────────┘  │  └───────────────────────┘  │
│                        │  [右栏内部纵向滚动]           │
└──────────────────────────────────────────────────────┘
（v1.2：原底部「还有其他想法?」CTA 与「机会大师」广告 banner 已删除）
```

**实现要点**：
- 用 `@include fold-wide { ... }` 包裹双栏规则；直板机默认单栏（不写媒体查询）。
- 左栏 `flex: 0 0 58%`，右栏 `flex: 1 1 42%`，双栏间距 `$spacing-lg`。
- 右栏榜单内容超出时**右栏内部纵向滚动**（`overflow-y: auto`），左栏 Sankey 保持固定不动。
- Hero 与子 tab 在双栏之上 `position: sticky; top: 0`，背景用 `$app-bg` 实色（防透出）。
- 榜单在双栏下：每组仍为 3 列（rank 1/2/3），列宽自动均分，不改为 1 列或 6 列。
- ~~底部 CTA 与广告 banner 跨双栏全宽~~ → v1.2 已删，无跨栏元素。

**小程序端注意**：小程序无 `@media` 响应式，如需双栏须用 JS 监听 resize 后切 class。v1 仅 H5，小程序不在范围。

---

## 6. 交互 & 状态

### 6.1 状态机

```
INIT → LOADING → SUCCESS (activeType=joint)
              ↘ ERROR
              ↘ EMPTY

任何状态：用户操作 → LOADING（带 debounce 200ms）
SUCCESS：子 tab 切换 → 重新 LOADING（带 5 分钟缓存）
```

### 6.2 子 tab 切换交互
- 点击 → 200ms 内显示骨架屏 → 接口返回 → fade in 新内容
- URL 同步：`?type=public_fund`
- 接口：`GET /api/fundflow?type=${type}`
- 缓存策略：同一 `type` 5 分钟内复用缓存

### 6.3 刷新
- 下拉刷新：触发 `uni.startPullDownRefresh`，重新拉取当前 `type` 数据
- Hero 卡 🔍 旁的小刷新按钮：右上角 28×28rpx，点击旋转 360°（CSS animation，1s）
- 刷新中：按钮 disabled，旋转动画显示；其他交互 disabled

### 6.4 加载 / 空 / 错误态文案

| 状态 | 文案 | 样式 |
|------|------|------|
| 加载中 | "加载中…" | 居中 + 16rpx spinner（`$app-accent` 金色旋转） |
| 空数据 | "暂无资金数据 · 请稍后再来" | `$app-text-muted` + 简单图标 |
| 错误 | "加载失败 · 点击重试" | `$app-text-muted` + `$app-error` ❗ + 重试按钮 |
| 网络错误 | "网络异常 · 检查连接后重试" | `$app-text-muted` + 离线图标 |

### 6.5 占位入口反馈（「更多」/「查看更多」/「全部榜单 >>」）
- 触发：「更多」tab、「查看完整名单」、榜单内「查看更多」、「全部榜单 >>」（v1.2：底部《机会大师》CTA 与广告 banner 已删，无此项）
- 反馈：统一 `uni.showToast({ title: '即将开放', icon: 'none', duration: 1500 })`
- 后续动作：无（v1 占位），当前选中的资金类型不变，页面不跳转

> **数据真实性提示**：日期 banner 下方须常驻灰色小字「数据为示意 · v1 mock」（`$app-text-muted`，22rpx），不得隐藏。

---

## 7. 非功能需求

### 7.1 性能
- 首屏 < 2s（mock 数据无网络延迟，主要时间在组件渲染）
- Sankey 渲染 < 200ms
- 子 tab 切换（命中缓存）< 100ms
- 列表滚动：60fps

### 7.2 可访问性（最小要求）
- 字号可读：正文 ≥ 28rpx，标题 ≥ 32rpx
- 颜色对比度：文字对背景 ≥ 4.5:1（`#F5F5F7` on `#0b0b0d` ≈ 18:1，`#8A8A8E` on `#0b0b0d` ≈ 5.9:1，均达标）
- 按钮可点击区域 ≥ 80×80 rpx（含 padding）
- 所有可点元素有明确 hover / active 反馈

### 7.3 移动端适配
- 设计稿：375 - 430 dp
- 安全区：`env(safe-area-inset-bottom)` 已在 tabBar 使用（v1.2：底部 CTA / banner 已删，无其他需适配元素）
- 横屏：不优化（H5 主要竖屏）

### 7.4 响应式断点
- 复用 `src/styles/breakpoints.scss`：`$bp-sm` / `$bp-md` / `$bp-lg` / `$bp-xl`
- **折叠屏双栏：`@mixin fold-wide`（700px–1400px）**，详见 §5.6
- 直板机 `< 700px` 不命中 `fold-wide`，单栏纵向堆叠，UI 零改动

### 7.5 离线 / 缓存
- 接口响应缓存 5 分钟（前端 `uni.setStorageSync`）
- 离线时降级为最后一次缓存数据 + 顶部提示"离线缓存"
- v1 不实现 Service Worker / 强缓存

---

## 8. 待确认问题（主理人需拍板）

| # | 问题 | 候选 | 推荐 | 阻塞？ |
|---|------|------|------|--------|
| 1 | v1 是否 mock？ | mock / 真实（付费） | **mock**（见 §4.3） | ✅ 必须 |
| 2 | Sankey 渲染方案 | A. SVG 自绘 / B. d3 / C. Canvas / D. CSS 简化 | **A. SVG 自绘** | 建议（架构师可拍板） |
| 3 | 是否替换原"行情"tab？ | a. 完全替换 / b. 保留+新增第 5 tab | **a. 完全替换**（market 路由保留注册但移出 tabBar） | ✅ 必须 |
| 4 | 榜单每组展示几条？ | 3 条 / 5 条 / 10 条 | **3 条**（与参考图一致，全真实数据） | 建议 |
| 5 | ~~底部「机会大师」广告 banner 是否保留？~~ | — | **b. 一并删除（主理人已拍板，v1.2）** | ✅ 已拍板 |
| 6 | 「更多」tab 是否要做？ | a. 占位（toast「即将开放」） / b. 跳设置 / c. 真实多资金类型 | **a. 占位** | 建议 |
| 7 | 后端是否要新增 Turso 表？ | a. 不需要（mock 走内存） / b. 新增 `fund_flow_*` 表 | **a. 不需要**（v1 mock 内存即可） | 建议 |

> **v1.1 已关闭的决策**（不再需要拍板）：
> - ~~合伙人解锁实现深度~~ → 功能整体移除
> - ~~「关闭动效」降饱和程度~~ → 开关整体移除

### 8.1 关于「机会大师」推广元素的最终裁定（v1.2 已拍板：删除）

**主理人裁定（2026-09-01）**：《机会大师》属**外部产品推广**，与本项目无关，**不需要**。底部两处推广元素**一并删除**：
1. ~~「还有其他想法?」紫色渐变 CTA（内含"去《机会大师》火火看看"导流文案）~~ → 删除
2. ~~广告 banner（紫色"机会大师" + 黄字"投贵里的'找新票'" + 价格标签 + 717 灯塔 + 图片位）~~ → 删除

**影响面**：仅 `BottomCta.vue` 一个组件——删除后该组件不再需要，从文件清单移除；页面底部无连锁空白问题（榜单为最后内容块）。PM 此前"保留占位"的 4 条判断（§原 8.1）不再适用，留档于修订记录。

---

## 9. 变更影响清单

### 9.1 修改文件

| 路径 | 修改内容 | v1.1 变更 |
|------|----------|-----------|
| `src/pages.json` | tabBar list 第 4 项：行情 → 资金动态；新增 `pages/fundflow/index` 路由；`navigationBarTitleText` 改"资金动态"；`pages/market` 路由保留注册但移出 tabBar | 不变 |
| `src/custom-tab-bar/index.vue` | 第 4 个 list item 的 pagePath + text + icon 改 | 不变 |
| `src/styles/theme.scss` | 末尾追加 **4 个** `$fund-*` 资金色变量 | **变更**：原计划 4 个（含 `$fund-partner`），现改为 `$fund-joint` / `$fund-public` / `$fund-stab` / `$fund-foreign`，**已删除 `$fund-partner`** |
| `src/styles/theme.scss` | ⚠️ **上游 `a69fc43` 已改版**：`$app-bg` 由 `#0D1B2A` → **`#0b0b0d`（墨黑）** | **已核实**（2026-09-01 Read 确认） |
| `src/styles/breakpoints.scss` | ⚠️ **上游 `a69fc43` 已新增** `@mixin fold-wide`（700px–1400px） | **已核实**（2026-09-01 Read 确认） |
| `src/uni.scss` | **不修改**（`$uni-*` 保留供插件兼容；新业务代码不引用其颜色变量） | 不变 |

### 9.2 新增文件

| 路径 | 用途 | v1.1 变更 |
|------|------|-----------|
| `src/pages/fundflow/index.vue` | 资金动态主页 | 不变 |
| `src/pages/fundflow/components/HeroCard.vue` | 顶部 hero 卡 | 不变 |
| `src/pages/fundflow/components/SubTabs.vue` | 子 tab + 更多 | **变更**：移除色彩开关相关 props/slot |
| `src/pages/fundflow/components/DateBanner.vue` | 日期 banner + 「数据为示意」标注 | 不变 |
| `src/pages/fundflow/components/SankeyChart.vue` | Sankey SVG 组件 | **变更**：左列仅 4 个真实资金节点 |
| `src/pages/fundflow/components/SankeyCTA.vue` | Sankey 下 CTA 区块 | **变更**：仅文案 + 链接，**移除付费按钮** |
| `src/pages/fundflow/components/RankBoard.vue` | 通用榜单（板块 / 股票复用，传 prop 区分） | **变更**：移除锁定卡分支，3 名次全渲染真实数据 |
| ~~`src/pages/fundflow/components/BottomCta.vue`~~ | ~~底部紫色渐变 CTA + 广告 banner~~ | ❌ **已删除**（v1.2：《机会大师》外部推广，主理人拍板移除） |
| ~~`src/pages/fundflow/components/PartnerModal.vue`~~ | ~~合伙人解锁弹窗~~ | ❌ **已删除**（v1.1 移除） |
| `src/api/fundflow.ts` | API 封装 + TS 接口定义 | **变更**：移除 `locked` / `muted` 字段 |
| `src/stores/fundflow.ts`（可选） | pinia store：activeType / 缓存 | **变更**：移除色彩开关状态位 |

### 9.3 后端新增（可选，架构师决定）

| 路径 | 用途 | v1.1 变更 |
|------|------|-----------|
| `server/src/routes/fundflow.ts` | `GET /api/fundflow` 路由 | 不变 |
| `server/src/services/fund-collector.ts` | mock 数据生成（mulberry32 种子算法 + 板块/个股池） | **变更**：每类资金返回 3 条完整记录（不再留占位缺口） |
| `server/src/providers/fund-flow-eastmoney.ts` | 预留真实模式接口 | 不变 |
| Turso 新表 | v1 不需要 | 不变（**不建表**） |

### 9.4 废弃 / 不动

| 路径 | 处理 |
|------|------|
| `src/pages/market/index.vue` | **保留**（路由保留注册但移出 tabBar，兼容旧链接） |
| `src/pages/market` 目录 | 同上 |
| `src/api/market.ts` | **保留**（供 portfolio 子模块使用） |
| `src/components/ResponsiveGrid.vue` | **复用**（如需扩展 rank 卡片布局）；双栏布局优先用 `@mixin fold-wide` |

---

## 10. 验收标准（QA Checklist）

### 10.1 功能性
- [ ] H5 打开后底部 tabBar 第 4 项显示「资金动态」并高亮金色（`$app-accent`）
- [ ] 点击「资金动态」tab 进入 `pages/fundflow/index`，默认 type=joint
- [ ] 子 tab 显示 4 个资金类型，默认「共同增仓」高亮
- [ ] 子 tab 右侧显示「更多」，点击 toast「即将开放」
- [ ] 日期 banner 显示「以下流动为资金的【近1日】增仓比例 (更新时间: MM-DD)」格式正确
- [ ] **日期 banner 下方常驻显示灰色小字「数据为示意 · v1 mock」**
- [ ] Sankey 图左列**恰好 4 个资金节点**（共同增仓 / 公募基金 / 超级平准 / 超级外资），**无第 5 个节点**
- [ ] Sankey 右列 3-4 个板块节点，彩带宽度与强度成比例
- [ ] 每个资金/板块节点旁显示百分比 chip（`+X.XXX%` / `-X.XXX%`），**涨用 `$app-up` 红、跌用 `$app-down` 绿**
- [ ] Sankey 下 CTA：「以上板块/股票资金面有明显加仓的」+「查看完整名单」均显示，**无按钮**
- [ ] **板块增仓榜 (近 5 日)**：3 组 × 3 列，**rank 1/2/3 全部为真实数据**（板块名 + 增仓比例 + 查看更多）
- [ ] **股票中意榜 (近 5 日)**：3 组 × 3 列，**rank 1/2/3 全部为真实数据**（板块名 / 代码 / +占比%）
- [ ] 榜单「查看更多」/「全部榜单 >>」点击 toast「即将开放」
- [ ] **页面无任何《机会大师》推广元素**（底部 CTA「还有其他想法?」与广告 banner 均已删除，v1.2）
- [ ] 切换子 tab 后整页数据刷新，URL query 同步

### 10.2 交互
- [ ] 下拉刷新触发，重新拉取数据
- [ ] Hero 刷新按钮点击后旋转 360°，期间 disabled
- [ ] 加载中显示骨架屏 / spinner；空数据显示「暂无资金数据」；错误显示「加载失败 · 点击重试」并可重试
- [ ] 子 tab 切换动画流畅（< 300ms）
- [ ] 页面**无任何** toast / 弹窗 / 按钮提及付费、会员、解锁、合伙人

### 10.3 视觉 & 设计融入（v1.1 重点）
- [ ] **页面主背景为 `#0b0b0d`（`$app-bg`，墨黑）**，非 `#0D1B2A`
- [ ] 卡片背景为 `#152739`（`$app-card-bg`），圆角 `$radius-lg` 20rpx
- [ ] 金色强调使用 `$app-accent`（`#D4AF37`）
- [ ] **代码中无 `$uni-color-primary` 等 `$uni-*` 颜色变量引用**（仅 `$uni-font-size-*` 尺寸变量可用）
- [ ] 4 类资金 emoji 显示正确（🔀 / 💧 / 🌊 / 🔥）
- [ ] 4 类资金彩带色正确：`$fund-joint` 金 / `$fund-public` 暖黄 / `$fund-stab` 青 / `$fund-foreign` 橙红
- [ ] **涨跌幅 chip 用 `$app-up` / `$app-down`，未与 `$fund-foreign` 橙红混用**
- [ ] 红涨绿跌（A 股约定）正确
- [ ] **无任何「合伙人权限相关」紫色元素**（合伙人解锁卡 / 付费 CTA / 动效 toggle 已整体移除）
- [ ] hero 副标题「资金主力&准主力」紫字**予以保留**（常规视觉，非权限功能）；底部 CTA / banner 已删（v1.2），**页面无其他紫色推广元素**

### 10.4 性能 & 兼容
- [ ] 首屏加载 < 2s（mock 数据）
- [ ] Sankey 渲染 < 200ms
- [ ] 移动端 375dp / 414dp / 430dp 显示正常，无横向滚动
- [ ] **直板机（视口 < 700px）单栏纵向堆叠，UI 与 v1.0 一致、零改动**
- [ ] **折叠屏展开（700px–1400px）切换为左右双栏**：左栏 Sankey + CTA，右栏两大榜单且内部可滚动
- [ ] 双栏下 Hero 与子 tab sticky 吸顶，背景不透明
- [ ] 浏览器 DevTools 控制台无报错

### 10.5 数据真实性
- [ ] 页面显著标注「数据为示意 · v1 mock」
- [ ] mock 数据 seed 稳定：同一日期同一资金类型结果一致
- [ ] `sectors[fundType]` 与 `stocks[fundType]` 各返回 **3 条**完整记录
- [ ] 接口响应**不含** `locked` / `muted` 字段
- [ ] 后端 `FUND_FLOW_MODE` 环境变量生效，默认 `mock`

### 10.6 跨页签兼容
- [ ] tabBar 高亮与当前路由一致（参考 `syncTabActiveFromRoute` 已实现）
- [ ] URL query `?type=...` 切换不丢失 tab 高亮
- [ ] `pages/market` 仍可通过 URL 直接访问（路由保留），但不在 tabBar 中展示

---

## 11. 附录

### 11.1 参考图关键信息复盘（v1.1 已剔除已砍部分）
- 路径：`C:\Users\TheOne\.workbuddy\clipboard-images\clipboard-2026-09-01T05-15-06-584Z-ba31f55b.jpg`
- 页面标题：「资金动态」
- 顶部 hero：「资金增仓比例」+ 紫色小字「资金主力&准主力」+ 🔍
- 子 tab（默认选中 = 共同增仓，下划线金色）：共同增仓 / 公募基金 / 超级平准 / 超级外资 / 更多
  - ~~[toggle: 关闭动情/关闭动效]~~ → **v1.1 已砍**
- 日期 banner：「以下流动为资金的 【近1日】增仓比例 (更新时间: 08-31)」
- Sankey：左列 **4 个真实资金节点**（~~含"合伙人解锁 ⭐"~~ → **v1.1 已砍**），右列 3-4 板块节点；彩带 = 金 / 黄橙 / 青蓝 / 橙红
- 板块榜（公募 💧 / 超级平准 🌊 / 超级外资 🔥）× Top 3 → **v1.1：3 名次全真实数据**（~~rank 1 锁定占位~~ 已砍）
- 股票榜（公募 / 超级平准 / 超级外资）× Top 3 → **v1.1：3 名次全真实数据**（~~rank 1 锁定占位~~ 已砍）
  - ~~注脚：「升级合伙人员可查看前3名及更多名单哦~」~~ → **v1.1 已砍**
- ~~底部 CTA：「还有其他想法?」紫色渐变 + 「去《机会大师》火火看看 授你的想法高选」~~ → **v1.2 已砍**（《机会大师》外部推广）
- ~~广告 banner：紫色"机会大师" + 黄色"投贵里的"找新票" + 6.7/? / 717灯塔~~ → **v1.2 已砍**（同上）

> ⚠️ 参考图中标注为**紫色**的元素（合伙人解锁卡 / 付费 CTA / 动效 toggle）在 v1.1 中均已移除；底部 CTA 紫渐变与广告 banner 紫标题在 **v1.2** 中随《机会大师》推广一并删除；**仅 hero 副标题紫字保留**（常规视觉，非权限功能）。

### 11.2 数据来源核实记录

| 搜索关键词 | 平台 | 核实时间 | 结论 |
|-----------|------|----------|------|
| AKShare 资金流向 板块 增仓比例 | WebSearch | 2026-09-01 | 仅给"超大单/大单/中单/小单/主力"5 档，与产品 4 类资金非 1:1 |
| 超级平准 A股 资金 流向 板块 | WebSearch | 2026-09-01 | "超级平准"为产品口语化称呼；中央汇金/国新/诚通 ETF 持仓 + 增持公告，无实时免费 API |

### 11.3 文档引用（v1.1 更新基线）
- `src/pages.json`：现有 tabBar / pages 配置
- `src/custom-tab-bar/index.vue`：自定义 tabBar 实现
- `src/styles/theme.scss`：⚠️ **已改版**——`$app-bg` = `#0b0b0d`（墨黑）
- `src/styles/breakpoints.scss`：⚠️ **已新增** `@mixin fold-wide`（700px–1400px）
- `src/uni.scss`：design tokens（`$uni-*` 仅供插件兼容，新代码不引其颜色变量）
- `src/api/market.ts`：API 封装惯例
- `src/pages/market/index.vue`：参考页面模式（K 线 / 子 tab / Canvas 图表）
- `src/components/ResponsiveGrid.vue`：响应式栅格组件
- `server/src/index.js`：`marketHandler` + `cache.ts` 缓存模式
- `docs/news-sources.md`：数据源核实方法论参考
- `docs/A股正金字塔仓位管理器_节节高_项目备忘_v2_2026-08-13.md`：项目背景

### 11.4 风险与备选

| 风险 | 影响 | 备选 |
|------|------|------|
| 4 类资金无合规免费实时数据 | 数据真实性 | v1 mock，schema 1:1 对齐真实数据；页面显著标注「数据为示意」 |
| Sankey 在小程序端不兼容 | 跨端 | v1 仅 H5；小程序端后续用 Canvas 或静态 SVG |
| market tab 直接替换可能丢失用户 | 用户体验 | market 内容已部分并入 portfolio；`pages/market` 路由保留注册，兼容旧链接 |
| emoji 在 Android 不同厂商外观差异 | 视觉一致性 | v1 直接用，备选切图 |
| `$fund-foreign` 橙红与 `$app-up` 红涨视觉接近 | 用户误读 | 已定规则：涨跌 chip 只用 `$app-up`/`$app-down`，资金彩带只用 `$fund-*`（见 §5.1） |
| 折叠屏双栏下右栏榜单内容过长 | 布局溢出 | 右栏内部纵向滚动（`overflow-y: auto`），左栏 Sankey 固定 |
| 视口 > 1400px 无 `fold-wide` 规则 | 桌面端布局 | v1 用 `max-width: 1200rpx` 容器居中兜底，不做专项设计 |

---

**END OF PRD（v1.1）**