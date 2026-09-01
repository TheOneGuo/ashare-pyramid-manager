// server/src/fund-flow.ts
// 资金流向（资金动态）真实数据聚合层。
//
// 数据源（2026-09-01 逐个在本机 curl 实测可达后才接入，拒绝臆测）：
//  1) 腾讯财经 proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank?board_type=hy
//     → 31 个申万一级/行业板块，自带资金流字段：
//        zljlr(今日主力净流入·万元) / zljlr_d5(5日) / zljlr_d20(20日) /
//        zllr(主力流入) / zllc(主力流出) / lzg(领涨股{code,name,zdf,zxj})
//  2) 东方财富数据中心 datacenter-web.eastmoney.com（本机 push2 系全被拦，datacenter 可达）
//     → RPT_MUTUAL_DEAL_HISTORY (MUTUAL_TYPE="005" 北向合计)：
//        TRADE_DATE / DEAL_AMT(成交总额·百万元) / DEAL_NUM(成交笔数) / LEAD_STOCKS_NAME / LS_CHANGE_RATE
//        注意：FUND_INFLOW/NET_DEAL_AMT 自 2024-08 披露改制后为 null（交易所不再披露净买入）。
//
// 口径事实（已核实，页面如实标注，绝不标"示意"）：
//  - 沪深港通行业级持仓（日度/季度）自 2024-08-16 起交易所停止披露 → 海外资金无行业分布，
//    仅保留交易所仍公开的日度成交总额/笔数序列。
//  - 公募基金行业配置（季报）与汇金系持仓（季报前十大持有人）无公开可编程接口
//    → 以真实的主力净流入 5日/20日 作为代理观察口径，页面明确标注"代理口径"。
//
// 硬约束（PRD v1.1/v1.2 + DESIGN §5.1）：
//  - 响应禁止出现 locked / muted 字段；不出现"示意/mock"文案标注（mock 仅限显式 FUND_FLOW_MODE=mock）。
//  - 真实模式失败时返回 ok:false + error（502），绝不静默回退 mock 数据。

// ============= 类型（与 src/api/fundflow.ts 字段同名，前端从 TS 侧 import） =============
export type FundType = 'joint' | 'public_fund' | 'stabilization' | 'foreign';

export interface FundNode {
  type: FundType;
  name: string; // 共同增仓/公募基金/平准基金/海外资金
  emoji: string; // 🔀 / 💧 / 🌊 / 🔥
  colorKey: 'joint' | 'public' | 'stab' | 'foreign'; // → $fund-*（已映射到既有色板）
  totalPct: number; // 该口径全行业净流入合计（亿）
}
export interface SectorNode {
  code: string; // 腾讯板块代码（pt01801120 等，不透明 id）
  name: string; // 板块名
  pct: number; // 该口径净流入（亿，带符号）
  pct5d: number; // 对照窗口净流入（亿）
  rank: number; // 1..10（资金内排名）
}
export interface StockItem {
  code: string;
  name: string;
  sector: string; // 所属行业（领涨股所属板块名）
  pct: number; // 领涨股当日涨跌幅 %
  rank: number;
}
export interface SankeyEdge {
  fund: FundType;
  sectorCode: string;
  pct: number; // 净流入（亿，带符号）
}
export interface MetricInfo {
  label: string; // 口径文案（如"今日主力净流入"）
  unit: string; // '亿'
  notice?: string; // 口径/停披说明（真实披露事实）
}
export interface NorthDay {
  date: string; // 'YYYY-MM-DD'
  dealAmtYi: number; // 成交总额（亿）
  dealNum: number; // 成交笔数
  lead: string; // 领涨股名
  leadZdf: number; // 领涨股涨跌幅 %
}
export interface NorthData {
  asOf: string;
  latest: NorthDay | null;
  series: NorthDay[]; // 近 N 日（新→旧）
}
export interface FundFlowResp {
  ok: boolean;
  source: string; // 'tencent+eastmoney'（真实）| 'mock'
  asOf: string; // 'MM-DD' 主线数据日期
  funds: FundNode[];
  metric: Record<FundType, MetricInfo>;
  north?: NorthData;
  sankey: { left: FundNode[]; right: SectorNode[]; edges: SankeyEdge[] };
  sectors: Record<FundType, SectorNode[]>; // 每类 top10（foreign 为空 → 前端渲染 north 榜）
  stocks: Record<FundType, StockItem[]>; // 每类 top10 领涨股（foreign 为空）
  error?: string;
}

