// account-ledger.ts — 账户与保证金账本（PRD V4.0）
//
// 忠实移植原项目 position_account.py：账本是「事件流」，总保证金只能由
// init/deposit/withdraw/close_position/fee_rate_change 推导，任何界面金额
// 都必须能追溯到某条事件。术语映射走 TERMS，前端不得自造别名。
//
// 引擎层用根目录 src/utils/pyramid.ts（pyramid_atr_engine TS 移植版）

import * as eng from '../../src/utils/pyramid.ts'

export const EVENT_INIT = 'init'
export const EVENT_DEPOSIT = 'deposit'
export const EVENT_WITHDRAW = 'withdraw'
export const EVENT_CLOSE = 'close_position'
export const EVENT_FEE_RATE = 'fee_rate_change'

export const VALID_EVENTS = [EVENT_INIT, EVENT_DEPOSIT, EVENT_WITHDRAW, EVENT_CLOSE, EVENT_FEE_RATE]

export const MIN_AMOUNT = 0.01 // 金额最小步长（分）
export const MAX_MARGIN = 1e9 // 总保证金上限：10 亿
export const MAX_EVENTS = 2000 // 单账户事件数上限

// 术语映射（所有对外输出都走这张表，避免「总资金/总金额/本金」混用）
export const TERMS: Record<string, string> = {
  initial_margin: '账户初始保证金',
  total_margin: '账户总保证金',
  deposit: '添加保证金',
  withdraw: '提取保证金',
  realized_pnl: '累计实现盈亏',
  allocated: '已分配资金',
  available: '可分配余额',
  max_hold: '可开标的上限',
  fee_rate_wan: '手续费率（万分之）',
  suggested_capital: '单标建议资金',
}

export interface LedgerEvent {
  type: string
  amount?: number
  code?: string
  name?: string
  qty?: number
  cost?: number
  close_price?: number
  realized_pnl?: number
  fee_rate_wan?: number
  note?: string
  ts?: string
}

export interface LedgerPositionLike {
  code: string
  qty?: number
  cost?: number
  cur?: number
}

export interface LedgerState {
  ok: boolean
  configured: boolean
  initial_margin: number
  deposit_total: number
  withdraw_total: number
  realized_pnl: number
  total_margin: number
  allocated: number
  available: number
  held_count: number
  max_hold: number
  can_open_more: number
  fee_rate_wan: number
  fee_level: string
  fee_msg: string
  fee_model: string
  small_account: boolean
  events: any[]
  closed_codes: string[]
  errors: string[]
  notices: string[]
  terms: Record<string, string>
}

function normalizeAmount(value: any, field = '金额'): [boolean, number, string] {
  let v: number
  try {
    v = parseFloat(value)
  } catch {
    return [false, 0, `请输入有效的${field}`]
  }
  if (Number.isNaN(v) || v === Infinity || v === -Infinity) return [false, 0, `请输入有效的${field}`]
  if (v <= 0) return [false, 0, `${field}必须大于0元`]
  if (v < MIN_AMOUNT) return [false, 0, `${field}不得小于0.01元`]
  if (v > MAX_MARGIN) return [false, 0, `${field}超过系统上限（10亿元），请核对输入`]
  return [true, eng.r2(v), '']
}

function allocatedFromPositions(positions: LedgerPositionLike[] | null | undefined, fee_wan: number): number {
  let total = 0
  for (const p of positions || []) {
    const qty = Number(p.qty || 0)
    const cost = Number(p.cost || 0)
    if (qty <= 0 || cost <= 0) continue
    total += eng.buyCost(cost * qty, fee_wan)
  }
  return eng.r2(total)
}

function closePnl(ev: LedgerEvent, fee_wan: number): [number, any] {
  const qty = ev.qty
  const cost = ev.cost
  const price = ev.close_price ?? ev.cost
  if (qty && cost != null && price != null) {
    try {
      const res = eng.closePositionResult(Number(cost), Number(qty), Number(price), fee_wan)
      return [res.realized_pnl, res]
    } catch {
      /* fallthrough */
    }
  }
  try {
    return [eng.r2(Number(ev.realized_pnl || 0)), null]
  } catch {
    return [0, null]
  }
}

