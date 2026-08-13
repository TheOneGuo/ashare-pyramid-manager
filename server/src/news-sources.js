/**
 * 真实新闻源适配器
 *
 * 策略：使用公开 RSS，零 API key
 *
 * 可用源（已实测）：
 * 1. Yahoo Finance RSS - https://finance.yahoo.com/news/rssindex ✅
 * 2. BBC Business RSS  - https://feeds.bbci.co.uk/news/business/rss.xml ✅
 * 3. Yahoo Finance (特定话题) - 多个 topic feed ✅
 *
 * 不可用源（2026-08 实测，已废弃）：
 * - Bing News RSS：服务端把 URL-encoded query 直接当作 raw 字节塞进 title，导致乱码
 * - Google News RSS：同上
 * - 新浪财经 7x24 API：返回 {code:11, msg:'sorry'} 锁 API
 * - 财联社电报 API：端点 404
 * - 巨潮资讯 cninfo：所有 column 返回空
 *
 * todo: 付费 API（如雪球、东方财富实时）；中文源用网页爬虫方案（待评估合规性）
 */
import { fetch } from 'undici';

// ========================================================================
// 通用 RSS 解析
// ========================================================================
function parseRSSItems(xml, sourceName, limit = 20) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'date') || extractTag(block, 'dc:date');
    const description = extractTag(block, 'description') || extractTag(block, 'summary');
    if (title) {
      items.push({
        id: `${sourceName}-${hashStr(link || title)}`,
        title: cleanText(title).slice(0, 200),
        summary: cleanText(description).slice(0, 280),
        url: link,
        source: sourceName,
        published_at: parseDate(pubDate),
        tags: [],
      });
    }
  }
  return items;
}

function extractTag(block, tag) {
  const tagName = tag.replace(/^[^:]+:/, '');
  const cdata = new RegExp(`<(?:[a-z]+:)?${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</(?:[a-z]+:)?${tagName}>`, 'i');
  const plain = new RegExp(`<(?:[a-z]+:)?${tagName}[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${tagName}>`, 'i');
  const m = block.match(cdata) || block.match(plain);
  return m ? m[1].trim() : '';
}

function cleanText(s) {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&hellip;/g, '…').replace(/&mdash;/g, '—')
    .trim();
}

function parseDate(s) {
  if (!s) return Date.now();
  const t = Date.parse(s);
  return isNaN(t) ? Date.now() : t;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// ========================================================================
// 数据源 1：Yahoo Finance 主 RSS
// ========================================================================
export async function fetchYahooMain() {
  try {
    const r = await fetch('https://finance.yahoo.com/news/rssindex', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRSSItems(xml, 'Yahoo Finance', 20);
  } catch (e) {
    console.warn('[yahoo-main] failed:', e.message);
    return [];
  }
}

// ========================================================================
// 数据源 2：BBC Business
// ========================================================================
export async function fetchBBCRSS() {
  try {
    const r = await fetch('https://feeds.bbci.co.uk/news/business/rss.xml', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRSSItems(xml, 'BBC Business', 20);
  } catch (e) {
    console.warn('[bbc] failed:', e.message);
    return [];
  }
}

// ========================================================================
// 数据源 3：Yahoo Finance Markets
// ========================================================================
export async function fetchYahooMarkets() {
  try {
    const r = await fetch('https://finance.yahoo.com/news/markets/rss', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRSSItems(xml, 'Yahoo Markets', 15);
  } catch (e) {
    console.warn('[yahoo-markets] failed:', e.message);
    return [];
  }
}

// ========================================================================
// 数据源 4：Yahoo Finance Stock Market News
// ========================================================================
export async function fetchYahooStocks() {
  try {
    const r = await fetch('https://finance.yahoo.com/topic/stock-market-news/rss', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRSSItems(xml, 'Yahoo Stocks', 15);
  } catch (e) {
    console.warn('[yahoo-stocks] failed:', e.message);
    return [];
  }
}

// ========================================================================
// 数据源 5：Yahoo Finance Crypto
// ========================================================================
export async function fetchYahooCrypto() {
  try {
    const r = await fetch('https://finance.yahoo.com/topic/crypto/rss', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRSSItems(xml, 'Yahoo Crypto', 10);
  } catch (e) {
    console.warn('[yahoo-crypto] failed:', e.message);
    return [];
  }
}

// ========================================================================
// 数据源 6：Hacker News（科技/财经相关）
// ========================================================================
export async function fetchHackerNews() {
  try {
    const r = await fetch('https://hnrss.org/newest?q=stock+OR+market+OR+economy&count=15', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRSSItems(xml, 'Hacker News', 15);
  } catch (e) {
    console.warn('[hn] failed:', e.message);
    return [];
  }
}

// ========================================================================
// 全部真实源
// ========================================================================
export const REAL_SOURCES = [
  { name: 'Yahoo Finance', fn: fetchYahooMain },
  { name: 'Yahoo Markets', fn: fetchYahooMarkets },
  { name: 'Yahoo Stocks', fn: fetchYahooStocks },
  { name: 'Yahoo Crypto', fn: fetchYahooCrypto },
  { name: 'BBC Business', fn: fetchBBCRSS },
  { name: 'Hacker News', fn: fetchHackerNews },
];

export async function fetchAllReal() {
  const results = await Promise.all(REAL_SOURCES.map(async (s) => {
    try {
      const items = await s.fn();
      return { source: s.name, items, err: null };
    } catch (e) {
      return { source: s.name, items: [], err: e.message };
    }
  }));

  const all = [];
  for (const r of results) {
    if (r.err) console.warn(`[real] ${r.source}: ${r.err}`);
    all.push(...r.items);
  }
  all.sort((a, b) => b.published_at - a.published_at);
  return all;
}