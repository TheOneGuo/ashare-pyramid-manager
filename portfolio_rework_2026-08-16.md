# 持仓分析页大改造 + 跨页联动（2026-08-16）

## 用户 7 点需求与确认方案
- Q1：可用保证金 = 持仓外剩余可交易资金（有持仓）；无持仓必须手填可用保证金 + 手续费率
- Q2：删「产业链画像」卡 → 改名「持仓标的关键词」移到新闻页顶部，唯一入口，共用 DB holding_profiles
- Q3：「开始分析」生成方案 → 「确认并加入跟踪」→ 确认后才进持仓方案跟踪（可逐标确认）
- Q4：后端定时拉实时价（腾讯/新浪已有），到价位自动执行并同步调整持仓列表
- Q5：每个持仓自动与新闻页「持仓标的相关」（按代码过滤）+ 研报页「持仓标的 AI 研报分析」同步

## 已落地改动（提交 a41f240，9 文件 +631/-164）
1. **持仓页板块换序**：CSS `order` 实现 ①已有持仓 → ②可用保证金 → ③拟新买 → ④策略方案 → ⑤持仓方案跟踪（低侵入）
2. **可用保证金**：账户卡改名，有持仓时按持仓外剩余额度自动填；无持仓手填；max_hold 改为按 available 推导（`account-ledger.ts`）
3. **删画像卡 + 跨页跳转**：持仓页每行新增「相关新闻 / AI 研报」链接，跳新闻/研报页并 storage 传 code+name
4. **确认进跟踪**：analyze 不再自动落库；新增 `POST /api/portfolio/plans`；方案逐标显示「确认并加入跟踪」
5. **跟踪自动执行**：`track-executor.ts` computeTrackState 新增 `opened/cleared` 守卫（避免建仓前把持仓清零），后端定时拉价写入持仓
6. **新闻页关键词卡**：持仓标的相关顶部「持仓标的关键词」可编辑（DB holding_profiles），聚焦单标的筛选
7. **研报页聚焦**：onShow 读 storage，自动聚焦并生成该标的研报

## 验证
- vue-tsc --noEmit 通过
- 后端重启 9999 UP；POST /api/portfolio/plans 实测 {ok:true,persisted:1}
- H5 三页编译无错；Playwright 渲染：卡片顺序正确、关键词卡出现、无 console 错误

## 待办（未做）
- A 类直接源（互动易/订单/中标）仍靠画像关键词近似，未接 Tushare 真源
- BDI/商品已接，SMM/政策 RSS 仍部分 placeholder
- 仓库大量 debris（docs/verify/*、误名 console.log 文件、pdf）未清理