// ============= 资金类型元数据 =============
const FUND_META: { type: FundType; name: string; emoji: string; colorKey: 'joint' | 'public' | 'stab' | 'foreign' }[] = [
  { type: 'joint', name: '共同增仓', emoji: '🔀', colorKey: 'joint' },
  { type: 'public_fund', name: '公募基金', emoji: '💧', colorKey: 'public' },
  { type: 'stabilization', name: '平准基金', emoji: '🌊', colorKey: 'stab' },
  { type: 'foreign', name: '海外资金', emoji: '🔥', colorKey: 'foreign' },
];

export const FUND_METRIC: Record<FundType, MetricInfo> = {
  joint: {
    label: '今日主力净流入',
    unit: '亿',
    notice: '口径：全行业主力资金净流入（特大单+大单，腾讯财经·行业板块）。主力共识加仓 = 共同增仓。',
  },
  public_fund: {
    label: '近5日主力净流入（代理口径）',
    unit: '亿',
    notice: '公募基金行业配置按季报披露（季度频率）且无公开接口；暂以近5日主力资金净流入作为代理观察口径，数值为真实资金数据。',
  },
  stabilization: {
    label: '近20日主力净流入（代理口径）',
    unit: '亿',
    notice: '汇金系持仓按季报前十大持有人披露（季度频率）且无公开接口；暂以近20日主力资金净流入作为代理观察口径，数值为真实资金数据。',
  },
  foreign: {
    label: '北向日度成交',
    unit: '亿',
    notice: '沪深港通行业级持仓自 2024-08-16 起交易所停止披露（日度与季度均停）；当前展示交易所仍公开的北向日度成交总额与成交笔数。',
  },
};

// ============= 数据源选择 =============
// FUND_FLOW_PROVIDER=tencent（默认，Node 直连腾讯行业板块 + 东财北向）| akshare（经 akshare-service :8800）
// | mock（仅显式 FUND_FLOW_MODE=mock 时由 index.js 走固定种子调试，真实模式绝不回退）
const PROVIDER = String(process.env.FUND_FLOW_PROVIDER || 'tencent').toLowerCase();
const AKSHARE_BASE = String(process.env.AKSHARE_BASE || 'http://127.0.0.1:8800').replace(/\/$/, '');

// ============= 通用 fetch =============
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' };

