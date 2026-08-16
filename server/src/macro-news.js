// macro-news.js — 宏观/产业链数据型新闻源（持仓间接关联用）
//
// 数据源：
//  1. 东方财富期货全市场行情 (m:114) — 拉取全部商品期货（金/油/铜/铝/锂/钢/镍/钴…）
//     每个品种生成一条"行情快照"新闻：品种名 + 现价 + 涨跌幅%，用于命中持仓产业链画像的上游原材料关键词。
//  2. 新浪滚动财经新闻 (feed.mix.sina.com.cn) — 中文宏观/市场新闻，作为持仓间接关联的宏观噪声源。
//  3. 波罗的海 BDI 运价指数（东方财富 secid=100.BDI）— 单一指数，命中"运价/航运/禁运"类关键词。
//  4. 证监会政策列表 (csrc.gov.cn common_list) — 抓标题/链接，命中"政策/监管"类关键词。
//
// 这些源不按持仓代码过滤（商品/地缘/政策新闻不会出现股票名），统一打标后由
// db.fetchNews 的持仓分支经 holding_profiles 关键词命中。
//
// 字符集 UTF-8。现货（SMM/生意社）需授权或接口不稳定，暂以期货行情近似。

const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://quote.eastmoney.com/',
};

const SINA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://finance.sina.com.cn/',
};

// 把 eastmoney 全市场期货行情转成新闻条目（命中原材料关键词即可关联持仓）
export async function fetchCommoditySnapshots({ limit = 300 } = {}) {
  try {
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${Math.min(500, limit)}&fs=m:114&fields=f12,f13,f14,f2,f3,f4`;
    const r = await fetch(url, { headers: EM_HEADERS });
    const j = await r.json();
    const diff = (j && j.data && j.data.diff) || {};
    const rows = Object.values(diff);
    const items = [];
    for (const row of rows) {
      const name = row.f14 || '';
      if (!name) continue;
      const price = Number(row.f2);
      const pct = Number(row.f3);
      if (!isFinite(price)) continue;
      const chgTxt = isFinite(pct) ? `${pct > 0 ? '+' : ''}${pct}%` : '';
      const title = `${name} 现价 ${price} (${chgTxt})`;
      items.push({
        source_channel: 'macro_commodity',
        source_name: '东方财富·商品期货',
        guid: `comm:${row.f12}`,
        title,
        summary: `${name}最新价 ${price}，涨跌幅 ${chgTxt}。`,
        content: `${name}（${row.f12}）最新价 ${price}，当日涨跌幅 ${chgTxt}。`,
        link: '',
        published_at: Date.now(),
        raw: { kind: 'commodity', code: row.f12, price, pct, name },
      });
    }
    return items;
  } catch (e) {
    console.warn('[macro] commodity fetch failed:', e.message?.slice(0, 80));
    return [];
  }
}

// 新浪滚动财经新闻（中文）
export async function fetchSinaRoll({ num = 30 } = {}) {
  try {
    const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&k=&num=${num}&r=1`;
    const r = await fetch(url, { headers: SINA_HEADERS });
    const j = await r.json();
    const list = (j && j.result && j.result.list) || [];
    const items = [];
    for (const it of list) {
      const title = (it.title || '').trim();
      if (!title) continue;
      const ctime = Number(it.ctime) || Math.floor(Date.now() / 1000);
      items.push({
        source_channel: 'macro_sina_roll',
        source_name: '新浪财经·滚动',
        guid: `sina:${it.id || it.url || title}`,
        title,
        summary: (it.intro || it.summary || '').slice(0, 400),
        content: (it.intro || it.summary || '').slice(0, 2000),
        link: it.url || '',
        published_at: ctime * 1000,
        raw: { kind: 'macro-news', url: it.url },
      });
    }
    return items;
  } catch (e) {
    console.warn('[macro] sina roll fetch failed:', e.message?.slice(0, 80));
    return [];
  }
}

// 波罗的海 BDI 运价指数（东方财富 secid=100.BDI）
export async function fetchBdiIndex() {
  try {
    const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=100.BDI&fields=f43,f57,f58,f169';
    const r = await fetch(url, { headers: EM_HEADERS });
    const j = await r.json();
    const d = j && j.data;
    if (!d || !d.f58) return [];
    const idx = Number(d.f43) / 100;
    const chg = Number(d.f169) / 100;
    const chgTxt = isFinite(chg) ? `${chg > 0 ? '+' : ''}${chg}%` : '';
    return [{
      source_channel: 'macro_bdi',
      source_name: '波罗的海BDI运价指数',
      guid: `bdi:${d.f57}`,
      title: `${d.f58} ${idx} (${chgTxt})`,
      summary: `${d.f58}最新 ${idx} 点，涨跌幅 ${chgTxt}。`,
      content: `${d.f58}（${d.f57}）最新 ${idx} 点，当日涨跌幅 ${chgTxt}。反映全球干散货运价，影响原材料海运成本与航运/禁运相关行业。`,
      link: '',
      published_at: Date.now(),
      raw: { kind: 'bdi', idx, chg },
    }];
  } catch (e) {
    console.warn('[macro] bdi fetch failed:', e.message?.slice(0, 80));
    return [];
  }
}

// 证监会政策列表（抓 HTML 列表的标题）
const CSRC_POLICY_URL = 'http://www.csrc.gov.cn/csrc/c100039/common_list_2.shtml';
export async function fetchCsrcPolicy({ num = 15 } = {}) {
  try {
    const r = await fetch(CSRC_POLICY_URL, { headers: EM_HEADERS });
    const html = await r.text();
    // 提取 <a ...>标题</a> 且 href 含 common 的条目
    const out = [];
    const re = /<a[^>]+href="([^"]*common[^"]*)"[^>]*>([^<]{4,60})<\/a>/g;
    let m; let n = 0;
    while ((m = re.exec(html)) && n < num) {
      const title = m[2].trim();
      if (!title) continue;
      out.push({
        source_channel: 'macro_policy_csrc',
        source_name: '证监会·政策解读',
        guid: `csrc:${m[1].slice(-40)}`,
        title,
        summary: title,
        content: `${title}（来源：中国证监会政策解读）`,
        link: m[1].startsWith('http') ? m[1] : 'http://www.csrc.gov.cn' + m[1],
        published_at: Date.now(),
        raw: { kind: 'policy', url: m[1] },
      });
      n++;
    }
    return out;
  } catch (e) {
    console.warn('[macro] csrc policy fetch failed:', e.message?.slice(0, 80));
    return [];
  }
}

// 统一拉取所有宏观源
export async function fetchAllMacro() {
  const [comm, sina, bdi, policy] = await Promise.all([
    fetchCommoditySnapshots().catch(() => []),
    fetchSinaRoll().catch(() => []),
    fetchBdiIndex().catch(() => []),
    fetchCsrcPolicy().catch(() => []),
  ]);
  return [...comm, ...sina, ...bdi, ...policy];
}
