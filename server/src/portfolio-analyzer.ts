// portfolio-analyzer.ts — 持仓分析 pipeline
// 对应原 A股景气捕手 project 的 position_strategy.py（5 步校验链 + 现有持仓处置）
// 算法层用根目录 src/utils/pyramid.ts（pyramid_atr_engine TS 移植版）

import * as eng from '../../src/utils/pyramid.js'  // tsx 自动解析 .ts

// ===========================================
// 本地补的两个 helper（pyramid.ts 没 export）
// ===========================================

const IDLE_DAYS = 14

function suggestNoNewOpen30d(totalCost: number, marketValue: number): string | null {
  // 整体亏损 + 距今 < 30 个交易日：不开新仓
  if (totalCost > 0 && marketValue < totalCost) {
    return '当前账户整体处于亏损状态：近 30 个交易日建议暂缓开新仓，先回笼资金评估现有持仓。'
  }
  return null
}

function idleNotice(lastActionDate: string | null, today: string, isTradingDay: (d: string) => boolean): string | null {
  if (!lastActionDate) return null
  try {
    const last = new Date(lastActionDate)
    const now = new Date(today)
    if (Number.isNaN(last.getTime()) || Number.isNaN(now.getTime())) return null
    const diffDays = Math.floor((now.getTime() - last.getTime()) / 86400000)
    // 简单估计：如果非交易日还按日历日算就不准。这里只做"长时间无操作"提示。
    if (diffDays > 30) {
      return `距上次操作已过 ${diffDays} 天，建议按既定风控纪律复盘。`
    }
  } catch {}
  return null
}

function isTradingDay(dateStr: string): boolean {
  // 简化版：周一~周五（节假日忽略）
  try {
    const d = new Date(dateStr)
    const w = d.getDay()
    return w >= 1 && w <= 5
  } catch {
    return true
  }
}

// ===========================================
// 主入口
// ===========================================

interface Existing {
  code: string
  name?: string
  cost: number
  qty: number
  cur?: number
}

interface Stock {
  code: string
  name?: string
  capital?: number
  price?: number
  atr?: number
}

interface AnalyzeInput {
  total_capital?: number
  fee_wan?: number
  stocks?: Stock[]
  existing?: Existing[]
  last_action_date?: string | null
  fee_confirmed?: boolean
  price_confirmed_codes?: string[]
}

function validCode(code: string): boolean {
  const c = String(code || '').trim()
  return c.length === 6 && /^\d{6}$/.test(c) && '0134689'.includes(c[0])
}

const PRICE_DEVIATION_PCT = 2.0
const DISCLAIMER =
  '本结果由本地规则引擎按既定风控框架计算（pyramid_atr_engine V4.1），' +
  '仅供研究复盘和风险管理参考，不构成任何买卖建议；实际交易请自行决策并控制仓位。'

