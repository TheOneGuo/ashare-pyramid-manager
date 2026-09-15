/**
 * 正金字塔 ATR 自适应交易策略引擎
 *
 * 原 Python 实现：heatmap_app/pyramid_atr_engine.py (PRD V4.0 / V4.1)
 * 移植版：uni-app 端 (TypeScript)
 *
 * 关键不变式：
 * - 首笔止损 = p0 - 3×ATR
 * - 自适应系数 k = clamp((ATR% - 1.5) / (5.0 - 1.5), 0, 1)
 * - 全仓止损 [5%, 8%]；主板加仓间隔 [10%, 12%]；科创/创业 [15%, 20%]
 * - 四档止盈 1.58×~1.92× 首笔价
 * - 完整 A 股费率：佣金(最低5) + 过户费(双向) + 印花税(卖出)
 * - 每手：主板 100 / 科创板 200
 */

// ============================================================================
// 常量
// ============================================================================

export const LOT = 100;
export const LOT_STAR = 200;
export const REMAIN_LO = 0.06;
export const REMAIN_HI = 0.10;
export const MAX_INVEST = 0.94;
export const MIN_INVEST = 0.90;

export const K_ATR_LO = 1.5;
export const K_ATR_HI = 5.0;

export const STOP_LO_PCT = 0.05;
export const STOP_HI_PCT = 0.08;

export const GAP_LO_PCT = 0.10;
export const GAP_HI_PCT = 0.12;
export const GAP20_ADD_LO = 0.05;
export const GAP20_ADD_HI = 0.08;

export const TP_PCT: Array<[number, number]> = [
  [1.58, 1.62],
  [1.68, 1.72],
  [1.78, 1.82],
  [1.88, 1.92],
];

export const ATR_PCT_LO = 1.5;
export const ATR_PCT_HI = 5.0;
export const IDLE_DAYS = 14;

export const MIN_COMMISSION = 5.0;
export const TRANSFER_FEE_WAN = 0.1;
export const STAMP_TAX_WAN = 5.0;
export const FEE_MODEL_VERSION = 'v4-full';

// ============================================================================
// 工具函数
// ============================================================================

/** 按市场返回每手股数：科创板 200 股，其余 100 股 */
export function lotSize(code: string | null | undefined): number {
  const c = String(code ?? '').trim();
  return c.startsWith('688') || c.startsWith('689') ? LOT_STAR : LOT;
}

/** 是否 ±20% 板（创业板/科创板） */
export function is20PctBoard(code: string | null | undefined): boolean {
  const c = String(code ?? '').trim();
  return (
    c.startsWith('300') ||
    c.startsWith('301') ||
    c.startsWith('688') ||
    c.startsWith('689')
  );
}

/** 向下圆整到分 */
export function r2(x: number): number {
  return Math.round((x + 1e-9) * 100) / 100;
}

/** 向上进位到分 */
export function ceil2(x: number): number {
  return Math.ceil(x * 100 - 1e-9) / 100;
}

function rate(wan: number): number {
  return wan / 10000;
}

// ============================================================================
// 自适应映射
// ============================================================================

/** 自适应系数 k：波动越大越接近 1 */
export function adaptiveK(atrPct: number): number {
  const a = Number(atrPct);
  if (Number.isNaN(a)) return 0.0;
  return Math.max(0, Math.min(1, (a - K_ATR_LO) / (K_ATR_HI - K_ATR_LO)));
}

/** 全仓止损百分比 */
export function stopLossPct(k: number): number {
  return STOP_LO_PCT + k * (STOP_HI_PCT - STOP_LO_PCT);
}

/** 加仓间隔百分比区间 */
export function gapRange(
  k: number,
  is20: boolean = false,
): { lo: number; hi: number } {
  // 防御：k 为 NaN/Infinity 时会让「加仓间距」整体变 NaN，进而污染全部档位价格
  const kk = Number.isFinite(k) ? k : 0;
  let lo = GAP_LO_PCT;
  let hi = GAP_HI_PCT;
  if (is20) {
    lo += GAP20_ADD_LO;
    hi += GAP20_ADD_HI;
  }
  const v = lo + kk * (hi - lo);
  return {
    lo: v,
    hi: v, // 单点返回（与 Python 版一致）
  };
}

