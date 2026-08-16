// track-executor.ts — 持仓方案跟踪「实时价格到价位自动执行」
//
// 责任：给定某个 tracked plan + 一个实时价 cur，推导出「哪些步骤已触发并执行」，
// 并据此更新已有持仓列表（opening/add/stop/tp 都会真实改变 holdings 数量与成本）。
//
// 派生步骤顺序（与前端 buildSteps 一致）：
//   [开仓/加仓1] → [动态止损(全部)] → [加仓2] → [动态止损(全部)] → ... →
//   [止盈1] → [动态止损(剩余)] → [止盈2] → ... → [止盈N(全平)]
//
// 执行语义（按价位推进）：
//   - open/add：cur >= price  → 已建仓/加仓（累计持仓 +shares）
//   - stop    ：cur <= price  → 已触发止损（全部清仓 = 0 股，或按该步覆盖股数清掉）
//   - tp      ：cur >= price  → 已减仓 cut_shares（剩余 = remain_shares）
// 注意：同一标的不会既 open 又 stop 同时成立（cur 不会既 >= 开仓价 又 <= 止损价，
// 除非开仓价<=止损价反向，正常金字塔里 stop < open，故价格落入 [stop, open) 区间时
// 处于「已建仓但未到加仓/止损」的中间态——这是正确的持仓持有态）。

import * as eng from '../../src/utils/pyramid.ts';

export interface PlanStep {
  kind: 'open' | 'add' | 'stop' | 'tp';
  price: number;
  shares: number;        // open/add: 本次买入股数；stop: 本次清掉的股数；tp: 减仓股数
  cumAfter?: number;     // 该步骤完成后累计持仓
  info?: string;
}

export interface TrackPlan {
  stock_code: string;
  stock_name: string;
  p0: number;
  atr_pct: number;
  plan_json: { rows?: any[]; tp_rows?: any[]; [k: string]: any };
}

/** 与前端 buildSteps 对齐：生成完整步骤序列（不含 done 态） */
export function buildTrackSteps(plan: TrackPlan): PlanStep[] {
  const rows = plan.plan_json?.rows || [];
  const tp = plan.plan_json?.tp_rows || [];
  const steps: PlanStep[] = [];
  let cum = 0;
  rows.forEach((r: any, i: number) => {
    const isOpen = i === 0;
    cum += Number(r.shares) || 0;
    steps.push({ kind: isOpen ? 'open' : 'add', price: Number(r.price), shares: Number(r.shares) || 0, cumAfter: cum });
    steps.push({ kind: 'stop', price: Number(r.stop), shares: cum, cumAfter: cum });
  });
  tp.forEach((t: any, i: number) => {
    const remain = Number(t.remain_shares);
    steps.push({ kind: 'tp', price: Number(t.price), shares: Number(t.cut_shares) || 0, cumAfter: remain });
    const isLast = i === tp.length - 1;
    if (!isLast) {
      const stopPrice = t.dynamic_stop != null ? Number(t.dynamic_stop) : (rows[rows.length - 1]?.stop ?? 0);
      steps.push({ kind: 'stop', price: stopPrice, shares: remain, cumAfter: remain });
    }
  });
  return steps;
}

/** 给定实时价，返回已执行的步骤索引集合（用于前端高亮 + 后端写持仓） */
export function executedStepIndices(steps: PlanStep[], cur: number): number[] {
  const done: number[] = [];
  if (!cur) return done;
  let executedNonStop = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const cond = s.kind === 'stop'
      ? s.price != null && cur <= s.price + 1e-9
      : s.price != null && cur >= s.price - 1e-9;
    if (s.kind === 'stop') {
      const required = steps.slice(0, i).filter((x) => x.kind !== 'stop').length;
      if (executedNonStop >= required && cond) done.push(i);
    } else {
      if (cond) { done.push(i); executedNonStop++; }
    }
  }
  return done;
}

