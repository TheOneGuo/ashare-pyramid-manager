// server/src/fund-flow.ts
// 资金流向（资金动态）mock 生成器 —— 纯函数、固定种子、可测试。
// v1 全 mock：无实时数据源（FUND_FLOW_MODE=mock）。eastmoney/partner 仅预留模式位（见 index.js 501 分支）。
//
// 硬约束（PRD v1.1/v1.2 + DESIGN §5.1）：
//  - 响应禁止出现 locked / muted 字段（内容全开放，无合伙人锁定、无关闭动效）。
//  - 同 (dateStr, fund) 下，榜单 3 条板块 ⊆ sankey 右列节点（一致性，防数据自相矛盾）。
//  - 同 seed 两次调用输出深相等。

// ============= 类型（与 src/api/fundflow.ts 字段同名，前端从 TS 侧 import） =============
export type FundType = 'joint' | 'public_fund' | 'stabilization' | 'foreign';

export interface FundNode {
  type: FundType;
  name: string; // 共同增仓/公募基金/超级平准/超级外资
  emoji: string; // 🔀 / 💧 / 🌊 / 🔥
  colorKey: 'joint' | 'public' | 'stab' | 'foreign'; // → $fund-*
  totalPct: number; // 该类资金当日总增仓比例
}
export interface SectorNode {
  code: string; // 种子池伪代码（如 BK-SEMI），mock 用
  name: string; // 板块名
  pct: number; // 近1日增仓比例 %
  pct5d: number; // 近5日增仓比例 %
  rank: number; // 1|2|3（全局或资金内）
}
export interface StockItem {
  code: string;
  name: string;
  sector: string;
  pct: number; // 占比 %
  rank: number;
}
export interface SankeyEdge {
  fund: FundType;
  sectorCode: string;
  pct: number; // 强度(带符号)
}
export interface FundFlowResp {
  ok: boolean;
  source: 'mock' | 'eastmoney' | 'partner';
  asOf: string; // 'MM-DD' 最近交易日
  funds: FundNode[];
  sankey: { left: FundNode[]; right: SectorNode[]; edges: SankeyEdge[] };
  sectors: Record<FundType, SectorNode[]>; // 每类 3 条
  stocks: Record<FundType, StockItem[]>; // 每类 3 条
  error?: string;
}

// ============= 资金类型元数据 =============
const FUND_META: { type: FundType; name: string; emoji: string; colorKey: 'joint' | 'public' | 'stab' | 'foreign' }[] = [
  { type: 'joint', name: '共同增仓', emoji: '🔀', colorKey: 'joint' },
  { type: 'public_fund', name: '公募基金', emoji: '💧', colorKey: 'public' },
  { type: 'stabilization', name: '超级平准', emoji: '🌊', colorKey: 'stab' },
  { type: 'foreign', name: '超级外资', emoji: '🔥', colorKey: 'foreign' },
];
const FUND_TYPES: FundType[] = FUND_META.map((m) => m.type);

// ============= 种子池（真实行业/概念 + 真实个股，覆盖 8 大主题） =============
const SECTOR_POOL: string[] = [
  '半导体', '存储芯片', '半导体材料', '光学光电子', '消费电子', '电子元件',
  'AI算力', '机器人', '光伏设备', '电池', '风电设备', '电网设备', '电源设备',
  '稀土永磁', '能源金属', '贵金属', '工业金属', '航空装备', '航天航空', '军工电子',
  '船舶制造', '通用设备', '工业母机', '仪器仪表', '通信设备', '计算机设备',
  '软件研发', '医疗器械', '化学制药', '证券',
];

// 个股池：code / name / sector（sector 取自 SECTOR_POOL 中的项，保证板块映射一致）
const STOCK_POOL: { code: string; name: string; sector: string }[] = [
  { code: '688981', name: '中芯国际', sector: '半导体' },
  { code: '002371', name: '北方华创', sector: '半导体' },
  { code: '688041', name: '海光信息', sector: '半导体' },
  { code: '300308', name: '中际旭创', sector: 'AI算力' },
  { code: '300502', name: '新易盛', sector: 'AI算力' },
  { code: '000977', name: '浪潮信息', sector: 'AI算力' },
  { code: '002230', name: '科大讯飞', sector: 'AI算力' },
  { code: '300750', name: '宁德时代', sector: '电池' },
  { code: '002594', name: '比亚迪', sector: '电池' },
  { code: '601012', name: '隆基绿能', sector: '光伏设备' },
  { code: '300274', name: '阳光电源', sector: '风电设备' },
  { code: '600111', name: '北方稀土', sector: '稀土永磁' },
  { code: '601899', name: '紫金矿业', sector: '贵金属' },
  { code: '603993', name: '洛阳钼业', sector: '能源金属' },
  { code: '002460', name: '赣锋锂业', sector: '能源金属' },
  { code: '600760', name: '中航沈飞', sector: '航空装备' },
  { code: '600893', name: '航发动力', sector: '航空装备' },
  { code: '600118', name: '中国卫星', sector: '航天航空' },
  { code: '002025', name: '航天电器', sector: '军工电子' },
  { code: '600406', name: '国电南瑞', sector: '电网设备' },
  { code: '002028', name: '思源电气', sector: '电网设备' },
  { code: '601179', name: '中国西电', sector: '电源设备' },
  { code: '000837', name: '秦川机床', sector: '工业母机' },
  { code: '601882', name: '海天精工', sector: '工业母机' },
  { code: '300024', name: '机器人', sector: '机器人' },
  { code: '688111', name: '金山办公', sector: '软件研发' },
  { code: '600570', name: '恒生电子', sector: '软件研发' },
  { code: '000063', name: '中兴通讯', sector: '通信设备' },
  { code: '688008', name: '澜起科技', sector: '存储芯片' },
  { code: '002475', name: '立讯精密', sector: '消费电子' },
  { code: '688036', name: '传音控股', sector: '消费电子' },
  { code: '600276', name: '恒瑞医药', sector: '化学制药' },
];

