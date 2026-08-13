# 真实新闻源实现笔记

## 数据源清单（实测 2026-08-13）

| 源 | URL | 状态 | 编码 | 备注 |
|---|---|---|---|---|
| Yahoo Finance RSS | https://finance.yahoo.com/news/rssindex | ✅ | UTF-8 | 无 key，全球财经 |
| Yahoo Finance Markets | https://finance.yahoo.com/news/markets/rss | ✅ | UTF-8 | 美股市场 |
| Yahoo Finance Stocks | https://finance.yahoo.com/topic/stock-market-news/rss | ✅ | UTF-8 | 个股新闻 |
| Yahoo Finance Crypto | https://finance.yahoo.com/topic/crypto/rss | ✅ | UTF-8 | 加密货币 |
| BBC Business RSS | https://feeds.bbci.co.uk/news/business/rss.xml | ✅ | UTF-8 | 英国+全球财经 |
| Hacker News | https://hnrss.org/newest?q=stock+OR+market | ⚠️ | UTF-8 | 偶有 503，无关键依赖 |

实测抓取 6 源时正常拉取 40+ 条/批（real 模式真实运行过）。

## 已废弃源（实测失败）

| 源 | URL | 失败原因 |
|---|---|---|
| Bing News RSS | https://www.bing.com/news/search?q=A股&format=rss | 服务端将 URL-encoded query 当 raw 字节塞 title，乱码 |
| Google News RSS | https://news.google.com/rss/search?q=A股 | 同上，UTF-8 字节不合法 |
| 新浪财经 7x24 API | https://feed.mix.sina.com.cn/api/portal/get/feed | 返回 `{code:11, msg:'sorry to you for this page'}` 锁定 |
| 财联社电报 API | https://www.cls.cn/nodeapi/updateTelegraphList | 端点 404（仅 HTML 页可达） |
| 巨潮资讯 cninfo | http://www.cninfo.com.cn/new/disclosure | 各参数组合均返回空数据 |

## 中文新闻源路线图

中文财经数据源普遍有限制（API key、JS 渲染、反爬），未来路线：

1. **付费 API**：雪球、东方财富实时、choice/通达信
2. **网页爬虫**：雪球热帖、东方财富股吧、新浪财经新闻页（注意 robots.txt）
3. **AI 摘要 + 英文源**（当前路线）：把 Yahoo + BBC 翻译/总结为中文，符合 A股用户阅读习惯
4. **微信小程序侧 RSS 聚合**：用 `https://rsshub.app/` 服务端代理（已测试端点，需评估合规）

## 模式切换

```bash
NEWS_SOURCE_MODE=mock  # 内置 mock 数据（开发）
NEWS_SOURCE_MODE=real  # 真实源（生产）
```

## Turso Schema 注意点

- **批量多语句执行失败**：`SCHEMA.split(';')` 一次性执行在 Turso 会 400（SQLite 本地 OK）。已改为逐条执行 + 容错。
- **参数类型严格**：`url: null` ✓，但需要 `Number(published_at)`；数组先 JSON.stringify。
- **CREATE INDEX IF NOT EXISTS**：单独执行成功，但 batch 会 400。

## 启动

```bash
export TURSO_DATABASE_URL="libsql://your-db.turso.io"
export TURSO_AUTH_TOKEN="eyJ..."
export NEWS_SOURCE_MODE=real
node server/src/index.js
# → http://localhost:9999/api/news
```