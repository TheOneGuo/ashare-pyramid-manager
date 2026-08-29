// utils/portfolioFormat.ts — 持仓 / 方案 / 费率 格式化

import type { PlanRow, Holding, Recommendation, AnalyzedStock, ExistingAdvice } from '@/api/portfolio'

export function fmtMoney(n: number | undefined | null, digits = 0): string {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtPct(n: number | undefined | null, digits = 1): string {
  if (n == null || isNaN(n)) return '—'
  return (n * 100).toFixed(digits) + '%'
}

export function fmtFeeWan(f: number | undefined | null): string {
  if (f == null) return ''
  // 万分之 N → 显示 N / 万分
  return f.toFixed(2) + ' / 万分'
}

export function parseFeeWan(s: string): number | null {
  const m = s.match(/(-?\d+(\.\d+)?)/)
  if (!m) return null
  return Number(m[1])
}

// 6 位代码补 0
export function padCode(s: string): string {
  return String(s || '').replace(/\D/g, '').padStart(6, '0').slice(-6)
}

// 解析 textarea 里多行 "代码 成本 数量" 格式
export function parseHoldingsText(text: string): { code: string; cost: number; qty: number }[] {
  const out: { code: string; cost: number; qty: number }[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const parts = t.split(/[\s,，\t]+/).filter(Boolean)
    if (parts.length < 3) continue
    const code = padCode(parts[0])
    if (!/^\d{6}$/.test(code)) continue
    const cost = Number(parts[1]) || 0
    const qty = Math.round(Number(parts[2])) || 0
    if (qty <= 0) continue
    out.push({ code, cost, qty })
  }
  return out
}

export function tierLabel(t: number | string): string {
  const n = Number(t)
  if (n === 0) return 'T0 (首笔)'
  if (n === 1) return 'T1 (首加)'
  if (n === 2) return 'T2 (二加)'
  if (n === 3) return 'T3 (止盈)'
  return `T${n}`
}

// 持仓 row 数据
export function normalizeHolding(h: any): { code: string; name: string; shares: number; cost: number; cur?: number; weight: number } {
  const cost = Number(h.cost_basis ?? h.cost ?? 0)
  const shares = Number(h.shares ?? h.qty ?? 0)
  const cur = h.cur != null ? Number(h.cur) : undefined
  return {
    code: h.stock_code || h.code,
    name: h.short_name || h.name || '',
    shares,
    cost,
    cur,
    weight: 0, // 实际权重由调用方在 compare grid 算
  }
}

export function normalizeRecommendation(r: any): { code: string; name: string; weight: number } {
  return {
    code: r.stock_code || r.code,
    name: r.stock_name || r.name || '',
    weight: Number(r.weight) || 0,
  }
}