export function buildAccount(
  events: LedgerEvent[] | null | undefined,
  fee_wan: number | null = null,
  positions: LedgerPositionLike[] | null = null,
): LedgerState {
  const evs = Array.isArray(events) ? [...events] : []
  const errors: string[] = []
  const notices: string[] = []

  if (evs.length > MAX_EVENTS) {
    errors.push(`账本事件数超过上限（${MAX_EVENTS}条），仅回放最近${MAX_EVENTS}条。`)
    evs.splice(0, evs.length - MAX_EVENTS)
  }

  let initial = 0
  let depositTotal = 0
  let withdrawTotal = 0
  let realized = 0
  let feeRateWan: number | null = null
  const applied: any[] = []
  const closedCodes: string[] = []

  const runningTotal = () => eng.r2(initial + depositTotal - withdrawTotal + realized)

  for (let idx = 0; idx < evs.length; idx++) {
    const raw = evs[idx]
    if (!raw || typeof raw !== 'object') {
      errors.push(`第${idx + 1}条事件格式非法，已跳过。`)
      continue
    }
    const kind = String((raw as any).type ?? (raw as any).kind ?? '').trim()
    if (!VALID_EVENTS.includes(kind)) {
      errors.push(`第${idx + 1}条事件类型「${kind}」无法识别，已跳过。`)
      continue
    }

    if (kind === EVENT_FEE_RATE) {
      const newWan = (raw as any).fee_rate_wan ?? (raw as any).fee_wan
      const vr = eng.validateFeeRate(newWan)
      if (!vr.ok) {
        errors.push(`第${idx + 1}条手续费率事件非法：${vr.msg}`)
        continue
      }
      feeRateWan = Number(newWan)
      applied.push({ type: kind, fee_rate_wan: feeRateWan, level: vr.level, note: (raw as any).note || '', ts: (raw as any).ts || '' })
      continue
    }

    if (kind === EVENT_CLOSE) {
      const useWan = (raw as any).fee_rate_wan ?? (feeRateWan != null ? feeRateWan : fee_wan)
      const fwan = useWan != null ? Number(useWan) : 1.2
      const [pnl, detail] = closePnl(raw as LedgerEvent, fwan)
      realized = eng.r2(realized + pnl)
      const code = String((raw as any).code || '').trim()
      if (code) closedCodes.push(code)
      applied.push({ type: kind, code, name: (raw as any).name || '', realized_pnl: pnl, detail, ts: (raw as any).ts || '' })
      continue
    }

    const [ok, amount, msg] = normalizeAmount(
      (raw as any).amount,
      kind === EVENT_DEPOSIT ? '添加保证金金额' : kind === EVENT_WITHDRAW ? '提取保证金金额' : '账户初始保证金',
    )
    if (!ok) {
      errors.push(`第${idx + 1}条事件被跳过：${msg}`)
      continue
    }

    if (kind === EVENT_INIT) {
      if (initial > 0) {
        errors.push(`第${idx + 1}条：账户初始保证金只能设置一次，已跳过重复录入。`)
        continue
      }
      initial = amount
    } else if (kind === EVENT_DEPOSIT) {
      if (runningTotal() + amount > MAX_MARGIN) {
        errors.push(`第${idx + 1}条：添加后账户总保证金将超过系统上限，已跳过。`)
        continue
      }
      depositTotal = eng.r2(depositTotal + amount)
    } else {
      // withdraw
      if (amount > runningTotal() + 1e-6) {
        errors.push(`第${idx + 1}条：提取金额${amount.toFixed(2)}元超过当时账户总保证金，已跳过。`)
        continue
      }
      withdrawTotal = eng.r2(withdrawTotal + amount)
    }
    applied.push({ type: kind, amount, note: (raw as any).note || '', ts: (raw as any).ts || '' })
  }

  if (feeRateWan == null) feeRateWan = fee_wan != null ? Number(fee_wan) : 1.2
  const feeVr = eng.validateFeeRate(feeRateWan)

  const totalMargin = runningTotal()
  const livePositions = (positions || []).filter((p) => !closedCodes.includes(String(p.code || '').trim()))
  const allocated = allocatedFromPositions(livePositions, feeRateWan)
  const available = eng.r2(totalMargin - allocated)
  const heldCount = livePositions.filter((p) => Number(p.qty || 0) > 0).length
  // 可开标的上限按「可用保证金」（未开仓资金）计算，而非账户总保证金
  const maxHold = available > 0 ? eng.maxHoldingCount(available) : 0

  const configured = initial > 0
  if (configured && totalMargin <= 0) {
    notices.push('账户总保证金已降至0元或以下：请先添加保证金后再计算方案。')
  }
  if (available < 0) {
    notices.push(
      `可分配余额为负（${available.toFixed(2)}元）：已有持仓占用资金已超过账户总保证金，请添加保证金或先了结部分标的。`,
    )
  }
  if (heldCount > maxHold && maxHold > 0) {
    notices.push(
      `当前在持${heldCount}个标的，超过按可用保证金${available.toFixed(2)}元计算的可开标的上限${maxHold}个：不应再开新标的，建议先了结${heldCount - maxHold}个标的。`,
    )
  }

  return {
    ok: Boolean(configured && totalMargin > 0 && feeVr.ok),
    configured,
    initial_margin: eng.r2(initial),
    deposit_total: eng.r2(depositTotal),
    withdraw_total: eng.r2(withdrawTotal),
    realized_pnl: eng.r2(realized),
    total_margin: totalMargin,
    allocated,
    available,
    held_count: heldCount,
    max_hold: maxHold,
    can_open_more: Math.max(maxHold - heldCount, 0),
    fee_rate_wan: feeRateWan,
    fee_level: feeVr.level,
    fee_msg: feeVr.msg,
    fee_model: eng.FEE_MODEL_VERSION,
    small_account: 0 < totalMargin && totalMargin < eng.SMALL_ACCOUNT_LIMIT,
    events: applied,
    closed_codes: closedCodes,
    errors,
    notices,
    terms: TERMS,
  }
}

