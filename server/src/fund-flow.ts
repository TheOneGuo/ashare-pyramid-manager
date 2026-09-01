// server/src/fund-flow.ts
// 资金流向（资金动态）真实数据聚合层 v3 —— 方案 A + B。
//
// A（板块增仓榜，细分概念板块）：腾讯 getRank?board_type=gn 概念板块（801 个），
//   主力净流入字段 zljlr(今日)/zljlr_d5(5日)/zljlr_d20(20日)（单位：万元）+ 领涨股 lzg。
//   四类资金按不同时间窗口取榜（代理口径，页面如实标注）：
//     共同增仓=今日 / 公募基金=5日 / 平准基金=20日 / 海外资金=5日。
// B（股票中意榜，各资金真实持仓）：季度披露（页面标注报告期）：
//     公募基金=基金重仓股（akshare 新浪源，经 akshare-service /hold?kind=fund）
//     海外资金=QFII 重仓股（/hold?kind=qfii）
//     平准基金=中央汇金系持股（东财 datacenter RPT_F10_EH_FREEHOLDERS）
//     共同增仓=概念板块领涨股（腾讯 lzg，日频真实）
//   不做"持仓→板块聚合"（用户明确拒绝 C 方案的过期聚合板块）。
//
// 口径事实（已核实，页面如实标注）：
//  - 沪深港通行业级持仓自 2024-08-16 起交易所停止披露 → 海外资金无日度行业分布，
//    保留北向日度成交（RPT_MUTUAL_DEAL_HISTORY MUTUAL_TYPE="005"）作为海外资金卡汇总。
//  - 基金/QFII/汇金持仓均为季报口径（滞后约 1 个月），页面标注报告期。
//
// 硬约束：真实模式失败返回 ok:false(502)，绝不静默回退 mock。

// ============= 类型（与 src/api/fundflow.ts 字段同名） =============
export type FundType = 'joint' | 'public_fund' | 'stabilization' | 'foreign';

export interface FundNode {
  type: FundType;
  name: string; // 共同增仓/公募基金/平准基金/海外资金
  emoji: string;
  colorKey: 'joint' | 'public' | 'stab' | 'foreign';
  totalPct: number; // 该窗口全概念主力净流入合计（亿）
}
export interface SectorNode {
  code: string;
  name: string; // 概念板块名（MLCC/高带宽存储器HBM/细胞免疫治疗/养老概念/腾讯云概念…）
  pct: number; // 该窗口净流入（亿，带符号）
  pct5d: number; // 对照窗口（亿）
  rank: number;
}
export interface StockItem {
  code: string;
  name: string;
  sector: string; // 概念板块名（领涨股）或 '—'
  pct: number; // 涨跌幅 %（领涨股）或 0（持仓股）
  rank: number;
  meta?: string; // 持股说明（报告期 · 增仓/新进/持股家数）
}
export interface SankeyEdge {
  fund: FundType;
  sectorCode: string;
  pct: number; // 净流入（亿，带符号）
}
export interface MetricInfo {
  label: string; // 口径文案
  unit: string; // '亿'
  notice?: string; // 口径/数据源说明
}
export interface NorthDay {
  date: string;
  dealAmtYi: number;
  dealNum: number;
  lead: string;
  leadZdf: number;
}
export interface NorthData {
  asOf: string;
  latest: NorthDay | null;
  series: NorthDay[];
}
export interface FundFlowResp {
  ok: boolean;
  source: string;
  asOf: string; // 'MM-DD'
  funds: FundNode[];
  metric: Record<FundType, MetricInfo>;
  north?: NorthData;
  sankey: { left: FundNode[]; right: SectorNode[]; edges: SankeyEdge[] };
  sectors: Record<FundType, SectorNode[]>; // 每类 top10 概念板块
  stocks: Record<FundType, StockItem[]>; // 每类 top10（各资金真实持仓/领涨股）
  error?: string;
}

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
    notice: '口径：全概念板块主力资金净流入（特大单+大单，腾讯财经·概念板块）。主力共识加仓 = 共同增仓。',
  },
  public_fund: {
    label: '近5日主力净流入（代理口径）',
    unit: '亿',
    notice: '板块榜：概念板块近5日主力净流入（代理观察口径，数值为真实资金数据）；股票榜：公募基金最新季报重仓股（按增仓优先排序）。',
  },
  stabilization: {
    label: '近20日主力净流入（代理口径）',
    unit: '亿',
    notice: '板块榜：概念板块近20日主力净流入（代理观察口径）；股票榜：中央汇金系最新季报持股。',
  },
  foreign: {
    label: '北向成交 + QFII季报',
    unit: '亿',
    notice: '行业级北向持仓自 2024-08-16 起交易所停止披露；板块榜用概念板块近5日主力净流入（代理口径），股票榜用 QFII 最新季报重仓股，卡汇总显示北向日度成交。',
  },
};

