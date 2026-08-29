# 2026-08-16 修复：研报页乱码 + 持仓公告消失

## 问题1：AI研报页面显示乱码
**根因**：`src/pages/research/index.vue` 的 `<style lang="scss">` 引用了 2 个未定义变量
- `$color-text-primary`（第354行 `.rs-title`）
- `$color-text-secondary`（第355行 `.rs-meta`）
导致 Vite 编译该 SFC 的 style 块时返回 **HTTP 500**，页面空白/报错栈叠加（与之前持仓页 `$radius-md`/`$color-text` 缺失是同类 bug）。

**验证**：`GET /src/pages/research/index.vue?vue&type=style&lang.scss` 修复前 = 500，修复后 = 200。

**修复**：在 research 的 design tokens 块补定义：
```scss
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
```
三页（news/research/portfolio）+ 自定义 tabBar + PlanTable 全量 SCSS 变量扫描，现已全部无未定义引用。

## 问题2：持仓标的相关 公告时有时无 / 消失
**根因**：`server/src/news-collector.js` 第281行调用
```js
await db.cleanupOldNews(now - NEWS_RETENTION_HOURS * 3600_000, db.HOLDING_NEWS_CHANNELS);
```
但传入的 `db` 是 index.js 构造的精简 stub `{ upsertNewsItems, recordSourceError, cleanupOldNews }`，**不含 `HOLDING_NEWS_CHANNELS`**，所以 `db.HOLDING_NEWS_CHANNELS === undefined` → keepChannels 为空 → `cleanupOldNews` 删除所有 `published_at < 24h前` 的记录，**持仓公告（真实较旧发布日）被全部误删**。

**修复**：在 news-collector.js 直接 `import { HOLDING_NEWS_CHANNELS } from './db.js'`，改用该常量（值为 `['eastmoney_announcement']`，前缀匹配 `eastmoney_announcement_600519`）。

**验证**：重启后端（PID 2188）后触发 refresh，`/api/news?holding=1` 稳定返回 **30 条**公告（覆盖 600519/000858/600036 三个持仓），不再被清理。

## 验证结果
- vue-tsc --noEmit：EXIT=0（无类型错误）
- 研报 style 编译：200（修复前 500）
- 持仓 tab 公告：刷新后 30 条稳定留存
- 后端 9999 运行中（PID 2188），H5 5173 运行中

## 提交
`4027450` fix: 研报页SCSS变量缺失导致500乱码 + 持仓公告被清理误删（2 files +8/-5）