export async function handleAnalyze(input: AnalyzeInput) {
  const {
    total_capital = 0,
    fee_wan = 0,
    stocks = [],
    existing = [],
    last_action_date = null,
    fee_confirmed = false,
    price_confirmed_codes = [],
  } = input

  // ── Step 1: 费率校验（软/硬警告） ──
  const feeChk = eng.validateFeeRate(fee_wan)
  if (!feeChk.ok) {
    return { ok: false, error: feeChk.msg, fee_level: 'hard' }
  }
  if ((feeChk.level === 'warn_low' || feeChk.level === 'warn_high') && !fee_confirmed) {
    return { ok: false, fee_confirm: true, fee_msg: feeChk.msg, fee_level: feeChk.level }
  }

  // ── Step 2: 总资金校验 ──
  if (!total_capital || total_capital <= 0) {
    return { ok: false, error: '请输入有效总资金', fee_level: feeChk.level }
  }

  const confirmed = new Set(price_confirmed_codes || [])
  const report: any = {
    ok: true,
    fee_level: feeChk.level,
    fee_msg: feeChk.msg,
    total_capital,
    max_hold: eng.maxHoldingCount(total_capital),
    stocks: [],
    existing_advice: [],
    notices: [],
    confirms: [],
    disclaimer: DISCLAIMER,
  }

  // ── Step 3: 小资金限制（<10w 限 1 标） ──
  let stocksIn = stocks
  if (total_capital < 100000) {
    report.notices.push(
      '账户总资金小于 10 万元：按规则最多计算 1 个标的，且不支持对单标可用资金做 ±20% 调整。',
    )
    if (stocksIn.length > 1) {
      report.notices.push(
        `您输入了 ${stocksIn.length} 个拟买标的，超过 1 个上限：仅计算第一个标的，其余请先删除。`,
      )
      stocksIn = stocksIn.slice(0, 1)
    }
  }

  // ── Step 4: 现有持仓处置 ──
  if (existing && existing.length) {
    for (const p of existing) {
      if (!p.cur) p.cur = p.cost || 0
    }
    const summary = eng.evaluateExisting(existing, fee_wan)
    report.existing_summary = {
      total_cost: summary.total_cost,
      market_value: summary.market_value,
      net_value: summary.net_value,
      pnl: summary.pnl,
      loss: summary.loss,
    }
    if (summary.loss) {
      report.existing_advice.push({
        type: 'global',
        text: `账户整体持仓处于亏损状态（市值 ${summary.market_value.toFixed(2)} 元 < 成本 ${summary.total_cost.toFixed(2)} 元）：建议先全部平仓，回笼资金后按下方各标的规则重新开仓，严格执行止损止盈纪律。`,
      })
    }
    const stop30 = suggestNoNewOpen30d(summary.total_cost, summary.market_value)
    if (stop30) report.notices.push(stop30)
    for (const p of existing) {
      if (!validCode(p.code)) {
        report.existing_advice.push({
          type: 'invalid',
          code: p.code,
          text: `【${p.code}】代码格式无效，请核对标的代码与名称后重新输入。`,
        })
        continue
      }
      const cur = p.cur || p.cost || 0
      const atr = cur * 0.025  // 现有持仓没法查行情，用 2.5% 估 ATR
      const capHint = Math.max(cur * (p.qty || 0), 10000)
      const plan = eng.computePlan(cur, atr, capHint, fee_wan, p.code)
      let action = '持有观察：触及下方止损/止盈档位时按表执行'
      if (summary.loss) action = '先全部平仓，回笼资金后按本方案重新开仓'
      else if (plan.ok && plan.rows?.[0]?.stop && cur <= plan.rows[0].stop) {
        action = '现价已低于首笔止损参考线，建议按风控纪律减仓或平仓'
      }
      report.existing_advice.push({
        type: 'per_holding',
        code: p.code,
        name: p.name || '',
        cost: p.cost,
        qty: p.qty,
        cur,
        atr: +atr.toFixed(4),
        action,
        plan,
      })
    }
  }

  // ── Step 5: 新标的方案（5 步校验链） ──
  let allocated = 0
  const held = (existing || []).length
  const isLast = (i: number) => i === stocksIn.length - 1
  for (let i = 0; i < stocksIn.length; i++) {
    const s = stocksIn[i]
    const code = String(s.code || '').trim()
    const nameIn = s.name || ''
    if (!validCode(code)) {
      report.stocks.push({ code, error: '代码格式无效：请核对标的代码（6 位数字）与名称后重新输入。' })
      continue
    }
    const price = Number(s.price) || 0
    const atr = Number(s.atr) || price * 0.025  // 没传 ATR 用 2.5% 估
    if (price <= 0) {
      report.stocks.push({ code, name: nameIn, error: '请输入基准开仓价 price' })
      continue
    }

    // 涨跌停限制
    const prev_close = price
    const is_st = nameIn.toUpperCase().includes('ST')
    const limit_msg = eng.checkBasePrice(code, price, prev_close, is_st)
    if (limit_msg) {
      report.stocks.push({ code, name: nameIn, error: limit_msg, need_reprice: true })
      continue
    }

    // 资金分配
    let capital = Number(s.capital) || 0
    if (capital <= 0) {
      const b = eng.allocBounds(total_capital, allocated, held, isLast(i))
      capital = b.suggest
    }
    if (total_capital < 100000) {
      capital = total_capital
    }
    allocated += capital

    const plan = eng.computePlan(price, atr, capital, fee_wan, code)
    const item: any = {
      code,
      name: nameIn,
      p0: price,
      atr: +atr.toFixed(4),
      capital,
      plan,
    }
    if (plan.too_expensive) item.need_switch = true
    report.stocks.push(item)
  }

  // idle notice
  const today = new Date().toISOString().slice(0, 10)
  const idle = idleNotice(last_action_date, today, isTradingDay)
  if (idle) report.notices.push(idle)

  return report
}