async function fetchJson(url: string, timeoutMs = 12000): Promise<any> {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function withRetry<T>(fn: () => Promise<T>, tries = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

// ============= 3) akshare-service provider =============
// akshare-service 内部优先 akshare 接口（板块资金流走 push2 被拦时服务内回退腾讯 getRank），
// 返回 {source, window20, items[]}，items 字段恒为 zljlr/zljlr_d5/zljlr_d20（akshare 源时 d20 实为 10 日，
// 由 window20='10日' 标注；净额单位统一=万元）。北向不在本端点，由 fetchAkshareNorthDaily 兜底。
export async function fetchAkshareSectorFlow(): Promise<{ boards: TencentBoard[]; north?: NorthData; window20: string; source: string }> {
  const j = await withRetry(() => fetchJson(`${AKSHARE_BASE}/sector-flow`, 15000));
  const list = (j && Array.isArray(j.items)) ? j.items : null;
  if (!list || list.length === 0) {
    throw new Error(`akshare-service /sector-flow 不可用: ${j?.error || 'empty'}`);
  }
  const boards: TencentBoard[] = list.map((b: any) => ({
    code: String(b.code || ''),
    name: String(b.name || '').trim(),
    zljlr: Number(b.zljlr) || 0,
    zljlrD5: Number(b.zljlr_d5) || 0,
    zljlrD20: Number(b.zljlr_d20) || 0, // akshare 源时此处为 10 日口径（window20='10日'）
    window20: String(j.window20 || '20日'),
    leadCode: String(b.lead_code || ''),
    leadName: String(b.lead_name || ''),
    leadZdf: Number(b.lead_zdf) || 0,
  }));
  return { boards, window20: String(j.window20 || '20日'), source: String(j.source || 'akshare-service') };
}

// ============= 1) 腾讯行业板块资金流 =============
export interface TencentBoard {
  code: string;
  name: string;
  zljlr: number; // 今日主力净流入（万）
  zljlrD5: number; // 5日（万）
  zljlrD20: number; // 20日（万，akshare 源可能为 10日）
  window20: string; // '20日' | '10日'
  leadCode: string;
  leadName: string;
  leadZdf: number; // 领涨股涨跌幅 %
}

export async function fetchTencentBoards(): Promise<TencentBoard[]> {
  const url = 'https://proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank?board_type=hy&sort_type=price&direct=down&offset=0&count=50';
  const j = await withRetry(() => fetchJson(url, 12000));
  const list = (j && j.data && j.data.rank_list) || [];
  if (!Array.isArray(list) || list.length === 0) throw new Error('tencent getRank empty');
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return list.map((it: any) => ({
    code: String(it.code || ''),
    name: String(it.name || '').trim(),
    zljlr: num(it.zljlr),
    zljlrD5: num(it.zljlr_d5),
    zljlrD20: num(it.zljlr_d20),
    window20: '20日',
    leadCode: String(it.lzg?.code || ''),
    leadName: String(it.lzg?.name || ''),
    leadZdf: num(it.lzg?.zdf),
  }));
}

// 北向兜底：sector-flow 未带 north 时单独拉 akshare-service /north-daily
async function fetchAkshareNorthDaily(): Promise<NorthData> {
  const j = await withRetry(() => fetchJson(`${AKSHARE_BASE}/north-daily?limit=15`, 15000));
  const list = (j && Array.isArray(j.items)) ? j.items : null;
  if (!list || list.length === 0) throw new Error('akshare north-daily empty');
  const series: NorthDay[] = list.map((it: any) => ({
    date: String(it.date || '').slice(0, 10),
    dealAmtYi: Number(it.dealAmtYi) || 0,
    dealNum: Number(it.dealNum) || 0,
    lead: String(it.lead || ''),
    leadZdf: Number(it.leadZdf) || 0,
  })).filter((d: NorthDay) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
  if (!series.length) throw new Error('akshare north-daily no rows');
  return { asOf: series[0].date, latest: series[0], series };
}

// ============= 2) 东财北向日度成交 =============
export async function fetchNorthDaily(days = 15): Promise<NorthData> {
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEAL_HISTORY&columns=ALL' +
    '&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=' + days + '&pageNumber=1&source=WEB&client=WEB' +
    '&filter=' + encodeURIComponent('(MUTUAL_TYPE="005")');
  const j = await withRetry(() => fetchJson(url, 12000));
  const rows = (j && j.result && j.result.data) || [];
  const series: NorthDay[] = rows
    .map((r: any) => ({
      date: String(r.TRADE_DATE || '').slice(0, 10),
      dealAmtYi: r.DEAL_AMT == null ? 0 : Math.round((Number(r.DEAL_AMT) / 100) * 100) / 100, // 百万 → 亿
      dealNum: r.DEAL_NUM == null ? 0 : Number(r.DEAL_NUM),
      lead: String(r.LEAD_STOCKS_NAME || ''),
      leadZdf: r.LS_CHANGE_RATE == null ? 0 : Math.round(Number(r.LS_CHANGE_RATE) * 100) / 100,
    }))
    .filter((d: NorthDay) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
  if (!series.length) throw new Error('north daily empty');
  return { asOf: series[0].date, latest: series[0], series };
}

// ============= 聚合 =============
const WAN2YI = 1 / 10000; // 万 → 亿
function r2(v: number): number { return Math.round(v * 100) / 100; }

function rankTop(boards: TencentBoard[], pick: (b: TencentBoard) => number, n: number, alt: (b: TencentBoard) => number): SectorNode[] {
  return boards
    .map((b) => ({ b, v: pick(b) }))
    .sort((x, y) => y.v - x.v)
    .slice(0, n)
    .map((x, i) => ({
      code: x.b.code,
      name: x.b.name,
      pct: r2(x.v * WAN2YI),
      pct5d: r2(alt(x.b) * WAN2YI),
      rank: i + 1,
    }));
}

function leadStocksFor(boards: TencentBoard[], ordered: SectorNode[], n: number): StockItem[] {
  const byCode = new Map(boards.map((b) => [b.code, b]));
  const out: StockItem[] = [];
  const seen = new Set<string>();
  for (const s of ordered) {
    const b = byCode.get(s.code);
    if (!b || !b.leadName || seen.has(b.leadCode)) continue;
    seen.add(b.leadCode);
    out.push({ code: b.leadCode, name: b.leadName, sector: b.name, pct: b.leadZdf, rank: out.length + 1 });
    if (out.length >= n) break;
  }
  return out;
}

// ============= 主聚合（真实） =============
export async function buildFundFlowReal(opts?: { dateStr?: string }): Promise<FundFlowResp> {
  let window20 = '20日';
  let source = 'tencent+eastmoney';
  let boards: TencentBoard[] = [];
  let north: NorthData | undefined;

  if (PROVIDER === 'akshare') {
    // akshare-service :8800：一次调用拿 boards+north+window20；sector-flow 未带北向时单独兜底
    const r = await fetchAkshareSectorFlow(); // 失败即抛错 → 上游 502，绝不回退 mock
    boards = r.boards;
    window20 = r.window20;
    source = r.source;
    north = r.north;
    if (!north) {
      try { north = await fetchAkshareNorthDaily(); } catch { north = undefined; }
    }
  } else {
    const [boardsRes, northRes] = await Promise.allSettled([fetchTencentBoards(), fetchNorthDaily(15)]);
    if (boardsRes.status !== 'fulfilled' || boardsRes.value.length === 0) {
      const why = boardsRes.status === 'rejected' ? String((boardsRes.reason as Error)?.message || boardsRes.reason) : 'empty';
      throw new Error(`行业板块资金流数据不可用(provider=${PROVIDER}): ${why}`);
    }
    boards = boardsRes.value;
    north = northRes.status === 'fulfilled' ? northRes.value : undefined;
  }
  if (!boards.length) throw new Error(`行业板块资金流数据不可用(provider=${PROVIDER}): empty`);

  // 口径标签按实际窗口动态生成（akshare 源 10日窗口时如实标注）
  const metric: Record<FundType, MetricInfo> = { ...FUND_METRIC };
  if (window20 === '10日') {
    metric.stabilization = { ...metric.stabilization, label: '近10日主力净流入（代理口径）' };
  }

  // 各口径 top10（真实数值，亿）
  const sectors: Record<FundType, SectorNode[]> = {
    joint: rankTop(boards, (b) => b.zljlr, 10, (b) => b.zljlrD5),
    public_fund: rankTop(boards, (b) => b.zljlrD5, 10, (b) => b.zljlrD20),
    stabilization: rankTop(boards, (b) => b.zljlrD20, 10, (b) => b.zljlrD5),
    foreign: [], // 行业级北向持仓已停披 → 前端渲染 north 成交热度榜
  };
  const stocks: Record<FundType, StockItem[]> = {
    joint: leadStocksFor(boards, sectors.joint, 10),
    public_fund: leadStocksFor(boards, sectors.public_fund, 10),
    stabilization: leadStocksFor(boards, sectors.stabilization, 10),
    foreign: [],
  };

  // funds 卡合计（各口径全行业求和，亿）
  const sumOf = (pick: (b: TencentBoard) => number) => r2(boards.reduce((acc, b) => acc + pick(b) * WAN2YI, 0));
  const funds: FundNode[] = FUND_META.map((m) => ({
    type: m.type,
    name: m.name,
    emoji: m.emoji,
    colorKey: m.colorKey,
    totalPct:
      m.type === 'joint' ? sumOf((b) => b.zljlr)
      : m.type === 'public_fund' ? sumOf((b) => b.zljlrD5)
      : m.type === 'stabilization' ? sumOf((b) => b.zljlrD20)
      : north?.latest?.dealAmtYi ?? 0,
  }));

  // sankey：右列 = joint 口径 |净流入| 前 8 行业；edges = joint/public/stab 三口径的真实行业边
  const right = sectors.joint.slice(0, 8).map((s) => ({ ...s }));
  const edges: SankeyEdge[] = [];
  for (const t of ['joint', 'public_fund', 'stabilization'] as FundType[]) {
    for (const s of sectors[t]) {
      if (!right.some((r) => r.code === s.code)) continue;
      edges.push({ fund: t, sectorCode: s.code, pct: s.pct });
    }
  }

  // asOf：优先北向最新交易日，否则最近交易日
  const isoLast = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const asOfSrc = north?.asOf || isoLast;
  const asOf = asOfSrc.slice(5).replace('-', '-');

  return {
    ok: true,
    source,
    asOf,
    funds,
    metric,
    north,
    sankey: {
      left: funds.map((f) => ({ ...f })),
      right,
      edges,
    },
    sectors,
    stocks,
  };
}

// ============= mock 生成器（仅显式 FUND_FLOW_MODE=mock 时使用） =============
// 保留原固定种子实现供开发调试；真实模式绝不回退到此。

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(dateStr: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SECTOR_POOL: string[] = [
  '半导体', '存储芯片', '半导体材料', '光学光电子', '消费电子', '电子元件',
  'AI算力', '机器人', '光伏设备', '电池', '风电设备', '电网设备', '电源设备',
  '稀土永磁', '能源金属', '贵金属', '工业金属', '航空装备', '航天航空', '军工电子',
  '船舶制造', '通用设备', '工业母机', '仪器仪表', '通信设备', '计算机设备',
  '软件研发', '医疗器械', '化学制药', '证券',
];

export function lastTradingDay(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoLastTradingDay(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function pickK<T>(rng: () => number, arr: T[], k: number): T[] {
  const n = Math.min(k, arr.length);
  const idx = arr.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }
  return idx.slice(0, n).map((i) => arr[i]);
}
function sectorCode(name: string): string {
  const i = SECTOR_POOL.indexOf(name);
  return `BK${String(i + 1).padStart(3, '0')}`;
}

export function buildFundFlow(opts?: { dateStr?: string }): FundFlowResp {
  const iso = opts?.dateStr && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateStr) ? opts.dateStr : isoLastTradingDay();
  const asOf = lastTradingDay(new Date(iso + 'T00:00:00'));
  const rng = mulberry32(seedOf(iso));

  const K = 6 + Math.floor(rng() * 4);
  const universe = pickK(rng, SECTOR_POOL, K);

  const funds: FundNode[] = [];
  const sectorsByFund: Record<string, SectorNode[]> = {};
  const stocksByFund: Record<string, StockItem[]> = {};
  const edgeList: SankeyEdge[] = [];
  const rightAgg: Record<string, { name: string; net: number; pct5d: number }> = {};

  for (const m of FUND_META) {
    const totalPct = round2(randRange(rng, 0.8, 5.5));
    const picks = pickK(rng, universe, 3);
    const board: SectorNode[] = picks.map((name, i) => {
      const pct = round2(randRange(rng, -3.0, 3.0));
      const pct5d = round2(randRange(rng, -7.0, 5.0));
      if (!rightAgg[name]) rightAgg[name] = { name, net: 0, pct5d: 0 };
      rightAgg[name].net = round2(rightAgg[name].net + pct);
      rightAgg[name].pct5d = round2(Math.max(Math.abs(rightAgg[name].pct5d), Math.abs(pct5d)) * Math.sign(pct5d || pct) || pct5d);
      edgeList.push({ fund: m.type, sectorCode: sectorCode(name), pct });
      return { code: sectorCode(name), name, pct, pct5d, rank: i + 1 };
    });
    board.sort((a, b) => b.pct - a.pct);
    board.forEach((s, i) => (s.rank = i + 1));
    sectorsByFund[m.type] = board;

    const sectorNames = new Set(picks);
    void sectorNames;
    const stockPool = SECTOR_POOL.map((name, i) => ({ code: `6${String(10000 + i)}`, name: `${name}领涨`, sector: name }));
    const stockBoard: StockItem[] = pickK(rng, stockPool, 3).map((s, i) => ({
      code: s.code,
      name: s.name,
      sector: s.sector,
      pct: round2(randRange(rng, 0.05, 20.0)),
      rank: i + 1,
    }));
    stockBoard.sort((a, b) => b.pct - a.pct);
    stockBoard.forEach((s, i) => (s.rank = i + 1));
    stocksByFund[m.type] = stockBoard;

    funds.push({ type: m.type, name: m.name, emoji: m.emoji, colorKey: m.colorKey, totalPct });
  }

  const rightArr = Object.values(rightAgg).map((v) => ({
    code: sectorCode(v.name),
    name: v.name,
    pct: v.net,
    pct5d: v.pct5d,
    rank: 0,
  }));
  rightArr.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  rightArr.forEach((s, i) => (s.rank = i + 1));

  return {
    ok: true,
    source: 'mock',
    asOf,
    funds,
    metric: { ...FUND_METRIC },
    sankey: {
      left: funds.map((f) => ({ ...f })),
      right: rightArr,
      edges: edgeList,
    },
    sectors: sectorsByFund as Record<FundType, SectorNode[]>,
    stocks: stocksByFund as Record<FundType, StockItem[]>,
  };
}