// ============= 通用 fetch =============
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' };
const PROVIDER = String(process.env.FUND_FLOW_PROVIDER || 'tencent').toLowerCase();
const AKSHARE_BASE = String(process.env.AKSHARE_BASE || 'http://127.0.0.1:8800').replace(/\/$/, '');

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

// ============= 概念板块（腾讯 gn，分页） =============
export interface TencentBoard {
  code: string;
  name: string;
  zljlr: number; // 今日主力净流入（万）
  zljlrD5: number;
  zljlrD20: number;
  leadCode: string;
  leadName: string;
  leadZdf: number;
}

// 非赛道概念黑名单（昨日涨停/次新股/破净/指数成分等不进入榜单，防止霸榜）
const CONCEPT_BLACKLIST = [
  '昨日', '涨停', '连板', '首板', '炸板', '触板', '次新股', '注册制次新', '新股', 'ST', '壳资源',
  '破净', '低价股', '高价股', '融资融券', '转融券', '沪股通', '深股通', '陆股通', 'MSCI', '标普',
  '富时罗素', 'AH股', 'B股', '三板', '退市', '风险警示', '高送转', '填权', '转债', '精选层',
  '举牌', '回购', '增持', '减持', '预盈', '预亏', '扭亏', '业绩预增', '业绩预降', '破发', '摘帽',
  '微盘股', '中字头', '上证50', '沪深300', '中证500', '央企', '国企改革', 'QFII重仓', '社保重仓',
  '基金重仓', '机构重仓', '汇金持股', '证金持股', '养老金持股', '百元股', '茅指数', '宁组合',
  '昨日较强', '昨日较弱', '强势股', '弱势股', '趋势股', '涨停梯队', '高股息', '低估值', '大盘股',
  '中盘股', '小盘股', '含可转债', '股权激励', '低价债', '高商誉', '送转', '北交所', '中概',
];

function isConceptBoard(name: string): boolean {
  return !CONCEPT_BLACKLIST.some((k) => name.includes(k));
}

export async function fetchTencentConceptBoards(): Promise<TencentBoard[]> {
  const out: TencentBoard[] = [];
  for (let offset = 0; offset < 900; offset += 100) {
    const url = `https://proxy.finance.qq.com/cgi/cgi-bin/rank/pt/getRank?board_type=gn&sort_type=price&direct=down&offset=${offset}&count=100`;
    const j = await withRetry(() => fetchJson(url, 12000));
    const list = (j && j.data && j.data.rank_list) || [];
    if (!Array.isArray(list) || list.length === 0) break;
    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    for (const it of list) {
      const name = String(it.name || '').trim();
      if (!name || !isConceptBoard(name)) continue;
      out.push({
        code: String(it.code || ''),
        name,
        zljlr: num(it.zljlr),
        zljlrD5: num(it.zljlr_d5),
        zljlrD20: num(it.zljlr_d20),
        leadCode: String(it.lzg?.code || ''),
        leadName: String(it.lzg?.name || ''),
        leadZdf: num(it.lzg?.zdf),
      });
    }
    if (list.length < 100) break;
  }
  if (out.length === 0) throw new Error('tencent concept boards empty');
  return out;
}

// ============= 各资金真实持仓 =============
// 基金重仓 / QFII 重仓（akshare 新浪源，经 akshare-service /hold，季报口径）
export interface HoldingItem {
  code: string;
  name: string;
  change: string; // 增仓/新进/不变/减仓
  chgNum: number; // 持股变动数值（股）
  report: string; // 'YYYYMMDD'
}

async function fetchHold(kind: 'fund' | 'qfii', limit = 60): Promise<HoldingItem[]> {
  const j = await withRetry(() => fetchJson(`${AKSHARE_BASE}/hold?kind=${kind}&limit=${limit}`, 20000));
  const list = (j && Array.isArray(j.items)) ? j.items : null;
  if (!list || list.length === 0) throw new Error(`akshare hold(${kind}) empty`);
  return list.map((it: any) => ({
    code: String(it['股票代码'] || '').padStart(6, '0'),
    name: String(it['股票简称'] || ''),
    change: String(it['持股变化'] || '不变'),
    chgNum: Number(it['持股变动数值']) || 0,
    report: String(j.report_date || ''),
  }));
}

