// eastmoney.js — 东方财富公告 + 个股新闻 API 采集
// 用法：仅对"持仓标的"采集（caller 负责传股票代码列表）
//
// 来源：
// - 公告列表：https://np-anotice-stock.eastmoney.com/api/security/ann?stock_list=600519&page_size=20
// - 公告详情：https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=AN202608131827923094
// - 个股新闻：https://np-listapi.eastmoney.com/comm/web/getListInfo?secid=1.600519
//
// 注意：
// - 股票代码格式：沪市 = 1.600xxx，深市 = 0.000xxx
// - 本模块不存储；只产出结构化 item，由调用方入库
// - 字符集 UTF-8（实测正确）

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://data.eastmoney.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

// 股票代码 → 东财 secid
// 沪市 6xxxxx, 9xxxxx, 5xxxxx → 1.xxxxxx
// 深市 0xxxxx, 3xxxxx, 2xxxxx → 0.xxxxxx
// 北交所 4xxxxx, 8xxxxx → 0.xxxxxx（实测）
function toEastmoneySecid(code) {
  if (!code) return null;
  const c = String(code).padStart(6, '0');
  if (/^(6|9|5)/.test(c)) return `1.${c}`;
  return `0.${c}`;
}

// 通用 fetch（带超时）
async function fetchJson(url, opts = {}) {
  const ctl = AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || 15_000) : undefined;
  const r = await fetch(url, { headers: HEADERS, signal: ctl });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

// =====================================================
// 公告 API
// =====================================================

// 拉取单只 / 批量股票的最新公告
// stock_list 支持 "600519,000001" 形式
async function fetchAnnouncements(stockList, { pageSize = 20, beginTime = null, endTime = null } = {}) {
  const codes = Array.isArray(stockList) ? stockList.join(',') : String(stockList);
  const params = new URLSearchParams({
    sr: '-1',                     // -1 倒序
    page_size: String(Math.min(50, Math.max(1, pageSize))),
    page_index: '1',
    ann_type: 'A',                // A=全部
    client_source: 'web',
    stock_list: codes,
    f_node: '0',
    s_node: '0',
  });
  if (beginTime) params.set('begin_time', String(beginTime));
  if (endTime) params.set('end_time', String(endTime));

  const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?${params}`;
  const j = await fetchJson(url, { timeoutMs: 12_000 });
  const list = (j.data && j.data.list) || [];
  return list.map(normalizeAnnouncement).filter(Boolean);
}

// 剥离东财标题里冗余的「证券简称:」前缀（接口返回的 title 已带 证券简称:）
function stripNamePrefix(title, shortName) {
  if (!title) return title;
  // 形如「贵州茅台:贵州茅台关于...」→「贵州茅台关于...」
  const m = /^([\u4e00-\u9fa5A-Za-z0-9]+):(.+)$/.exec(title);
  if (m && shortName && m[1] === shortName && m[2].startsWith(shortName)) {
    return m[2]; // 首段 == 简称 且 后半也以简称开头 → 去掉整段前缀
  }
  if (m && m[1] === m[2].slice(0, m[1].length)) {
    return m[2];
  }
  return title;
}

// 规范化公告字段
function normalizeAnnouncement(raw) {
  if (!raw) return null;
  const code = (raw.codes && raw.codes[0]) || {};
  const art_code = raw.art_code;
  const rawTitle = raw.title || raw.secu_name || '(无标题)';
  const title = stripNamePrefix(String(rawTitle), code.short_name);
  const columns = (raw.columns || []).map((c) => c.column_name).filter(Boolean).join(' / ');
  const published_at = parseEasternTime(raw.display_time || raw.eiTime);
  return {
    source_channel: 'eastmoney_announcement',
    source_name: `东方财富·公告·${code.short_name || code.stock_code || ''}`.replace(/·$/, ''),
    guid: art_code ? `ann:${art_code}` : `ann:${code.stock_code}:${title}:${published_at}`,
    title: title.slice(0, 200),
    summary: columns || '',
    content: '',
    link: art_code ? `https://data.eastmoney.com/notices/detail/${code.market_code || '1'}/${code.stock_code || ''},${art_code}.html` : '',
    published_at,
    raw: {
      art_code,
      stock_code: code.stock_code,
      short_name: code.short_name,
      columns,
      notice_date: raw.notice_date,
      attach_url: '', // 详情接口补
    },
  };
}

// 拉公告详情（拿公告正文 + PDF 链接）
// 返回 { content, pdf_url, notice_title, eitime }
async function fetchAnnouncementDetail(artCode) {
  if (!artCode) return null;
  const url = `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${encodeURIComponent(artCode)}&client_source=web&page_index=1`;
  const j = await fetchJson(url, { timeoutMs: 8_000 });
  const d = (j && j.data) || {};
  const content = d.notice_content || '';
  return {
    content,
    pdf_url: d.attach_url || (d.attach_list && d.attach_list[0] && d.attach_list[0].attach_url) || '',
    notice_title: d.notice_title || '',
    eitime: d.eitime,
  };
}

