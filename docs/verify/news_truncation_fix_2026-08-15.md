# 电报整帖截断修复 (2026-08-15)

## 根因
1. 硬截断（主因）：`server/src/db.js` 的 `upsertNewsItems` 把 `title` 截到 500、`summary` 截到 1000。
2. 结构性截断：RSSHub Telegram feed 把每行消息第一行塞 `<title>`、整段进 `<description>`；兜底 `parseTelegramPage` 取 `lines[0]` 做标题、`lines.slice(1)` 限 900 字。

## 修复（提交 caaaf44）
- `db.js`：`news_items` 新增 `content` 字段（存整帖，上限 16000）；`summary` 上限提到 4000；
  `upsertNewsItems` 写入 `content`；`fetchNews` 返回 `content`；`migrateNewsContent()` 回填旧行（content=summary）。
- `telegram-rss.js`：`parseRssText`/`parseAtomText` 将 description 整段作为 content；`parseTelegramPage` 去掉首行限制、不再砍行（整帖当 content）。
- `news-collector.js`：mock 分支补 `content`。
- `news/index.vue`：渲染优先 `content`（整帖），`white-space:pre-wrap` 长文整段显示。
- `research-report.ts`：清理 UTF-8 BOM（顺带）。

## 验证
- `vue-tsc --noEmit` EXIT=0；H5 news.vue 编译 200 无 error。
- `docs/verify/db-content-test.mjs`：插入 5065 字长文 → summary 截到 4000、content 完整保留（content==原文 true）；电报式 6008 字 → content 完整。
- 后端已重启（9999 UP，PID 61164），迁移已执行。

## 说明
- 列表标题仍取首行（保持列表紧凑）；正文区整帖全文显示。
- 旧库已有记录若 summary 原本被截，content 回填为当时的 summary（可能仍不全），新抓取后用整帖覆盖。