// ============= PRNG（mulberry32，自实现，无依赖） =============
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

// FNV-1a 字符串 → 稳定整数种子
export function seedOf(dateStr: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ============= 最近 A 股交易日 =============
// 返回 'MM-DD'（PRD asOf 文案）。「近1日」= 上一交易日（排除周末，节假日表未接）。
export function lastTradingDay(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 返回完整 ISO 'YYYY-MM-DD'，用于种子（避免跨年同 MM-DD 碰撞）
function isoLastTradingDay(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ============= 工具 =============
function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
// 从数组无放回取 k 个（基于 rng 洗牌前缀）
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

// 板块伪代码（与 SECTOR_POOL 顺序绑定，稳定）
function sectorCode(name: string): string {
  const i = SECTOR_POOL.indexOf(name);
  return `BK${String(i + 1).padStart(3, '0')}`;
}

// ============= 主生成器 =============
export function buildFundFlow(opts?: { dateStr?: string }): FundFlowResp {
  const iso = opts?.dateStr && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateStr) ? opts.dateStr : isoLastTradingDay();
  const asOf = lastTradingDay(new Date(iso + 'T00:00:00'));
  const rng = mulberry32(seedOf(iso));

  // 1) 选定 sankey 右列「板块宇宙」K 个（6~9），所有资金榜单从中取子集 → 保证 榜单 ⊆ 右列
  const K = 6 + Math.floor(rng() * 4); // 6..9
  const universe = pickK(rng, SECTOR_POOL, K);

  // 2) 每只资金：总增仓比例 + 从 universe 取 3 个板块 + 3 只个股
  const funds: FundNode[] = [];
  const sectorsByFund: Record<string, SectorNode[]> = {};
  const stocksByFund: Record<string, StockItem[]> = {};
  const edgeList: SankeyEdge[] = [];

  // 右侧聚合（按板块累计净流入，用于 right 节点 pct 与全局排名）
  const rightAgg: Record<string, { name: string; net: number; pct5d: number }> = {};

  for (const m of FUND_META) {
    const totalPct = round2(randRange(rng, 0.8, 5.5));

    // 3 个板块（来自 universe）
    const picks = pickK(rng, universe, 3);
    const board: SectorNode[] = picks.map((name, i) => {
      const pct = round2(randRange(rng, -3.0, 3.0));
      const pct5d = round2(randRange(rng, -7.0, 5.0));
      // 聚合到 right
      if (!rightAgg[name]) rightAgg[name] = { name, net: 0, pct5d: 0 };
      rightAgg[name].net = round2(rightAgg[name].net + pct);
      // 该板块近5日取多只资金中的最大绝对值，避免恒为 0
      rightAgg[name].pct5d = round2(Math.max(Math.abs(rightAgg[name].pct5d), Math.abs(pct5d)) * Math.sign(pct5d || pct) || pct5d);
      // 边
      edgeList.push({ fund: m.type, sectorCode: sectorCode(name), pct });
      return { code: sectorCode(name), name, pct, pct5d, rank: i + 1 };
    });
    // 板块按 pct 降序排，rank 重排
    board.sort((a, b) => b.pct - a.pct);
    board.forEach((s, i) => (s.rank = i + 1));
    sectorsByFund[m.type] = board;

    // 3 只个股（优先取自该资金板块对应的个股，其次全池补充）
    const sectorNames = new Set(picks);
    const inSector = STOCK_POOL.filter((s) => sectorNames.has(s.sector));
    let stockPicks = pickK(rng, inSector, 3);
    if (stockPicks.length < 3) {
      const extra = pickK(rng, STOCK_POOL.filter((s) => !stockPicks.includes(s)), 3 - stockPicks.length);
      stockPicks = [...stockPicks, ...extra];
    }
    const stockBoard: StockItem[] = stockPicks.map((s, i) => ({
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

  // 3) sankey 右列 = universe（按聚合净流入绝对值全局排名 1..K）
  const rightArr = Object.values(rightAgg).map((v) => ({
    code: sectorCode(v.name),
    name: v.name,
    pct: v.net,
    pct5d: v.pct5d,
    rank: 0,
  }));
  rightArr.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  rightArr.forEach((s, i) => (s.rank = i + 1));

  const resp: FundFlowResp = {
    ok: true,
    source: 'mock',
    asOf,
    funds,
    sankey: {
      left: funds.map((f) => ({ ...f })),
      right: rightArr,
      edges: edgeList,
    },
    sectors: sectorsByFund as Record<FundType, SectorNode[]>,
    stocks: stocksByFund as Record<FundType, StockItem[]>,
  };
  return resp;
}
