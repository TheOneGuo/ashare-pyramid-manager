# 持仓分析页 5 大模块对标原项目 — 落地完成

**日期**：2026-08-14
**提交**：`54226f8`
**仓库**：`TheOneGuo/ashare-pyramid-manager`（private）

## 目标
把原项目「账户与保证金账本 / 已有持仓 / 拟新买标的 / 策略方案 / 持仓方案跟踪」5 大模块逐一对照，补齐全新 `portfolio/index.vue` 缺失的部分。

## 对照结论（落地前）→ 落地后
| 模块 | 落地前 | 本次落地 |
|---|---|---|
| ① 账户与保证金账本 | 完全缺失 | ✅ 后端事件流 + 前端账本卡 |
| ② 已有持仓 | 有导入但无逐行编辑 | ✅ 逐行改成本/数量 + 删除 |
| ③ 拟新买标的 | 持仓同时当 existing+stocks | ✅ 独立拟买列表，仅作 stocks 传入 |
| ④ 策略方案 | 加仓表缺投入金额/止盈表 | ✅ PlanTable 含金额列+占比+分批止盈动态止损 |
| ⑤ 持仓方案跟踪 | 完全缺失 | ✅ 分析后持久化方案 + 现价触发状态机 |

## 后端改动
- `server/src/account-ledger.ts`（新增，~10KB）：忠实移植 `position_account.py` 事件流 `buildAccount`/`previewChange`/`checkWithdraw`，术语表 TERMS，金额上限 0.01~1e9，MAX_EVENTS=2000。`checkWithdraw` 上限=可分配余额（防止不可结算态）。
- `server/src/db.js`：新增 `portfolio_ledger_events` + `portfolio_plans` 两表；`listLedgerEvents`/`appendLedgerEvent`/`clearLedger`/`upsertPlan`/`listPlans`/`removePlan`。
- `server/src/index.js`：注册 `GET/POST /api/portfolio/ledger`、`POST /api/portfolio/ledger/preview`、`DELETE /api/portfolio/ledger`、`GET/POST /api/portfolio/plans`、`DELETE /api/portfolio/plans/:code`；analyze 成功后自动持久化方案供跟踪。

## 前端改动
- `src/api/portfolio.ts`：扩类型（PlanRow 加 amount/pct、新增 TpRow/LedgerState/PlanItem/LedgerPreview/LedgerEvent），新增 `getLedger`/`appendLedgerEvent`/`previewLedgerEvent`/`clearLedger`/`listPlans`/`deletePlan`。
- `src/pages/portfolio/index.vue`：重构为 7 区（账本卡 / 已有持仓 / 拟买标的 / 运行分析 / AI研报 / 策略方案 / 跟踪），沿用原项目色板（深蓝#0D1B2A+金#D4AF37）与直板机/折叠屏响应式。
- `src/pages/portfolio/PlanTable.vue`（新增）：加仓表（档/价/股/投入金额/止损/占比）+ 分批止盈与动态止损表 + 总投入/剩余汇总。

## 关键修复
- `account-ledger.ts` 中 `eng.validateFeeRate` 在原项目返回**对象** `{ok,level,msg}`，被误用为**元组**解构 `[ok,level,msg]` → "object is not iterable"。全部改为对象访问（`vr.ok`/`vr.level`/`vr.msg`）。
- `db.js` SCHEMA 大模板字面量被旧 edit 吞掉结尾反引号 → 整个文件被吞成字符串，已补回 `\`;` 闭合。
- `account-ledger.ts` 跨目录引入 `../../src/utils/pyramid.js` 应为 `.ts`。

## 验证
- 后端：`ledger-e2e.mjs` 实测 init 500000→total_margin 500000/max_hold 3；withdraw 100000→400000；超限额 99999999 正确拒绝；deposit 回补正常。
- `plans-viable.mjs`：analyze 600036（招商银行）→ plan.ok=true，4 档+4 止盈行，持久化到 `/api/portfolio/plans`（600036/招商银行）。
- `vue-tsc --noEmit` 通过；H5 dev 5173 编译 index.vue/PlanTable.vue/api 均 200 无 transform 错误。
- 验证脚本保留于 `docs/verify/`（ledger-*.mjs / plans-*.mjs / analyze-inspect.mjs / h5-compile-check.mjs）。

## 已知限制（与原项目一致）
- ATR 用 2.5% 近似（akshare/腾讯行情受商用限制未接入），UI 已注明。
- 账本/计划存储走后端 DB（libSQL/sqlite-local），可跨端同步；未接 Turso（token 两次 401 失效，回退本地）。
- 接真 LLM：研报 `buildMockReport` 可换 `buildLlmReport`，前端零改动；分析结论本地引擎计算，LLM 仅做字段提取。
