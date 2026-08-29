// sina-live.js — 新浪财经 7×24 全球快讯（国内直连，不依赖代理）
//
// 背景：电报三源（t.me / RSSHub）在本网络直连被墙，需走代理且代理不稳定。
// 新浪 7×24 是同体量的 7×24 中文财经快讯流，接口国内直连秒通，作为主快讯源，
// 电报源降级为「代理可用时的补充源」。
//
// 接口：GET https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=50&zhibo_id=152&tag_id=0
// 返回 result.data.feed.list[]：{ id, rich_text, create_time, docurl, ext.stocks[] }
//
// 注意：create_time 是北京时间字符串，需按 +08:00 解析。

const FEED_URL = (page, size) => `https://zhibo.sina.com.cn/api/zhibo/feed?page=${page}&page_size=${size}&zhibo_id=152&tag_id=0`;

const CHANNEL_META = { channel: 'sina_724', name: '新浪7×24' };

// 简易 HTML 清理（rich_text 偶含 <a>/<b> 标签）
function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// "2026-08-29 20:13:44"（北京时间）→ ms
function parseBeijingTime(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace(' ', 'T') + '+08:00');
  return Number.isNaN(t) ? null : t;
}

// 拉一页快讯 → 标准化 items（与 telegram-rss 同构，直接走 upsertNewsItems）
export async function fetchSinaLive({ pageSize = 50, log = null } = {}) {
  // 调用方（news-collector refreshAll）默认传 console 对象而非函数，做归一化
  const say = typeof log === 'function' ? log : (log?.log && typeof log.log === 'function' ? log.log.bind(log) : () => {});
  const url = FEED_URL(1, Math.min(Math.max(pageSize, 1), 100));
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (AsharePyramid News Collector)',
      'Accept': 'application/json',
      'Referer': 'https://finance.sina.com.cn/7x24/',
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(15_000) : undefined,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const list = data?.result?.data?.feed?.list;
  if (!Array.isArray(list)) throw new Error('bad payload: no feed.list');

  const items = [];
  for (const it of list) {
    const text = stripHtml(it.rich_text);
    if (!text) continue;
    const id = Number(it.id);
    let link = String(it.docurl || '');
    if (!link) link = `https://finance.sina.com.cn/7x24/?id=${id}&zhibo_id=${it.zhibo_id || 152}`;
    // ext.stocks 带关联标的（含 A 股代码），留给持仓匹配用
    let stocks = [];
    try {
      const ext = typeof it.ext === 'string' ? JSON.parse(it.ext) : (it.ext || {});
      stocks = Array.isArray(ext.stocks) ? ext.stocks.map((s) => ({ market: s.market, symbol: s.symbol, key: s.key })) : [];
    } catch { /* ext 非法忽略 */ }
    items.push({
      guid: `sina_724:${id}`,
      title: text.length > 120 ? text.slice(0, 120) : text,
      summary: text.slice(0, 4000),
      content: text,
      link,
      published_at: parseBeijingTime(it.create_time) || Date.now(),
      raw: { fetch_mode: 'sina_live', stocks, tags: stripHtml(it.tag || '') },
    });
  }
  say(`[sina-live] fetched ${items.length} items`);
  return { channel: CHANNEL_META.channel, name: CHANNEL_META.name, items, usedUrl: url, errors: [] };
}

export { CHANNEL_META };