/** 四档止盈价（相对首笔开仓价） */
export function tpPrices(p0: number, k: number): number[] {
  const p = Number.isFinite(p0) ? p0 : 0;
  const kk = Number.isFinite(k) ? k : 0;
  return TP_PCT.map(([lo, hi]) => r2(p * (lo + kk * (hi - lo))));
}

// ============================================================================
// A 股费率模型（PRD V4.0）
// ============================================================================

/** 单笔券商佣金 */
export function commission(amount: number, feeWan: number, minC = true): number {
  const a = Number(amount);
  if (a <= 0) return 0;
  const c = a * rate(feeWan);
  return minC ? Math.max(c, MIN_COMMISSION) : c;
}

/** 买入端总费用 = 佣金 + 过户费 */
export function buyFee(amount: number, feeWan: number, minC = true): number {
  const a = Number(amount);
  if (a <= 0) return 0;
  return commission(a, feeWan, minC) + a * rate(TRANSFER_FEE_WAN);
}

/** 卖出端总费用 = 佣金 + 过户费 + 印花税 */
export function sellFee(amount: number, feeWan: number, minC = true): number {
  const a = Number(amount);
  if (a <= 0) return 0;
  return (
    commission(a, feeWan, minC) +
    a * rate(TRANSFER_FEE_WAN + STAMP_TAX_WAN)
  );
}

/** 买入实际资金占用 */
export function buyCost(amount: number, feeWan: number, minC = true): number {
  return Number(amount) + buyFee(amount, feeWan, minC);
}

/** 卖出实际到账 */
export function sellNet(amount: number, feeWan: number, minC = true): number {
  return Number(amount) - sellFee(amount, feeWan, minC);
}

/** 求最小卖出成交额 A，使 sell_net(A) >= cost */
export function breakevenAmount(
  cost: number,
  feeWan: number,
  minC = true,
): number {
  const c = Number(cost);
  if (c <= 0) return 0;
  const r = rate(feeWan);
  const t = rate(TRANSFER_FEE_WAN);
  const s = rate(STAMP_TAX_WAN);
  const denomFull = 1 - r - t - s;
  if (denomFull <= 0) return Infinity;
  const a1 = c / denomFull;
  if (!minC) return a1;
  if (a1 * r >= MIN_COMMISSION) return a1;
  const a2 = (c + MIN_COMMISSION) / (1 - t - s);
  if (a2 * r < MIN_COMMISSION) return a2;
  return Math.max(a1, r > 0 ? MIN_COMMISSION / r : a1);
}

/** 保本价（向上进位到分） */
export function breakevenPrice(
  cost: number,
  shares: number,
  feeWan: number,
  minC = true,
): number {
  const s = Number(shares ?? 0);
  if (s <= 0) return 0;
  return ceil2(breakevenAmount(cost, feeWan, minC) / s);
}

/** 手续费率校验 */
export function validateFeeRate(
  feeWan: number,
): { ok: boolean; level: 'ok' | 'warn_low' | 'warn_high' | 'hard'; msg: string } {
  const f = Number(feeWan);
  if (Number.isNaN(f)) {
    return { ok: false, level: 'hard', msg: '请输入有效的手续费费率' };
  }
  if (f < 0.1 || f > 10) {
    return {
      ok: false,
      level: 'hard',
      msg: '手续费费率需在万分之0.1至千分之1之间，请重新输入',
    };
  }
  if (f < 0.5)
    return {
      ok: true,
      level: 'warn_low',
      msg: '您输入的手续费率低于万分之0.5，请核对是否正确，确认后可继续使用',
    };
  if (f > 3)
    return {
      ok: true,
      level: 'warn_high',
      msg: '您输入的手续费率高于万分之3，请核对是否正确，确认后可继续使用',
    };
  return { ok: true, level: 'ok', msg: '' };
}

// ============================================================================
// 资金分配
// ============================================================================

export function maxHoldingCount(totalCapital: number): number {
  if (totalCapital < 100_000) return 1;
  if (totalCapital < 300_000) return 2;
  if (totalCapital < 600_000) return 3;
  if (totalCapital < 1_000_000) return 4;
  return 5;
}

