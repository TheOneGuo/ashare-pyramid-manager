# 持仓标的相关新闻为空 — 根因与修复（2026-08-15）

## 问题
新闻页切到「持仓标的相关」tab 显示空白。

## 根因（两层）
1. **查询层 bug**：`/api/news?holding=1` 的 `fetchNews` 用 `source_channel IN (电报三源 + eastmoney_持仓源) ORDER BY published_at DESC LIMIT 100`。电报刚好 100 条且都比持仓源新 → LIMIT 把仅有的几条持仓源（东财公告/个股新闻）全挤掉 → 持仓 tab 空。
2. **清理层 bug**：`cleanupOldNews(now - 24h)` 按 `published_at` 删旧。东财公告/个股新闻的 `published_at` 是**真实发布时间**（可能几天/几周前）→ 写入后立即被 24h 保留期删除。所以即便查询修好，数据也留不住。

## 修复
- `server/src/db.js`
  - `fetchNews` 的 holding 分支改为：电报三源 + 每个持仓的东财公告/个股新闻**各自独立取数（每源保底 20 条）再合并去重**，不再让持仓源被 LIMIT 挤出。
  - `cleanupOldNews(cutoff_ms, keepChannels=[])` 新增排除通道参数；新增 `HOLDING_NEWS_CHANNELS = ['eastmoney_announcement','eastmoney_stock_news']` 与 `isHoldingChannel()`。
- `server/src/news-collector.js`：清理调用改为 `cleanupOldNews(now - RETENTION, db.HOLDING_NEWS_CHANNELS)`。
- `src/pages/news/index.vue`：持仓 tab 切换（`onScopeChange`）改调 `/api/news?holding=1`（服务端已按持仓+宏观过滤），计数与展示直接用服务端返回，不再依赖客户端文本匹配。

## 验证
- 后端重启（9999）→ refresh → holding feed 返回 100 条（含 `eastmoney_announcement_600519` 贵州茅台半年度报告等真实公告）。
- 独立进程实测：`fetchAnnouncements` 真实返回 10 条 → upsert → 清理（带排除）后 10 条全部保留。
- H5 Playwright：点击持仓 chip → 渲染 100 条、无 console 错误。
- `vue-tsc --noEmit` EXIT=0。
- 提交 `d123b07`（3 files, +98/-43）。

## 备注：用户要求的 14 类持仓相关采集规划（尚未实施）
用户列出的类别本质是一个「持仓标的产业链舆情监控」系统，需建「产业链画像」（上游原材料/主要客户/海外可比/政策域/运输路线）才能做间接关联（政策、地缘、商品新闻通常不出现股票名）。分为：
- A 类（公司级，直接关联）：公告/个股新闻/电话会纪要/订单合同/客户认证/并购/分红 → 东财+互动易+F10。
- B 类（产业链级）：上游原材料价格/供给、产品市场价格、航道禁运 → 期货所+SMM/生意社+运价指数，需持仓画像。
- C 类（市场级）：海外同类标的新闻、海外政策(关税/汇率/禁运)、国内政策 → Yahoo Finance+政策源 RSS+LLM 分类。
- 关联核心：持仓画像 + LLM 打标。

落地路线：阶段1(已做)修空问题 → 阶段2 加 F10/分红/互动易(A类) → 阶段3 商品/运价(B类) → 阶段4 LLM 分类(C类) → 阶段5 维护产业链画像知识库。
约束：akshare 不能跑（Python+禁商用），用东财/新浪/腾讯/Yahoo HTTP 等价源；真 LLM 分类未接（现为 mock）。