export function checkWithdraw(account: Partial<LedgerState>, amount: any): [boolean, number, string] {
  const [ok, amt, msg] = normalizeAmount(amount, '提取保证金金额')
  if (!ok) return [false, 0, msg]
  if (!account.configured) return [false, 0, '请先设置账户初始保证金。']
  const available = Number(account.available || 0)
  if (available <= 0) return [false, 0, '当前可分配余额为0元，无可提取资金。']
  if (amt > available + 1e-6) {
    return [
      false,
      0,
      `提取金额${amt.toFixed(2)}元超过可分配余额${available.toFixed(2)}元；已有持仓占用的${Number(account.allocated || 0).toFixed(2)}元需先平仓才能提取。`,
    ]
  }
  return [true, amt, '']
}

export function previewChange(
  account: Partial<LedgerState>,
  kind: string,
  amount: any = null,
  fee_rate_wan: any = null,
): any {
  const k = String(kind || '').trim()
  const curTotal = Number(account.total_margin || 0)
  const curMax = Number(account.max_hold || 0)
  const held = Number(account.held_count || 0)
  const allocated = Number(account.allocated || 0)

  if (k === EVENT_FEE_RATE) {
    const vr = eng.validateFeeRate(fee_rate_wan)
    return {
      ok: vr.ok,
      level: vr.level,
      msg: vr.msg,
      fee_rate_wan: vr.ok ? fee_rate_wan : account.fee_rate_wan,
      requires_confirm: vr.level === 'warn_low' || vr.level === 'warn_high',
      note: '费率变更后，新计算的方案与保本价按新费率执行；历史平仓记录仍按当时费率入账。',
    }
  }

  let newTotal: number
  let amt = 0
  let ok = true
  let msg = ''
  if (k === EVENT_DEPOSIT) {
    ;[ok, amt, msg] = normalizeAmount(amount, '添加保证金金额')
    if (ok && curTotal + amt > MAX_MARGIN) {
      ok = false
      msg = '添加后账户总保证金将超过系统上限（10亿元）。'
    }
    newTotal = ok ? eng.r2(curTotal + amt) : curTotal
  } else if (k === EVENT_WITHDRAW) {
    ;[ok, amt, msg] = checkWithdraw(account, amount)
    newTotal = ok ? eng.r2(curTotal - amt) : curTotal
  } else {
    return { ok: false, msg: '不支持的账户变更类型。' }
  }

  const newMax = newTotal > 0 ? eng.maxHoldingCount(newTotal) : 0
  const out: any = {
    ok,
    msg,
    amount: ok ? amt : 0,
    total_margin_before: eng.r2(curTotal),
    total_margin_after: newTotal,
    max_hold_before: curMax,
    max_hold_after: newMax,
    available_after: eng.r2(newTotal - allocated),
    warnings: [],
  }
  if (ok && newMax < curMax) {
    out.warnings.push(`变更后可开标的上限将由${curMax}个降为${newMax}个。`)
    if (held > newMax) {
      out.warnings.push(`当前已在持${held}个标的，超过变更后的上限${newMax}个：建议先了结${held - newMax}个标的。`)
    }
  }
  if (ok && newMax > curMax) {
    out.warnings.push(`变更后可开标的上限将由${curMax}个升为${newMax}个。`)
  }
  if (ok && 0 < newTotal && newTotal < eng.SMALL_ACCOUNT_LIMIT && curTotal >= eng.SMALL_ACCOUNT_LIMIT) {
    out.warnings.push('变更后账户总保证金低于10万元：按规则只能计算1个标的，且不支持±20%调整。')
  }
  return out
}