export const ALLOC_ADJUST_PCT = 20.0;
export const SMALL_ACCOUNT_LIMIT = 100_000.0;

export interface AllocBounds {
  suggest: number;
  lo: number;
  hi: number;
  adjustable: boolean;
  available: number;
  adjust_pct: number;
  reason: string;
}

export function allocBounds(
  totalCapital: number,
  allocatedSum: number,
  heldCount: number,
  isLast: boolean,
): AllocBounds {
  const total = Number(totalCapital || 0);
  const available = r2(Math.max(total - Number(allocatedSum || 0), 0));
  const maxN = maxHoldingCount(total);
  const remainCap = Math.max(total - allocatedSum, 0);
  const remainN = Math.max(maxN - heldCount, 1);
  let suggest: number;
  let adj: number;
  if (isLast) {
    suggest = r2(remainCap);
    adj = 0;
  } else {
    const base = remainCap / remainN;
    suggest = r2(base);
    adj = r2(base * (ALLOC_ADJUST_PCT / 100));
  }
  let reason = '';
  let adjustable = true;
  if (total < SMALL_ACCOUNT_LIMIT) {
    adjustable = false;
    suggest = available;
    reason = '账户总保证金低于10万元：按规则只计算1个标的，且不支持±20%调整。';
  } else if (isLast) {
    adjustable = false;
    reason = '最后一个标的按可分配余额全额兜底，不再做±20%调整。';
  }
  let lo: number;
  let hi: number;
  if (!adjustable || adj <= 0) {
    lo = hi = r2(Math.min(suggest, available));
  } else {
    lo = r2(Math.max(suggest - adj, 0));
    hi = r2(Math.min(suggest + adj, available));
    if (lo > hi) lo = hi;
  }
  return {
    suggest: r2(Math.min(suggest, available)),
    lo,
    hi,
    adjustable: Boolean(adjustable && hi > lo),
    available,
    adjust_pct: ALLOC_ADJUST_PCT,
    reason,
  };
}

// ============================================================================
// ATR 计算
// ============================================================================

export interface Bar {
  high: number;
  low: number;
  prev_close?: number;
  close?: number;
}

