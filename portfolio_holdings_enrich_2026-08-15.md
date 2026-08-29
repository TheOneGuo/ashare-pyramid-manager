# 持仓页「已有持仓」大改 — 完成记录 (2026-08-15)

## 用户需求
1. 去掉「上传截图」「智能识别」按钮与下方预览窗口，直接显示持仓列表
2. 「导入到持仓列表」「手动输入」→「拍照」「导入文件到持仓」「手动输入」
3. 列表列：代码 / 名称 / 综合成本 / 股数 / 现价 / 盈亏
4. 据此外建库；拍照/导入文件(截图·CSV·PDF)/手动输入仅识别「代码或名称任一 + 综合成本 + 股数」，自动经行情接口得另一项 + 现价并算盈亏

## 关键现实
- akshare 不可用（Python-only / 商用限制）→ 用腾讯 `qt.gtimg.cn` + 新浪 `suggest3.sinajs.cn` 作等价数据源（实测本机可直连）
- 原 `portfolio_holdings` 表无现价/盈亏列 → 扩列 + 迁移

## 落地改动
### 后端
- `server/src/stock-service.ts`（新）：`enrichHolding` / `resolveCodeByName`(新浪) / `resolveNameByCode`(腾讯) / `fetchCurrentPrice`(腾讯 gtimg) / `parseCsv` / `parsePdf`(pdf-parse) / `importFromText` / `importFromFile`
- `server/src/db.js`：`portfolio_holdings` 加 `current_price/pnl/pnl_pct`；`upsertHolding`/`listHoldings` 同步；`migrateHoldingsColumns()` + `initDb` 接入；`importHoldings(items)` 批量；`safeJson` 解析
- `server/src/index.js`：注册 `POST /api/portfolio/holdings/import`
- `server/package.json`：装 `pdf-parse`

### 前端
- `src/api/portfolio.ts`：`Holding` 加 `current_price?/pnl?/pnl_pct?`；新增 `importHoldings()`
- `src/pages/portfolio/index.vue`：② 区重写为 三按钮(拍照/导入文件/手动输入) + 六列列表；拍照走 `uni.chooseImage`→OCR(`portfolio-extract`)→富化；H5 用 `<input type=file>` 通用选截图/CSV/PDF；微信走 `chooseMessageFile`；盈亏红绿着色

## 验证
- vue-tsc EXIT=0；H5 渲染无 console 错误
- 接口实测：
  - 按代码 600519 → 自动补 贵州茅台 + 现价 1341.99 + 盈亏 -35801 ✅
  - 按名称 五粮液 → 自动解析 000858 + 现价 73.75 + 盈亏 -18250 ✅
  - 代码名称皆缺 → 正确拒绝报错 ✅
  - CSV 文本批量 → imported 2 ✅
- UI：3 按钮 + 头部六列 + 盈亏色（绿 +138 / 红 -18250,-35801）全部到位

## 提交
`7199437` feat(portfolio): 已有持仓改拍照/导入文件/手动输入+六列盈亏+akshare等价行情补全
（6 files, +477/-105；含 stock-service.ts 新建）

## 待议（用户未确认）
- 电报截断修复：`db.js` 行 222-223 的 `title.slice(0,500)/summary.slice(0,1000)` 硬截断仍未改（等用户确认抬上限或加 content 字段）
