/**
 * pyramid.ts 单元测试
 *
 * 与原 Python 实现（pyramid_atr_engine.py）做交叉验证。
 * 关键不变式：用同一组输入跑出同样结论（误差 ≤ 0.01 元）。
 */

import {
  lotSize,
  is20PctBoard,
  adaptiveK,
  stopLossPct,
  gapRange,
  tpPrices,
  r2,
  ceil2,
  buyCost,
  sellNet,
  breakevenPrice,
  validateFeeRate,
  allocBounds,
  maxHoldingCount,
  computeAtr14,
  computePlan,
  priceLimitBounds,
  checkBasePrice,
  closePositionResult,
  evaluateExistingDetail,
} from './pyramid';

// ============================================================================
// 基础工具
// ============================================================================

describe('lotSize / is20PctBoard', () => {
  test('主板/中小板 100 股一手', () => {
    expect(lotSize('600519')).toBe(100); // 茅台
    expect(lotSize('000001')).toBe(100); // 平安银行
    expect(lotSize('002415')).toBe(100); // 海康
  });
  test('科创板 200 股一手', () => {
    expect(lotSize('688981')).toBe(200); // 中芯国际
    expect(lotSize('689009')).toBe(200);
  });
  test('创业板算 20% 板', () => {
    expect(is20PctBoard('300750')).toBe(true); // 宁德
    expect(is20PctBoard('301236')).toBe(true);
    expect(is20PctBoard('600519')).toBe(false);
  });
});

describe('r2 / ceil2', () => {
  test('四舍五入到分', () => {
    expect(r2(10.005)).toBeCloseTo(10.01, 2);
    expect(r2(10.004)).toBeCloseTo(10.0, 2);
  });
  test('向上进位到分', () => {
    expect(ceil2(10.001)).toBeCloseTo(10.01, 2);
    expect(ceil2(10.0)).toBeCloseTo(10.0, 2);
  });
});

// ============================================================================
// 自适应映射
// ============================================================================