/** 14 日简单平均 ATR（需 ≥15 条 bar） */
export function computeAtr14(bars: Bar[]): number | null {
  if (!bars || bars.length < 15) return null;
  const seg = bars.slice(-15).slice(1);
  const trs: number[] = [];
  for (const b of seg) {
    // 防御：部分数据源会给出 null/缺失的 prev_close，或脏数据 NaN。
    // 一旦 NaN 进入 trs，Math.max 会把 NaN 传播到 ATR，再扩散到整个加仓方案。
    const prevRaw = b.prev_close ?? b.close ?? 0;
    if (!Number.isFinite(b.high) || !Number.isFinite(b.low) || !Number.isFinite(prevRaw)) continue;
    const tr = Math.max(
      b.high - b.low,
      Math.abs(b.high - prevRaw),
      Math.abs(b.low - prevRaw),
    );
    if (!Number.isFinite(tr)) continue;
    trs.push(tr);
  }
  if (!trs.length) return null;
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

// ============================================================================
// 加仓方案计算（V4.1 核心）
// ============================================================================

export interface PlanRow {
  batch: number;
  shares: number;
  price: number;
  amount: number;
  pct: number;
  stop: number;
}

export interface TpRow {
  tier: number;
  price: number;
  cut_shares: number;
  remain_shares: number;
  dynamic_stop: number | null;
}

export interface PlanResult {
  ok: boolean;
  too_expensive?: boolean;
  atr_pct?: number;
  notices: string[];
  ratio_note?: string;
  rows?: PlanRow[];
  tp_rows?: TpRow[];
  total_invest?: number;
  remain?: number;
  remain_pct?: number;
  remain_ok?: boolean;
  degraded?: boolean;
  turnover?: number;
  fee_total?: number;
  fee_model?: string;
  capital?: number;
  adjust_pct?: number;
  overspend?: boolean;
  stop_loss_pct?: number;
  gap_pct?: number;
}

function geoPrices(p0: number, gap: number): number[] {
  return Array.from({ length: 4 }, (_, i) => r2(p0 * Math.pow(1 + gap, i)));
}

function investV41(
  prices: number[],
  base: number[],
  x: number,
  lot: number,
  feeWan: number,
): number {
  let total = 0;
  for (let i = 0; i < prices.length; i++) {
    const shares = base[i] * x * lot;
    if (shares <= 0) continue;
    total += buyCost(shares * prices[i], feeWan);
  }
  return total;
}

interface LotsBest {
  mult: number[];
  prices: number[];
  g: number;
  x: number;
  remain: number;
}

function lotsPlanV41(
  capital: number,
  p0: number,
  gLo: number,
  gHi: number,
  lot: number,
  feeWan: number,
): { mult: number[] | null; prices: number[]; notices: string[]; ratioNote: string } {
  if (capital <= 0 || p0 <= 0) {
    return { mult: null, prices: [], notices: ['价格或资金非法'], ratioNote: '' };
  }
  const base = [4, 3, 2, 1];
  const n = base.length;
  let best: LotsBest | null = null;
  let bestKey: [number, number, number] | null = null;
  const steps = Math.max(1, Math.round((gHi - gLo) / 0.0025));
  for (let s = 0; s <= steps; s++) {
    const g = gLo + ((gHi - gLo) * s) / steps;
    const prices = geoPrices(p0, g);
    const sUnit = base.reduce((acc, q, i) => acc + q * prices[i], 0) * lot;
    if (sUnit <= 0) continue;
    const budget = Math.max(capital * 0.92 - n * MIN_COMMISSION, 0);
    const unitRate = 1 + rate(feeWan) + rate(TRANSFER_FEE_WAN);
    const xIdeal = budget / (sUnit * unitRate);
    for (const x of [Math.floor(xIdeal), Math.floor(xIdeal) + 1]) {
      if (x <= 0) continue;
      const inv = investV41(prices, base, x, lot, feeWan);
      if (inv > capital * MAX_INVEST + 1e-9) continue;
      const remain = 1 - inv / capital;
      const inBand =
        remain >= REMAIN_LO - 1e-9 && remain <= REMAIN_HI + 1e-9 ? 1.0 : 0.0;
      const key: [number, number, number] = [
        -inBand,
        Math.abs(remain - 0.08),
        Math.abs(remain - 0.08),
      ];
      if (bestKey === null || key < bestKey) {
        bestKey = key;
        best = {
          mult: base.map((q) => q * x),
          prices,
          g,
          x,
          remain,
        };
      }
    }
  }
  if (best === null) {
    return {
      mult: null,
      prices: geoPrices(p0, gLo),
      notices: ['价格过高'],
      ratioNote: '',
    };
  }
  const notices: string[] = [];
  if (best.remain > REMAIN_HI + 1e-9) {
    notices.push('资金利用率偏低，剩余资金高于10%');
  }
  if (best.remain < REMAIN_LO - 1e-9) {
    notices.push('已优先保证不超支');
  }
  const ratioNote =
    gHi - gLo > 1e-9
      ? '加仓间隔已按波动率在允许区间内自适应取值'
      : '按固定间隔计算';
  return { mult: best.mult, prices: best.prices, notices, ratioNote };
}

/** 核心计算（V4.1） */
export function computePlan(
  p0: number,
  atr: number,
  capital: number,
  feeWan: number,
  adjustPct: number = 0,
  code: string = '',
): PlanResult {
  // 输入净化（对抗性场景）：NaN / Infinity 会沿
  //   ATR% → 自适应 K → 加仓间距 → 各档价格/仓位 → 总投资
  // 一路传导，最终让整个方案静默变成 NaN（界面拿到 NaN 后表现为空白或错乱）。
  // 算法层统一把非有限数退化为 0 —— 业务合法性由调用方校验，这里只保证「绝不吐 NaN」。
  p0 = Number.isFinite(p0) ? p0 : 0;
  atr = Number.isFinite(atr) ? atr : 0;
  capital = Number.isFinite(capital) ? capital : 0;
  feeWan = Number.isFinite(feeWan) ? feeWan : 0;

  let adj = Number(adjustPct || 0);
  if (Number.isNaN(adj)) adj = 0;
  adj = Math.max(-ALLOC_ADJUST_PCT, Math.min(ALLOC_ADJUST_PCT, adj));
  let cap = capital * (1 + adj / 100);
  const notices: string[] = [];
  const atrPct = p0 > 0 ? (atr / p0) * 100 : 0;
  if (atrPct < ATR_PCT_LO) {
    notices.push(
      `标的波动率过低（ATR%=${atrPct.toFixed(2)}%），趋势性较弱，仍可生成方案但建议谨慎参与`,
    );
  } else if (atrPct > ATR_PCT_HI) {
    notices.push(
      `标的波动率过高（ATR%=${atrPct.toFixed(2)}%），单日波动风险较大，仍可生成方案但建议控制仓位`,
    );
  }
  const k = adaptiveK(atrPct);
  const lot = lotSize(code);
  const s1 = stopLossPct(k);
  const { lo: gLo, hi: gHi } = gapRange(k, is20PctBoard(code));
  const { mult, prices, notices: ln, ratioNote } = lotsPlanV41(
    cap,
    p0,
    gLo,
    gHi,
    lot,
    feeWan,
  );
  notices.push(...ln.filter((x) => x !== '价格过高'));
  if (mult === null) {
    return {
      ok: false,
      too_expensive: true,
      notices: notices.concat([
        '此标的价格过高，当前分配资金无法按规则开出完整4笔仓位，建议更换标的；更换后重新计算。',
      ]),
      degraded: false,
    };
  }
  const n = prices.length;
  const rows: PlanRow[] = [];
  const stopSeq: number[] = [];
  let cumShares = 0;
  let prevStop = 0;
  for (let i = 0; i < n; i++) {
    const shares = mult[i] * lot;
    cumShares += shares;
    let cumCost = 0;
    for (let q = 0; q <= i; q++) {
      cumCost += buyCost(mult[q] * lot * prices[q], feeWan);
    }
    const be = breakevenPrice(cumCost, cumShares, feeWan);
    let stop: number;
    if (i === 0) {
      stop = r2(p0 * (1 - s1));
    } else {
      stop = r2(Math.max(prices[i] * (1 - s1), be, prevStop));
    }
    prevStop = stop;
    stopSeq.push(stop);
    rows.push({
      batch: i + 1,
      shares,
      price: prices[i],
      amount: r2(shares * prices[i]),
      pct: cap ? r2((shares * prices[i] / cap) * 100) : 0,
      stop,
    });
  }
  const turnover = rows.reduce((acc, r) => acc + r.amount, 0);
  const totalInvest = rows.reduce((acc, r) => acc + buyCost(r.amount, feeWan), 0);
  const feeTotal = totalInvest - turnover;
  const remain = cap - totalInvest;
  const remainPct = cap ? (remain / cap) * 100 : 0;
  if (remain < 0) {
    notices.push('总投入超出该标的分配资金，请增加该标的分配资金或更换标的');
  }
  const tpList = tpPrices(p0, k);
  const lastStop = stopSeq[stopSeq.length - 1];
  if (tpList[0] < lastStop) {
    notices.push(
      '第一档止盈价低于末笔全仓止损价，止盈空间不足，建议更换标的或降低仓位',
    );
  }
  const tpRows: TpRow[] = [];
  let remainingShares = mult.reduce((acc, m) => acc + m * lot, 0);
  let prevDynamic = lastStop;
  for (let i = 0; i < n; i++) {
    const trig = tpList[i];
    const cutShares = mult[i] * lot;
    remainingShares -= cutShares;
    if (remainingShares > 0) {
      const dyn = r2(Math.max(trig * (1 - s1), prevDynamic));
      prevDynamic = dyn;
      tpRows.push({
        tier: i + 1,
        price: trig,
        cut_shares: cutShares,
        remain_shares: remainingShares,
        dynamic_stop: dyn,
      });
    } else {
      tpRows.push({
        tier: i + 1,
        price: trig,
        cut_shares: cutShares,
        remain_shares: 0,
        dynamic_stop: null,
      });
    }
  }
  return {
    ok: true,
    atr_pct: r2(atrPct),
    notices,
    ratio_note: ratioNote,
    rows,
    tp_rows: tpRows,
    total_invest: r2(totalInvest),
    remain: r2(remain),
    remain_pct: r2(remainPct),
    remain_ok: Boolean(remainPct >= REMAIN_LO * 100 - 1e-9 && remainPct <= REMAIN_HI * 100 + 1e-9),
    degraded: false,
    turnover: r2(turnover),
    fee_total: r2(feeTotal),
    fee_model: FEE_MODEL_VERSION,
    capital: r2(cap),
    adjust_pct: r2(adj),
    overspend: remain < 0,
    stop_loss_pct: r2(s1 * 100),
    gap_pct: r2(gLo * 100),
  };
}

// ============================================================================
// 涨跌停校验
// ============================================================================

export function priceLimitBounds(
  code: string,
  prevClose: number,
  isSt = false,
): { lo: number; hi: number } {
  const c = String(code).trim();
  let pct: number;
  if (isSt) pct = 0.05;
  else if (c.startsWith('300') || c.startsWith('301')) pct = 0.2;
  else if (c.startsWith('688') || c.startsWith('689')) pct = 0.2;
  else if (c.startsWith('8') || c.startsWith('4') || c.startsWith('92')) pct = 0.3;
  else pct = 0.1;
  return { lo: r2(prevClose * (1 - pct)), hi: r2(prevClose * (1 + pct)) };
}

export function checkBasePrice(
  code: string,
  basePrice: number,
  prevClose: number,
  isSt = false,
): string | null {
  const { lo, hi } = priceLimitBounds(code, prevClose, isSt);
  if (basePrice < lo || basePrice > hi) {
    return `基准开仓价${basePrice.toFixed(2)}元超出该标的按最新收盘价${prevClose.toFixed(2)}元计算的涨跌幅限制区间[${lo}, ${hi}]，请给出合理的第一笔开仓价格。`;
  }
  return null;
}

// ============================================================================
// 平仓 / 盈亏
// ============================================================================

export interface CloseResult {
  buy_amount: number;
  buy_total: number;
  sell_amount: number;
  sell_net: number;
  realized_pnl: number;
  fee_total: number;
}

export function closePositionResult(
  cost: number,
  qty: number,
  closePrice: number,
  feeWan: number,
): CloseResult {
  const q = Number(qty || 0);
  const buyAmount = Number(cost || 0) * q;
  const sellAmount = Number(closePrice || 0) * q;
  const bt = q > 0 ? buyCost(buyAmount, feeWan) : 0;
  const sn = q > 0 ? sellNet(sellAmount, feeWan) : 0;
  return {
    buy_amount: r2(buyAmount),
    buy_total: r2(bt),
    sell_amount: r2(sellAmount),
    sell_net: r2(sn),
    realized_pnl: r2(sn - bt),
    fee_total: r2(bt - buyAmount + (sellAmount - sn)),
  };
}

export interface ExistingEval {
  total_cost: number;
  market_value: number;
  net_value: number;
  pnl: number;
  loss: boolean;
}

export function evaluateExistingDetail(
  positions: Array<{ qty?: number; cost?: number; cur?: number }>,
  feeWan: number,
): ExistingEval {
  let totalCost = 0;
  let marketValue = 0;
  let netValue = 0;
  for (const p of positions ?? []) {
    const qty = Number(p.qty || 0);
    if (qty <= 0) continue;
    totalCost += buyCost(Number(p.cost || 0) * qty, feeWan);
    const amt = Number(p.cur || 0) * qty;
    marketValue += amt;
    netValue += sellNet(amt, feeWan);
  }
  return {
    total_cost: r2(totalCost),
    market_value: r2(marketValue),
    net_value: r2(netValue),
    pnl: r2(netValue - totalCost),
    loss: netValue < totalCost,
  };
}

export function evaluateExisting(
  positions: Array<{ qty?: number; cost?: number; cur?: number }>,
  feeWan: number,
): [number, number, boolean] {
  const d = evaluateExistingDetail(positions, feeWan);
  return [d.total_cost, d.market_value, d.loss];
}