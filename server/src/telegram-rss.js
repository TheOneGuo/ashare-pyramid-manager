// telegram-rss.js — 移植自原项目 telegram_news.py
// 数据源：Telegram 公开频道 RSS（通过 RSSHub 代理 + t.me/s/ HTML 兜底）
// 频道：FinanceNewsDaily / 金十数据 (jin10data) / 华尔街见闻 (cnwallstreet)
//
// 关键点：
// - 7×24 全市场财经快讯（中文）
// - RSSHub 失败时回退到 t.me/s/{channel} HTML 解析
// - 解析时区使用 Asia/Shanghai
// - GUID 优先使用源 guid，否则用 link/title/summary hash
// - 4 档采集频率（交易时段 15min / 日间 1h / 夜间 4h / 休市日 8h）

import { XMLParser } from 'fast-xml-parser';
import crypto from 'node:crypto';
// 代理支持：Node 全局 fetch 不读 http_proxy 环境变量，t.me/rsshub 需走本地代理才能通。
// 用 undici 的 fetch + ProxyAgent（NEWS_PROXY_URL 显式指定，缺省回落到 https_proxy 环境变量）。
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const CHANNELS = [
  { channel: 'FinanceNewsDaily', name: '财经Daily' },
  { channel: 'jin10data', name: '金十数据' },
  { channel: 'cnwallstreet', name: '华尔街见闻' },
];

// 懒创建代理 dispatcher（无代理环境保持直连，行为不变）
let proxyDispatcher = undefined; // undefined = 未初始化; null = 不用代理
function getProxyDispatcher() {
  if (proxyDispatcher !== undefined) return proxyDispatcher;
  const proxyUrl = (process.env.NEWS_PROXY_URL || process.env.https_proxy || process.env.HTTPS_PROXY || '').trim();
  if (!proxyUrl) { proxyDispatcher = null; return null; }
  try {
    proxyDispatcher = new ProxyAgent(proxyUrl);
    console.log(`[telegram-rss] using proxy for t.me/rsshub: ${proxyUrl}`);
    return proxyDispatcher;
  } catch (e) {
    console.warn('[telegram-rss] ProxyAgent init failed, fallback direct:', e.message);
    proxyDispatcher = null;
    return null;
  }
}

// RSSHub 基础域名，可通过环境变量覆盖（多 base 备援）
function rssBaseUrls() {
  const raw = process.env.TELEGRAM_RSS_BASES || 'https://rsshub.app,https://rsshub.moeyy.cn';
  return String(raw)
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s.startsWith('https://'));
}

function feedUrlsForChannel(channel) {
  return rssBaseUrls().map((base) => `${base}/telegram/channel/${channel}`);
}

// 频道公开页 URL（RSSHub 失败时兜底）
const TELEGRAM_PAGE_URL = (channel) => `https://t.me/s/${channel}`;

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (AsharePyramid News Collector)',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

// 转义 HTML 实体 + 移除 HTML 标签
function stripHtml(s) {
  if (!s) return '';
  let t = String(s);
  // 解码常见实体（基础集，避免引入大库）
  t = t
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return ''; }
    });
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p\s*>/gi, '\n').replace(/<\/div\s*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

// 时间字符串解析（RFC822 / ISO8601）→ ms timestamp
function parseTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  return null;
}

// 解析 RSS 2.0 XML
function parseRssText(xmlText, sourceChannel, sourceName) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, parseTagValue: false });
  const json = parser.parse(xmlText);
  const channel = json.rss && json.rss.channel;
  if (!channel || !channel.item) return [];
  const items = Array.isArray(channel.item) ? channel.item : [channel.item];
  return items.map((item) => {
    const title = stripHtml(item.title || '');
    const link = typeof item.link === 'string' ? item.link : (item.link && item.link['#text']) || '';
    const summary = stripHtml(item.description || item.summary || item.content || '');
    const guid = item.guid ? String(item.guid['#text'] || item.guid) : '';
    const publishedRaw = item.pubDate || item.published || item.updated || '';
    const published_at = parseTime(publishedRaw);
    return {
      guid: guid || link || crypto.createHash('sha1').update(`${sourceChannel}|${title}|${summary}`).digest('hex'),
      title: title || '(无标题)',
      summary: summary || '',
      content: summary || '',
      link: link || '',
      published_at,
      raw: { title, summary, content: summary, link, published_at, fetch_mode: 'rss' },
    };
  });
}

// 解析 Atom XML
function parseAtomText(xmlText, sourceChannel, sourceName) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, parseTagValue: false });
  const json = parser.parse(xmlText);
  const feed = json.feed;
  if (!feed || !feed.entry) return [];
  const items = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
  return items.map((item) => {
    const title = stripHtml(item.title && (typeof item.title === 'string' ? item.title : item.title['#text']) || '');
    let link = '';
    if (item.link) {
      if (typeof item.link === 'string') link = item.link;
      else if (Array.isArray(item.link)) link = item.link[0]?.['@_href'] || '';
      else if (item.link['@_href']) link = item.link['@_href'];
    }
    const summary = stripHtml(item.summary || (item.content && (typeof item.content === 'string' ? item.content : item.content['#text'])) || '');
    const guid = item.id ? String(item.id) : '';
    const publishedRaw = item.published || item.updated || '';
    const published_at = parseTime(publishedRaw);
    return {
      guid: guid || link || crypto.createHash('sha1').update(`${sourceChannel}|${title}|${summary}`).digest('hex'),
      title: title || '(无标题)',
      summary: summary || '',
      content: summary || '',
      link: link || '',
      published_at,
      raw: { title, summary, content: summary, link, published_at, fetch_mode: 'rss' },
    };
  });
}

