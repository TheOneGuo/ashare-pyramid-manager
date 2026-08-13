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

// 规范化公告字段
function normalizeAnnouncement(raw) {
  if (!raw) return null;
  const code = (raw.codes && raw.codes[0]) || {};
  const art_code = raw.art_code;
  const title = raw.title || raw.secu_name || '(无标题)';
  const columns = (raw.columns || []).map((c) => c.column_name).filter(Boolean).join(' / ');
  const published_at = parseEasternTime(raw.display_time || raw.eiTime);
  return {
    source_channel: 'eastmoney_announcement',
    source_name: `东方财富·公告·${code.short_name || code.stock_code || ''}`.replace(/·$/, ''),
    guid: art_code ? `ann:${art_code}` : `ann:${code.stock_code}:${title}:${published_at}`,
    title: String(title).slice(0, 200),
    summary: columns || '',
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

// 拉公告详情（拿 PDF 链接）
async function fetchAnnouncementDetail(artCode) {
  if (!artCode) return null;
  const url = `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${encodeURIComponent(artCode)}&client_source=web&page_index=1`;
  const j = await fetchJson(url, { timeoutMs: 8_000 });
  const d = (j && j.data) || {};
  return {
    art_code: d.art_code,
    pdf_url: d.attach_url || (d.attach_list && d.attach_list[0] && d.attach_list[0].attach_url) || '',
    title: d.notice_title || '',
    eitime: d.eitime,
  };
}

// =====================================================
// 个股新闻 / 滚动资讯 API
// =====================================================

// 拉个股新闻流（实测试过，部分字段会因版本变动）
async function fetchStockNews(stockCode, { pageSize = 20 } = {}) {
  const secid = toEastmoneySecid(stockCode);
  if (!secid) return [];
  // 走"问财/快讯"接口：np-listapi 实际就是行情下面的新闻流
  // 实测：返回 {code,message,data:{list:[{art_code, title, digest, ptime, ...}]}}
  const params = new URLSearchParams({
    cb: '',
    client: 'pc',
    type: '1',
    mTypeAndCode: '',
    mNameAndCode: '',
    pageSize: String(Math.min(50, Math.max(1, pageSize))),
    pageIndex: '1',
    fields: '',
    secid,
  });
  const url = `https://np-listapi.eastmoney.com/comm/web/getListInfo?${params}`;
  try {
    const j = await fetchJson(url, { timeoutMs: 10_000 });
    const items = ((j && j.data && j.data.list) || []);
    return items.map((it) => normalizeStockNews(it, stockCode)).filter(Boolean);
  } catch (e) {
    // 兜底：搜公告/快讯接口
    return await fetchStockNewsFallback(stockCode, { pageSize });
  }
}

function normalizeStockNews(raw, stockCode) {
  if (!raw) return null;
  const title = raw.title || raw.subject || '(无标题)';
  const published_at = parseEasternTime(raw.ptime || raw.ShowTime || raw.display_time || raw.eitime);
  const art = raw.art_code || raw.info_code || raw.url || '';
  return {
    source_channel: 'eastmoney_stock_news',
    source_name: `东方财富·新闻·${stockCode}`,
    guid: art ? `news:${art}` : `news:${stockCode}:${title}:${published_at}`,
    title: String(title).slice(0, 200),
    summary: String(raw.digest || raw.summary || raw.content || '').slice(0, 400),
    link: art ? `https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(stockCode + ' ' + title)}` : '',
    published_at,
    raw: {
      art_code: art,
      stock_code: stockCode,
      columns: raw.columns || [],
      media_name: raw.media_name || raw.source || '',
    },
  };
}

// 兜底：搜索接口（按 stockCode 关键词搜最近 N 条）
async function fetchStockNewsFallback(stockCode, { pageSize = 20 } = {}) {
  const url = `https://search-api-web.eastmoney.com/search/jsonp?param=${encodeURIComponent(JSON.stringify({
    uid: '',
    keyword: stockCode,
    type: ['news'],
    pageIndex: 1,
    pageSize: Math.min(50, pageSize),
  }))}`;
  try {
    const j = await fetchJson(url, { timeoutMs: 10_000 });
    const news = (j && j.result && j.result.news) || [];
    return news.map((it) => ({
      source_channel: 'eastmoney_stock_news',
      source_name: `东方财富·新闻·${stockCode}`,
      guid: it.code ? `news:${it.code}` : `news:${stockCode}:${it.title}`,
      title: String(it.title || '').slice(0, 200),
      summary: String(it.content || '').slice(0, 400),
      link: it.url || '',
      published_at: parseEasternTime(it.date),
      raw: { art_code: it.code, stock_code: stockCode, media_name: it.media_name || '' },
    })).filter((it) => it.title);
  } catch {
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
  fetchStockNews,
  fetchF10MainFinIndicators,
};