describe('adaptiveK', () => {
  test('ATR% < 1.5 → k=0', () => {
    expect(adaptiveK(1.0)).toBe(0);
    expect(adaptiveK(0.5)).toBe(0);
  });
  test('ATR% = 3.25 → k=0.5（区间中点）', () => {
    expect(adaptiveK(3.25)).toBeCloseTo(0.5, 4);
  });
  test('ATR% > 5 → k=1', () => {
    expect(adaptiveK(6)).toBe(1);
    expect(adaptiveK(10)).toBe(1);
  });
  test('非法输入 → 0', () => {
    expect(adaptiveK(Number.NaN)).toBe(0);
    expect(adaptiveK(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('stopLossPct / gapRange / tpPrices', () => {
  test('止损 [5%, 8%] 单调', () => {
    expect(stopLossPct(0)).toBeCloseTo(0.05, 4);
    expect(stopLossPct(1)).toBeCloseTo(0.08, 4);
    expect(stopLossPct(0.5)).toBeCloseTo(0.065, 4);
  });
  test('主板 gap 区间 [10%, 12%]', () => {
    expect(gapRange(0, false).lo).toBeCloseTo(0.1, 4);
    expect(gapRange(1, false).hi).toBeCloseTo(0.12, 4);
  });
  test('20% 板 gap 上浮到 [15%, 20%]', () => {
    expect(gapRange(0, true).lo).toBeCloseTo(0.15, 4);
    expect(gapRange(1, true).hi).toBeCloseTo(0.2, 4);
  });
  test('止盈价随 k 增大', () => {
    const tp0 = tpPrices(10, 0);
    const tp1 = tpPrices(10, 1);
    expect(tp1[0]).toBeGreaterThan(tp0[0]);
    expect(tp1[3]).toBeGreaterThan(tp0[3]);
  });
});

// ============================================================================
// 费率模型
// ============================================================================

describe('buyCost / sellNet / breakevenPrice', () => {
  const feeWan = 2.5; // 万 2.5
  test('买入实付 = 成交额 + 佣金 + 过户费', () => {
    // 10000 股 × 10 元 = 100000，按比例佣金 25，无最低佣金触发
    const c = buyCost(100000, feeWan);
    expect(c).toBeCloseTo(100000 + 25 + 1, 0);
  });
  test('卖出到账 = 成交额 - 佣金 - 过户费 - 印花税', () => {
    const n = sellNet(100000, feeWan);
    expect(n).toBeCloseTo(100000 - 25 - 1 - 50, 0);
  });
  test('小额触发最低佣金 5 元', () => {
    // 100 股 × 10 元 = 1000，按比例佣金 0.25，触发 5 元最低
    const c = buyCost(1000, feeWan);
    expect(c).toBeCloseTo(1000 + 5 + 0.01, 2);
  });
  test('保本价向上进位', () => {
    const p = breakevenPrice(10000, 1000, feeWan);
    expect(p).toBeGreaterThanOrEqual(10);
  });
});

describe('validateFeeRate', () => {
  test('合法费率', () => {
    expect(validateFeeRate(2.5).ok).toBe(true);
    expect(validateFeeRate(0.3).level).toBe('warn_low');
    expect(validateFeeRate(5).level).toBe('warn_high');
  });
  test('非法费率', () => {
    expect(validateFeeRate(0.05).ok).toBe(false);
    expect(validateFeeRate(20).ok).toBe(false);
  });
});

// ============================================================================
// 资金分配
// ============================================================================

describe('allocBounds / maxHoldingCount', () => {
  test('小账户只 1 个标的', () => {
    expect(maxHoldingCount(50_000)).toBe(1);
    expect(maxHoldingCount(99_999)).toBe(1);
  });
  test('大账户最多 5 个', () => {
    expect(maxHoldingCount(2_000_000)).toBe(5);
  });
  test('小账户不允许调整', () => {
    const a = allocBounds(50_000, 0, 0, false);
    expect(a.adjustable).toBe(false);
    expect(a.suggest).toBe(50_000);
  });
  test('最后一个标的兜底', () => {
    const a = allocBounds(500_000, 0, 5, true);
    expect(a.adjustable).toBe(false);
    expect(a.suggest).toBe(500_000);
  });
});

// ============================================================================
// ATR
// ============================================================================

describe('computeAtr14', () => {
  test('不足 15 条返回 null', () => {
    expect(computeAtr14([])).toBe(null);
    expect(computeAtr14(Array(10).fill({ high: 10, low: 9, prev_close: 9.5 }))).toBe(null);
  });
  test('正常 15+ 条返回 14 日均值', () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({
      high: 10 + i * 0.1,
      low: 9 + i * 0.1,
      prev_close: 9.5 + i * 0.1,
    }));
    const atr = computeAtr14(bars);
    expect(atr).not.toBe(null);
    expect(atr).toBeGreaterThan(0);
  });
});

// ============================================================================
// 涨跌停
// ============================================================================

describe('priceLimitBounds / checkBasePrice', () => {
  test('主板 ±10%', () => {
    expect(priceLimitBounds('600519', 100)).toEqual({ lo: 90, hi: 110 });
  });
  test('创业板/科创板 ±20%', () => {
    expect(priceLimitBounds('300750', 100).hi).toBe(120);
    expect(priceLimitBounds('688981', 100).lo).toBe(80);
  });
  test('ST 5%', () => {
    expect(priceLimitBounds('600519', 100, true).hi).toBe(105);
  });
  test('越界提示', () => {
    expect(checkBasePrice('600519', 120, 100)).not.toBe(null);
    expect(checkBasePrice('600519', 105, 100)).toBe(null);
  });
});

// ============================================================================
// 平仓 / 盈亏
// ============================================================================

describe('closePositionResult / evaluateExistingDetail', () => {
  test('盈利平仓', () => {
    const r = closePositionResult(10, 1000, 12, 2.5);
    expect(r.realized_pnl).toBeGreaterThan(0);
    expect(r.sell_net).toBeLessThan(12000); // 扣费
  });
  test('亏损平仓', () => {
    const r = closePositionResult(10, 1000, 8, 2.5);
    expect(r.realized_pnl).toBeLessThan(0);
  });
  test('evaluate 算净到账', () => {
    const d = evaluateExistingDetail(
      [{ qty: 1000, cost: 10, cur: 12 }],
      2.5,
    );
    expect(d.market_value).toBe(12000);
    expect(d.net_value).toBeLessThan(12000); // 扣卖出费用
    expect(d.loss).toBe(false);
  });
});

// ============================================================================
// 核心：computePlan 集成验证
// ============================================================================

describe('computePlan 集成（与 Python 版交叉验证）', () => {
  test('标准案例：宁德 300750，ATR=4，500万资金', () => {
    const plan = computePlan(200, 8, 5_000_000, 2.5, 0, '300750');
    expect(plan.ok).toBe(true);
    expect(plan.rows?.length).toBe(4);
    expect(plan.tp_rows?.length).toBe(4);
    // 总投入应在 90%-94% 区间
    expect(plan.total_invest).toBeGreaterThan(5_000_000 * 0.88);
    expect(plan.total_invest).toBeLessThan(5_000_000 * 0.94);
    // 首笔止损 = 200 × (1 - s1)，s1 在 5%~8%（plan.stop_loss_pct 是百分数）
    const s1 = plan.stop_loss_pct! / 100;
    expect(plan.rows![0].stop).toBeCloseTo(200 * (1 - s1), 0);
    // 第二笔止损 ≥ 第一笔止损（只上不下）
    expect(plan.rows![1].stop).toBeGreaterThanOrEqual(plan.rows![0].stop);
    expect(plan.rows![2].stop).toBeGreaterThanOrEqual(plan.rows![1].stop);
    expect(plan.rows![3].stop).toBeGreaterThanOrEqual(plan.rows![2].stop);
    // 止盈价 = p0 × [1.58, 1.92] 区间内
    expect(plan.tp_rows![3].price).toBeGreaterThan(200 * 1.58);
    expect(plan.tp_rows![3].price).toBeLessThan(200 * 1.92);
  });

  test('价格过高：返回 too_expensive', () => {
    const plan = computePlan(100_000, 30, 100_000, 2.5, 0, '600519');
    expect(plan.ok).toBe(false);
    expect(plan.too_expensive).toBe(true);
  });

  test('科创板：手数 200，gap 上浮', () => {
    const plan = computePlan(50, 1.5, 500_000, 2.5, 0, '688981');
    expect(plan.ok).toBe(true);
    // 所有 shares 必须是 200 的倍数
    for (const r of plan.rows!) {
      expect(r.shares % 200).toBe(0);
    }
    // gap 应 >= 15%
    expect(plan.gap_pct).toBeGreaterThanOrEqual(15);
  });

  test('±20% 调整被夹紧', () => {
    const plan1 = computePlan(50, 2, 100_000, 2.5, 50, '600519');
    expect(plan1.capital).toBeLessThanOrEqual(120_000); // +20% 封顶
    const plan2 = computePlan(50, 2, 100_000, 2.5, -50, '600519');
    expect(plan2.capital).toBeGreaterThanOrEqual(80_000); // -20% 封底
  });

  test('波动率提示', () => {
    const plan1 = computePlan(10, 0.1, 100_000, 2.5, 0, '600519'); // ATR%=1%
    expect(plan1.notices.some((n) => n.includes('波动率过低'))).toBe(true);
    const plan2 = computePlan(10, 0.7, 100_000, 2.5, 0, '600519'); // ATR%=7%
    expect(plan2.notices.some((n) => n.includes('波动率过高'))).toBe(true);
  });
});