export async function fetchFundHoldings(): Promise<HoldingItem[]> { return fetchHold('fund'); }
export async function fetchQfiiHoldings(): Promise<HoldingItem[]> { return fetchHold('qfii'); }

// 汇金系持股（东财 datacenter，季报口径）
export async function fetchHuijinHoldings(limit = 80): Promise<HoldingItem[]> {
  const name = encodeURIComponent('中央汇金资产管理有限责任公司');
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_EH_FREEHOLDERS&columns=ALL' +
    `&pageSize=${limit}&pageNumber=1&sortColumns=END_DATE&sortTypes=-1&source=WEB&client=WEB` +
    `&filter=(HOLDER_NAME%3D%22${name}%22)`;
  const j = await withRetry(() => fetchJson(url, 15000));
  const rows = (j && j.result && j.result.data) || [];
  if (!rows.length) throw new Error('huijin holdings empty');
  return rows.map((r: any) => ({
    code: String(r.SECURITY_CODE || '').padStart(6, '0'),
    name: String(r.SECURITY_NAME_ABBR || ''),
    change: String(r.HOLD_NUM_CHANGE || '不变'),
    chgNum: Number(r.HOLD_NUM_CHANGE_QUANTITY) || 0,
    report: String(r.END_DATE || '').slice(0, 10),
  }));
}

// 北向日度成交（东财 datacenter，保留）
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
      dealAmtYi: r.DEAL_AMT == null ? 0 : Math.round((Number(r.DEAL_AMT) / 100) * 100) / 100,
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

// 概念榜领涨股（共同增仓股票中意榜）
function leadStocksFor(boards: TencentBoard[], ordered: SectorNode[], n: number): StockItem[] {
  const byCode = new Map(boards.map((b) => [b.code, b]));
  const out: StockItem[] = [];
  const seen = new Set<string>();
  for (const s of ordered) {
    const b = byCode.get(s.code);
    if (!b || !b.leadName || seen.has(b.leadCode)) continue;
    seen.add(b.leadCode);
    out.push({
      code: b.leadCode,
      name: b.leadName,
      sector: b.name,
      pct: b.leadZdf,
      rank: out.length + 1,
      meta: '今日净流入前列概念领涨股',
    });
    if (out.length >= n) break;
  }
  return out;
}

// 持仓股 → StockItem（meta 标注报告期与变化）
function holdingsToStocks(items: HoldingItem[], n: number, fallbackLabel: string): StockItem[] {
  const sorted = [...items].sort((a, b) => {
    const prio = (c: string) => (c === '新进' ? 0 : c === '增仓' ? 1 : c === '不变' ? 2 : 3);
    const p = prio(a.change) - prio(b.change);
    return p !== 0 ? p : Math.abs(b.chgNum) - Math.abs(a.chgNum);
  });
  return sorted.slice(0, n).map((h, i) => ({
    code: h.code,
    name: h.name,
    sector: '—',
    pct: 0,
    rank: i + 1,
    meta: `${h.report || fallbackLabel} · ${h.change}${h.chgNum ? ` ${fmtWan(h.chgNum)}股` : ''}`,
  }));
}
function fmtWan(n: number): string {
  const w = n / 10000;
  return w >= 10000 ? `${(w / 10000).toFixed(1)}亿` : `${w.toFixed(0)}万`;
}