// 给一条公告补正文 + PDF（调用详情接口），返回带 content/summary/link 的新 item
async function enrichAnnouncement(item) {
  const artCode = item?.raw?.art_code;
  if (!artCode) return item;
  try {
    const d = await fetchAnnouncementDetail(artCode);
    if (!d) return item;
    const content = d.content || '';
    return {
      ...item,
      content,
      summary: (item.summary || '').trim() || (content ? content.slice(0, 200) : ''),
      raw: {
        ...item.raw,
        attach_url: d.pdf_url || item.raw?.attach_url || '',
        notice_title: d.notice_title || '',
        eitime: d.eitime,
      },
      link: d.pdf_url ? d.pdf_url : item.link,
    };
  } catch (e) {
    return item; // 详情失败不影响标题/摘要入库
  }
}

// =====================================================
// 个股新闻 / 滚动资讯 API
// =====================================================
// 2026-08 调研：东财 np-listapi.eastmoney.com/comm/web/getListInfo 已废弃，
// 任何 mTypeAndCode 返回 data={}；search-api-web 现在 400。
// 改用 Yahoo Finance RSS by symbol（feeds.finance.yahoo.com）
// — 4 只持仓实测 2-20 条/股，稳定 200，UTF-8。
// 英文新闻暂时直存（source 标 "Yahoo Finance · {code}" 让用户知道是英文）。

// 股票代码 → Yahoo symbol
// 沪 6/9/5/7xxxxx → .SS；深 0/2/3xxxxx → .SZ；北交 4/8xxxxx → .SS(实测)
function toYahooSymbol(code) {
  if (!code) return null;
  const c = String(code).padStart(6, '0');
  if (/^(6|9|5|7)/.test(c)) return `${c}.SS`;
  return `${c}.SZ`;
}

function yahooExtractTag(block, tag) {
  const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(r);
  return m ? m[1].trim() : '';
}

function yahooCleanText(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&hellip;/g, '…').replace(/&mdash;/g, '—')
    .trim();
}

function parseYahooRss(xml, stockCode, limit = 20) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const title = yahooCleanText(yahooExtractTag(block, 'title'));
    const link = yahooExtractTag(block, 'link');
    const pubDate = yahooExtractTag(block, 'pubDate') || yahooExtractTag(block, 'dc:date');
    const desc = yahooCleanText(yahooExtractTag(block, 'description'));
    if (!title) continue;
    items.push({
      source_channel: `eastmoney_stock_news_${stockCode}`,
      source_name: `Yahoo Finance · ${stockCode}`,
      guid: link ? `yahoo:${stockCode}:${hashStr(link)}` : `yahoo:${stockCode}:${hashStr(title)}`,
      title: title.slice(0, 200),
      summary: desc.slice(0, 400),
      link: link || '',
      published_at: parseYahooDate(pubDate),
      raw: { source: 'yahoo-finance', symbol: toYahooSymbol(stockCode), stock_code: stockCode },
    });
  }
  return items;
}

function parseYahooDate(s) {
  if (!s) return Date.now();
  const t = Date.parse(s);
  return isNaN(t) ? Date.now() : t;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// 拉个股新闻（Yahoo Finance RSS by symbol，替代东财 np-listapi）
async function fetchStockNews(stockCode, { pageSize = 20 } = {}) {
  const sym = toYahooSymbol(stockCode);
  if (!sym) return [];
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=US&lang=en-US`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseYahooRss(xml, stockCode, Math.min(50, Math.max(1, pageSize)));
  } catch (e) {
    console.warn(`[eastmoney.stockNews ${stockCode}] failed:`, e.message);
    return [];
  }
}

// =====================================================
// F10 财报数据（简版：主要财务指标）
// =====================================================

// 拉主要财务指标（按 REPORT_DATE 最新）
async function fetchF10MainFinIndicators(stockCode) {
  const secid = toEastmoneySecid(stockCode);
  if (!secid) return null;
  // 尝试 EMDATA F10 接口
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_GINCOMEPROD&columns=ALL&filter=(SECUCODE%3D%22${encodeURIComponent(stockCode + (secid.startsWith('1.') ? '.SH' : '.SZ'))}%22)&pageNumber=1&pageSize=4&reportName=RPT_F10_FINANCE_GINCOMEPROD`;
  try {
    const j = await fetchJson(url, { timeoutMs: 10_000 });
    const rows = (j && j.result && j.result.data) || [];
    return { stock_code: stockCode, indicator_rows: rows.slice(0, 4), fetched_at: Date.now() };
  } catch {
    return null;
  }
}

// =====================================================
// 工具
// =====================================================

// 解析东方财富时间字符串 "2026-08-13 21:26:22:245" → ms
function parseEasternTime(value) {
  if (!value) return null;
  // 截掉冒号后的毫秒部分
  const s = String(value).replace(/:\d{3}$/, '').replace(/\s+$/, '');
  const d = new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : '+08:00'));
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

export {
  toEastmoneySecid,
  fetchAnnouncements,
  fetchAnnouncementDetail,
  enrichAnnouncement,
  fetchStockNews,
  fetchF10MainFinIndicators,
};