export interface TrackResult {
  executed_indices: number[];
  /** 该标的最终应为的持仓股数（按步骤推进推导） */
  shares: number;
  /** 该标的最终综合成本（加权均价，开/加仓抬高，止盈/止损降低数量） */
  avg_cost: number;
  /** 是否已清仓（全部动态止损/末档止盈触发） */
  cleared: boolean;
  steps: { kind: string; price: number; shares: number; done: boolean; info: string }[];
}

/**
 * 计算在价格 cur 下行权后的持仓状态。
 * - 累计买入股数 = 所有已执行的 open/add 的 shares 之和
 * - 减去已执行的 tp 减仓股数
 * - 若任一 stop 步骤已执行，则在该 stop 处清掉对应股数（按最早触发的 stop 截断）
 * - 末档止盈（全平）触发则清仓
 */
export function computeTrackState(plan: TrackPlan, cur: number): TrackResult {
  const steps = buildTrackSteps(plan);
  // 关键：止损步骤只有在「它之前的所有非止损步骤都已执行」后才可能触发，
  // 否则会出现「价格尚在开仓价、末档止盈后的动态止损却已触发」的错误清空。
  const done = new Set<number>();
  let executedNonStop = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const cond = s.kind === 'stop'
      ? s.price != null && cur <= s.price + 1e-9
      : s.price != null && cur >= s.price - 1e-9;
    if (s.kind === 'stop') {
      const required = steps.slice(0, i).filter((x) => x.kind !== 'stop').length;
      if (executedNonStop >= required && cond) done.add(i);
    } else {
      if (cond) { done.add(i); executedNonStop++; }
    }
  }
  const doneIdx = Array.from(done).sort((a, b) => a - b);

  let bought = 0;
  let costSum = 0;
  let reducedByTp = 0;
  let anyStop = false;
  const rows = plan.plan_json?.rows || [];
  const tp = plan.plan_json?.tp_rows || [];

  // 计算买入均价（用 rows[i].price 作为建仓价，加仓价用 r.price）
  let openPrice = rows[0]?.price ?? plan.p0;
  let addPrices = rows.slice(1).map((r: any) => Number(r.price));

  // 按顺序处理，累计成交
  let cumBought = 0;
  let idx = 0; // rows 指针
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!done.has(i)) continue;
    if (s.kind === 'open') {
      cumBought += s.shares;
      costSum += s.shares * (openPrice ?? s.price);
    } else if (s.kind === 'add') {
      const ap = addPrices[idx] ?? s.price;
      cumBought += s.shares;
      costSum += s.shares * ap;
      idx++;
    } else if (s.kind === 'tp') {
      reducedByTp += s.shares;
    } else if (s.kind === 'stop') {
      // 动态止损：清掉全部已持仓（实际操作为卖出所有持有股）
      anyStop = true;
    }
  }
  // 末档止盈触发（全平）：tp 最后一项 remain_shares==0 且已执行
  const lastTpRemain = tp.length ? Number(tp[tp.length - 1].remain_shares) : 1;
  const lastTpIdx = steps.length - 1;
  if (tp.length && lastTpRemain === 0 && done.has(lastTpIdx) && steps[lastTpIdx].kind === 'tp') {
    anyStop = true;
  }

  let shares = cumBought - reducedByTp;
  if (anyStop) shares = 0;
  shares = Math.max(0, Math.round(shares));
  const avg_cost = cumBought > 0 ? eng.r2(costSum / cumBought) : 0;
  const opened = cumBought > 0;

  return {
    executed_indices: doneIdx,
    shares,
    avg_cost,
    opened,
    cleared: anyStop,
    steps: steps.map((s, i) => ({
      kind: s.kind,
      price: s.price,
      shares: s.shares,
      done: done.has(i),
      info: s.kind === 'stop'
        ? `止损价 ${s.price?.toFixed(2)} · 覆盖 ${s.shares} 股`
        : s.kind === 'tp'
        ? `止盈价 ${s.price?.toFixed(2)} · 减仓 ${s.shares} 股`
        : `触发价 ${s.price?.toFixed(2)} · ${s.shares} 股`,
    })),
  };
}
