// macro-news.js — 宏观/产业链数据型新闻源（持仓间接关联用）
//
// 数据源：
//  1. 东方财富期货全市场行情 (m:114) — 拉取全部商品期货（金/油/铜/铝/锂/钢/镍/钴…）
//     每个品种生成一条"行情快照"新闻：品种名 + 现价 + 涨跌幅%，用于命中持仓产业链画像的上游原材料关键词。
//  2. 新浪滚动财经新闻 (feed.mix.sina.com.cn) — 中文宏观/市场新闻，作为持仓间接关联的宏观噪声源。
//
// 这些源不按持仓代码过滤（商品/地缘/政策新闻不会出现股票名），统一打标后由
// db.fetchNews 的持仓分支经 holding_profiles 关键词命中。
//
// 字符集 UTF-8。现货/运价（SMM/生意社/BDI）需授权或接口不稳定，暂以期货行情近似。

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

// 统一拉取所有宏观源
export async function fetchAllMacro() {
  const [comm, sina] = await Promise.all([
    fetchCommoditySnapshots().catch(() => []),
    fetchSinaRoll().catch(() => []),
  ]);
  return [...comm, ...sina];
}