// 解析 RSS / Atom（自动判断）
function parseFeedText(xmlText, sourceChannel, sourceName) {
  if (/<\s*feed[\s>]/i.test(xmlText)) return parseAtomText(xmlText, sourceChannel, sourceName);
  if (/<\s*rss[\s>]/i.test(xmlText)) return parseRssText(xmlText, sourceChannel, sourceName);
  throw new Error('unsupported feed format');
}

// 解析 Telegram 公开页 HTML（RSSHub 失败兜底）
function parseTelegramPage(html, sourceChannel) {
  // 提取 message blocks: data-post + time + text
  // 简化：使用 split + 正则
  const out = [];
  const wrapRe = /<div class="tgme_widget_message_wrap[^"]*?">[\s\S]*?<div class="tgme_widget_message[^"]*?"\s+data-post="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  const timeRe = /<time[^>]*datetime="([^"]+)"/;
  const textRe = /<div class="tgme_widget_message_text[^"]*?js-message_text[^"]*?"[^>]*>([\s\S]*?)<\/div>/;
  const linkRe = /<a class="tgme_widget_message_date"\s+href="([^"]+)"/;

  let m;
  const seen = new Set();
  while ((m = wrapRe.exec(html))) {
    const post = m[1];
    const body = m[2];
    if (seen.has(post)) continue;
    const tm = timeRe.exec(body);
    if (!tm) continue;
    const published_at = parseTime(tm[1]);
    const tx = textRe.exec(body);
    const raw_text = stripHtml(tx ? tx[1] : '');
    if (!raw_text) continue;
    const lm = linkRe.exec(body);
    let link = lm ? lm[1] : `https://t.me/${post}`;
    if (link.startsWith('/')) link = 'https://t.me' + link;
    // 标题 = 首行（列表展示用）；content = 整帖全文（不砍行）；summary = 整帖（放宽上限）
    const lines = raw_text.split('\n').map((s) => s.trim()).filter(Boolean);
    const title = lines[0] || raw_text.slice(0, 80);
    const full = raw_text;
    out.push({
      guid: post,
      title: title.slice(0, 120),
      summary: full.slice(0, 4000),
      content: full,
      link,
      published_at,
      raw: { title, summary: full, content: full, link, published_at, fetch_mode: 'telegram_page', post },
    });
    seen.add(post);
  }
  return out;
}

// fetch 工具（带超时 + 编码 + 可选代理）
async function fetchText(url, accept) {
  const ctl = AbortSignal.timeout ? AbortSignal.timeout(20_000) : undefined;
  const dispatcher = getProxyDispatcher();
  const r = await undiciFetch(url, {
    headers: { ...REQUEST_HEADERS, Accept: accept },
    signal: ctl,
    ...(dispatcher ? { dispatcher } : {}),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // Telegram RSS 多为 UTF-8，但 rssHub 部分页面可能是 GBK——按 charset 决定
  const buf = await r.arrayBuffer();
  const ct = r.headers.get('content-type') || '';
  let charset = 'utf-8';
  const m = ct.match(/charset=([^;]+)/i);
  if (m) charset = m[1].trim().toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

// 单源采集：先 RSSHub → 失败回退到 t.me/s/
async function fetchOneSource(channelMeta, opts = {}) {
  const channel = channelMeta.channel;
  const name = channelMeta.name;
  const log = opts.log || (() => {});
  let lastErr = [];
  let items = [];
  let usedUrl = '';

  // 1) RSSHub 多 base 备援
  for (const url of feedUrlsForChannel(channel)) {
    usedUrl = url;
    try {
      const xml = await fetchText(url, 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1');
      items = parseFeedText(xml, channel, name);
      if (items.length > 0) break;
      lastErr.push(`${url}: empty feed`);
    } catch (e) {
      lastErr.push(`${url}: ${e.message}`);
    }
  }

  // 2) 兜底 t.me/s/
  if (items.length === 0) {
    const pageUrl = TELEGRAM_PAGE_URL(channel);
    usedUrl = pageUrl;
    try {
      const html = await fetchText(pageUrl, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      items = parseTelegramPage(html, channel);
      if (items.length === 0) lastErr.push(`${pageUrl}: page ok but no messages`);
    } catch (e) {
      lastErr.push(`${pageUrl}: ${e.message}`);
    }
  }

  return { channel, name, items, usedUrl, errors: lastErr };
}

export {
  CHANNELS,
  fetchOneSource,
  parseFeedText,
  parseTelegramPage,
  feedUrlsForChannel,
  TELEGRAM_PAGE_URL,
};
