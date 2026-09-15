/**
 * pyramid.ts 对抗性测试（边界 / 脏数据 / 不变量）
 *
 * 目的：用「攻击者视角」喂病态输入，确保核心算法
 *  1) 不抛异常；
 *  2) 不把 NaN / Infinity 泄漏到对外暴露的数值字段（NaN 会静默污染整个加仓方案）；
 *  3) 对已知边界返回约定好的值（而不是静默给出错误结果）。
 *
 * 与 pyramid.test.ts（业务口径交叉验证）互补。
 */

import {
  computePlan,
  computeAtr14,
  breakevenAmount,
  breakevenPrice,
  validateFeeRate,
  adaptiveK,
  stopLossPct,
  gapRange,
  tpPrices,
  type Bar,
} from './pyramid';

// ---------------------------------------------------------------------------
// 工具：递归扫描对象里的 NaN / Infinity
// ---------------------------------------------------------------------------
function collectNonFinite(value: unknown, path = '$', out: string[] = []): string[] {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) out.push(`${path}=NaN`);
    else if (!Number.isFinite(value)) out.push(`${path}=${value}`);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectNonFinite(v, `${path}[${i}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectNonFinite(v, `${path}.${k}`, out);
  }
  return out;
}

function makeBars(n: number, mutate?: (b: Bar, i: number) => void): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const b: Bar = { high: 10 + (i % 5) * 0.1, low: 9.5, prev_close: 9.8, close: 9.9 };
    if (mutate) mutate(b, i);
    return b;
  });
}

// ===========================================================================
describe('computePlan · 病态输入不崩且不产生 NaN', () => {
  const cases: Array<[string, number, number, number, number]> = [
    ['价格为 0', 0, 0.5, 100000, 2.5],
    ['价格为负', -10, 0.5, 100000, 2.5],
    ['资金为 0', 10, 0.5, 0, 2.5],
    ['资金为负', 10, 0.5, -100000, 2.5],
    ['ATR 为 0', 10, 0, 100000, 2.5],
    ['ATR 为负', 10, -1, 100000, 2.5],
    ['ATR 极大', 10, 1e9, 100000, 2.5],
    ['ATR 为 NaN', 10, NaN, 100000, 2.5],
    ['费率为 0', 10, 0.5, 100000, 0],
    ['费率为负', 10, 0.5, 100000, -5],
    ['费率为 NaN', 10, 0.5, 100000, NaN],
    ['资金极小', 100, 5, 1, 2.5],
    ['价格极小', 1e-6, 1e-7, 1e9, 2.5],
  ];

  test.each(cases)('%s：不抛异常', (_t, p0, atr, capital, feeWan) => {
    expect(() => computePlan(p0, atr, capital, feeWan, 0, '600519')).not.toThrow();
  });

  test.each(cases)('%s：结果无 NaN', (_t, p0, atr, capital, feeWan) => {
    const r = computePlan(p0, atr, capital, feeWan, 0, '600519');
    const bad = collectNonFinite(r);
    expect(bad).toEqual([]);
  });

  test('资金不足买一手时给出 too_expensive 而非抛错', () => {
    const r = computePlan(2000, 50, 100, 2.5, 0, '600519');
    expect(r).toBeTruthy();
    // 允许 ok=false / too_expensive=true，但必须是「明确结论」而不是崩掉
    expect(typeof r.ok).toBe('boolean');
  });

  test('adjustPct 越界被夹取，不会放大到荒谬仓位', () => {
    const a = computePlan(10, 0.5, 100000, 2.5, 9999, '600519');
    const b = computePlan(10, 0.5, 100000, 2.5, -9999, '600519');
    expect(collectNonFinite(a)).toEqual([]);
    expect(collectNonFinite(b)).toEqual([]);
    expect(a.capital).toBeGreaterThan(0);
    expect(b.capital).toBeGreaterThan(0);
  });

  test('adjustPct 为 NaN 时回落为 0（不产生 NaN 资金）', () => {
    const r = computePlan(10, 0.5, 100000, 2.5, NaN, '600519');
    expect(collectNonFinite(r)).toEqual([]);
    expect(r.capital).toBeCloseTo(100000, 6);
  });
});

// ===========================================================================
describe('computeAtr14 · 脏 K 线不污染 ATR', () => {
  test('不足 15 条返回 null', () => {
    expect(computeAtr14(makeBars(14))).toBeNull();
    expect(computeAtr14([])).toBeNull();
  });

  test('空/未定义输入返回 null 而不抛', () => {
    expect(computeAtr14((undefined as unknown) as Bar[])).toBeNull();
    expect(computeAtr14((null as unknown) as Bar[])).toBeNull();
  });

  test('含 NaN 的 bar 被跳过，ATR 仍为有限数（历史缺陷：NaN 会扩散）', () => {
    const bars = makeBars(20, (b, i) => {
      if (i % 3 === 0) b.high = NaN;
      if (i % 4 === 0) b.low = (undefined as unknown) as number;
    });
    const atr = computeAtr14(bars);
    expect(atr === null || Number.isFinite(atr)).toBe(true);
    expect(Number.isNaN(atr as number)).toBe(false);
  });

  test('全部脏数据时返回 null 而不是 NaN', () => {
    const bars = makeBars(20, (b) => {
      b.high = NaN;
      b.low = NaN;
    });
    expect(computeAtr14(bars)).toBeNull();
  });

  test('缺失 prev_close 时用 close 兜底，不产生 NaN', () => {
    const bars = makeBars(20, (b) => {
      delete b.prev_close;
    });
    const atr = computeAtr14(bars);
    expect(atr === null || Number.isFinite(atr)).toBe(true);
  });

  test('prev_close 与 close 都缺失时兜底为 0，不产生 NaN', () => {
    const bars = makeBars(20, (b) => {
      delete b.prev_close;
      delete b.close;
    });
    const atr = computeAtr14(bars);
    expect(atr === null || Number.isFinite(atr)).toBe(true);
  });
});

// ===========================================================================
describe('保本价 / 费率 · 边界约定', () => {
  test('成本 <= 0 时保本额为 0', () => {
    expect(breakevenAmount(0, 2.5)).toBe(0);
    expect(breakevenAmount(-100, 2.5)).toBe(0);
  });

  test('费率极高导致分母 <= 0 时返回 Infinity（有意为之，调用方需处理）', () => {
    expect(breakevenAmount(10000, 10000)).toBe(Infinity);
  });

  test('份额 <= 0 时保本价为 0（不除零）', () => {
    expect(breakevenPrice(10000, 0, 2.5)).toBe(0);
    expect(breakevenPrice(10000, -100, 2.5)).toBe(0);
  });

  test('validateFeeRate 拒绝 NaN / 越界', () => {
    expect(validateFeeRate(NaN).level).toBe('hard');
    expect(validateFeeRate(NaN).ok).toBe(false);
    expect(validateFeeRate(-1).ok).toBe(false);
    expect(validateFeeRate(1e9).ok).toBe(false);
  });
});

// ===========================================================================
describe('派生指标 · 病态输入', () => {
  test('adaptiveK 对 NaN / 负值不产生 NaN', () => {
    [NaN, -1, 0, 1e9].forEach((v) => {
      const k = adaptiveK(v);
      expect(Number.isNaN(k)).toBe(false);
    });
  });

  test('stopLossPct 对 NaN / 负值不产生 NaN', () => {
    [NaN, -1, 0, 1e9].forEach((v) => {
      const p = stopLossPct(adaptiveK(v));
      expect(Number.isNaN(p)).toBe(false);
    });
  });

  test('tpPrices 对价格为 0 / 负不产生 NaN', () => {
    [0, -5].forEach((p0) => {
      const tps = tpPrices(p0, 3);
      tps.forEach((t) => expect(Number.isNaN(t)).toBe(false));
    });
  });

  test('gapRange 对异常代码/波动率不产生 NaN', () => {
    [NaN, -1, 0, 100].forEach((atrPct) => {
      const g = gapRange(atrPct, (null as unknown) as string);
      expect(collectNonFinite(g)).toEqual([]);
    });
  });
});