// ============= 主聚合（真实，方案 A+B） =============
export async function buildFundFlowReal(opts?: { dateStr?: string }): Promise<FundFlowResp> {
  const [boardsRes, fundRes, qfiiRes, hjRes, northRes] = await Promise.allSettled([
    fetchTencentConceptBoards(),
    fetchFundHoldings(),
    fetchQfiiHoldings(),
    fetchHuijinHoldings(),
    fetchNorthDaily(15),
  ]);
  if (boardsRes.status !== 'fulfilled' || boardsRes.value.length === 0) {
    const why = boardsRes.status === 'rejected' ? String((boardsRes.reason as Error)?.message || boardsRes.reason) : 'empty';
    throw new Error(`概念板块资金流不可用: ${why}`);
  }
  const boards = boardsRes.value;
  const fundHoldings = fundRes.status === 'fulfilled' ? fundRes.value : [];
  const qfiiHoldings = qfiiRes.status === 'fulfilled' ? qfiiRes.value : [];
  const hjHoldings = hjRes.status === 'fulfilled' ? hjRes.value : [];
  const north: NorthData | undefined = northRes.status === 'fulfilled' ? northRes.value : undefined;

  // 板块榜（A：概念主力净流入，四类窗口）
  const sectors: Record<FundType, SectorNode[]> = {
    joint: rankTop(boards, (b) => b.zljlr, 10, (b) => b.zljlrD5),
    public_fund: rankTop(boards, (b) => b.zljlrD5, 10, (b) => b.zljlrD20),
    stabilization: rankTop(boards, (b) => b.zljlrD20, 10, (b) => b.zljlrD5),
    foreign: rankTop(boards, (b) => b.zljlrD5, 10, (b) => b.zljlrD20),
  };

  // 股票榜（B：各资金真实持仓）
  const stocks: Record<FundType, StockItem[]> = {
    joint: leadStocksFor(boards, sectors.joint, 10),
    public_fund: holdingsToStocks(fundHoldings, 10, '最新季报'),
    stabilization: holdingsToStocks(hjHoldings, 10, '最新季报'),
    foreign: holdingsToStocks(qfiiHoldings, 10, '最新季报'),
  };

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

  // sankey：右列 = joint 今日概念 |净流入| 前 8；edges = 四类窗口真实概念边
  const right = sectors.joint.slice(0, 8).map((s) => ({ ...s }));
  const edges: SankeyEdge[] = [];
  for (const t of ['joint', 'public_fund', 'stabilization', 'foreign'] as FundType[]) {
    for (const s of sectors[t]) {
      if (!right.some((r) => r.code === s.code)) continue;
      edges.push({ fund: t, sectorCode: s.code, pct: s.pct });
    }
  }

  const isoLast = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const asOf = (north?.asOf || isoLast).slice(5);

  return {
    ok: true,
    source: PROVIDER === 'akshare' ? 'akshare(+fallback)' : 'tencent+eastmoney',
    asOf,
    funds,
    metric: { ...FUND_METRIC },
    north,
    sankey: { left: funds.map((f) => ({ ...f })), right, edges },
    sectors,
    stocks,
  };
}

// ============= mock 生成器（仅显式 FUND_FLOW_MODE=mock 时使用） =============
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
  '半导体', '存储芯片', 'AI算力', '机器人', '光伏设备', '电池', '风电设备', '电网设备',
  '稀土永磁', '贵金属', '军工电子', '通信设备', '计算机设备', '软件研发', '医疗器械',
  '化学制药', '证券', '白酒', '创新药', '消费电子',
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
  for (const m of FUND_META) {
    const totalPct = round2(randRange(rng, 0.8, 5.5));
    const picks = pickK(rng, universe, 3);
    const board: SectorNode[] = picks.map((name, i) => ({
      code: sectorCode(name),
      name,
      pct: round2(randRange(rng, -3.0, 3.0)),
      pct5d: round2(randRange(rng, -7.0, 5.0)),
      rank: i + 1,
    }));
    board.sort((a, b) => b.pct - a.pct);
    board.forEach((s, i) => (s.rank = i + 1));
    sectorsByFund[m.type] = board;
    board.forEach((s) => edgeList.push({ fund: m.type, sectorCode: s.code, pct: s.pct }));
    const stockBoard: StockItem[] = picks.map((name, i) => ({
      code: `6${String(10000 + i)}`,
      name: `${name}领涨`,
      sector: name,
      pct: round2(randRange(rng, 0.05, 20.0)),
      rank: i + 1,
    }));
    stocksByFund[m.type] = stockBoard;
    funds.push({ type: m.type, name: m.name, emoji: m.emoji, colorKey: m.colorKey, totalPct });
  }
  const rightArr = sectorsByFund.joint.map((s) => ({ ...s }));
  rightArr.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  rightArr.forEach((s, i) => (s.rank = i + 1));
  return {
    ok: true,
    source: 'mock',
    asOf,
    funds,
    metric: { ...FUND_METRIC },
    sankey: { left: funds.map((f) => ({ ...f })), right: rightArr, edges: edgeList },
    sectors: sectorsByFund as Record<FundType, SectorNode[]>,
    stocks: stocksByFund as Record<FundType, StockItem[]>,
  };
}
