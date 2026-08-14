// api/portfolio.ts — 持仓分析 / 推荐对比 / 截图识别 后端调用
import { env } from '@/utils/env'

const API_BASE = (env.API_BASE_URL && env.API_BASE_URL.length > 0) ? env.API_BASE_URL : ''

// ---- 类型 ----
export interface Position {
  code: string
  name?: string
  cost: number
  qty: number
  cur?: number
}

export interface Holding {
  stock_code: string
  short_name?: string
  market?: string
  shares: number
  cost_basis: number
  added_at?: number
  updated_at?: number
}

export interface Recommendation {
  role: string
  stock_code: string
  stock_name?: string
  weight: number
  note?: string
  created_at?: number
  updated_at?: number
}

export type Role = 'institution' | 'hot_money' | 'northbound' | 'retail'

export const ROLE_LABELS: Record<Role, string> = {
  institution: '机构',
  hot_money: '游资',
  northbound: '北向资金',
  retail: '散户',
}

export const ALL_ROLES: Role[] = ['institution', 'hot_money', 'northbound', 'retail']

export interface ExtractResult {
  ok: boolean
  mock?: boolean
  note?: string
  count?: number
  positions?: Position[]
  error?: string
}

export interface PlanRow {
  tier: number | string
  price: number
  stop: number
  shares: number
  amount?: number
  pct?: number
  cost?: number
}

export interface TpRow {
  tier: number | string
  price: number
  cut_shares: number
  remain_shares: number
  dynamic_stop: number | null
}

export interface PlanResult {
  ok: boolean
  atr_pct?: number
  rows?: PlanRow[]
  tp_rows?: TpRow[]
  total_invest?: number
  remain?: number
  remain_pct?: number
  ratio_note?: string
  stop_loss_pct?: number
  degraded?: boolean
  too_expensive?: boolean
  notices?: string[]
}

export interface AnalyzedStock {
  code: string
  name?: string
  p0?: number
  atr?: number
  atr_pct?: number
  capital?: number
  plan?: PlanResult
  error?: string
  need_reprice?: boolean
  need_switch?: boolean
}

// ---- 账户与保证金账本（事件流） ----
export interface LedgerEvent {
  id?: number
  type: 'init' | 'deposit' | 'withdraw' | 'close_position' | 'fee_rate_change'
  payload: any
  ts?: number
}

export interface LedgerSnapshot {
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
  small_account: boolean
  errors?: string[]
  notices?: string[]
}

export interface LedgerTerms {
  initial_margin: string
  total_margin: string
  deposit: string
  withdraw: string
  realized_pnl: string
  allocated: string
  available: string
  max_hold: string
  fee_rate_wan: string
  suggested_capital: string
}

export interface LedgerState {
  ok: boolean
  events: LedgerEvent[]
  snapshot: LedgerSnapshot
  terms?: LedgerTerms
}

export interface LedgerPreview {
  ok: boolean
  msg?: string
  amount?: number
  total_margin_before?: number
  total_margin_after?: number
  max_hold_before?: number
  max_hold_after?: number
  available_after?: number
  requires_confirm?: boolean
  warnings?: string[]
}

// ---- 持仓方案跟踪 ----
export interface PlanItem {
  stock_code: string
  stock_name: string
  p0: number
  atr: number
  atr_pct?: number
  total_invest?: number
  plan_json: {
    rows?: PlanRow[]
    tp_rows?: TpRow[]
    total_invest?: number
    atr_pct?: number
    ratio_note?: string
    notices?: string[]
    stop_loss_pct?: number
  }
  created_at?: number
  updated_at?: number
}

export interface ExistingAdvice {
  type: 'global' | 'per_holding' | 'invalid'
  code?: string
  name?: string
  text?: string
  action?: string
  cost?: number
  qty?: number
  cur?: number
  atr?: number
  plan?: PlanResult
}

export interface AnalyzeReport {
  ok: boolean
  fee_level?: string
  fee_msg?: string
  total_capital?: number
  max_hold?: number
  stocks: AnalyzedStock[]
  existing_advice: ExistingAdvice[]
  notices: string[]
  confirms: any[]
  existing_summary?: { total_cost: number; market_value: number; net_value: number; pnl: number; loss: boolean }
  disclaimer?: string
  error?: string
  fee_confirm?: boolean
}

export interface CompareResult {
  ok: boolean
  role: string
  role_label: string
  user_holdings: Holding[]
  recommendations: Recommendation[]
  overlap: string[]
  only_in_user: Holding[]
  only_in_rec: Recommendation[]
  suggestions: { action: string; stock_code: string; stock_name?: string; reason: string; role?: string; role_label?: string; weight?: number }[]
}

// ---- AI 研报解读（结构化 mock，后续接真 LLM） ----
export interface ResearchModuleBlock {
  title: string
  summary: string
  points: string[]
  verdict?: string
}

export interface ResearchReport {
  ok: boolean
  stock_code: string
  stock_name: string
  query: string
  generated_at: string
  mode: 'mock' | 'llm'
  overall: string
  rating: string
  modules: ResearchModuleBlock[]
  disclaimer: string
}

// ---- 通用 fetch ----
async function jget<T>(path: string, opts: { method?: string; body?: any; timeoutMs?: number } = {}): Promise<T> {
  const url = `${API_BASE}${path}`
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: (opts.method || 'GET') as any,
      data: opts.body,
      timeout: opts.timeoutMs || 10000,
      header: { 'Content-Type': 'application/json' },
      success: (res: any) => {
        try {
          const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
          resolve(data as T)
        } catch (e) {
          reject(e as Error)
        }
      },
      fail: (err: any) => reject(new Error(err?.errMsg || err?.message || 'request fail')),
    })
  })
}

// ---- Holdings ----
export async function listHoldings(): Promise<Holding[]> {
  const r: any = await jget('/api/holdings')
  return r.items || []
}

export async function upsertHolding(body: { stock_code: string; short_name?: string; market?: string; shares: number; cost_basis: number }) {
  return jget('/api/holdings', { method: 'POST', body })
}

export async function deleteHolding(code: string) {
  return jget(`/api/holdings/${code}`, { method: 'DELETE' })
}

// ---- Roles + Recommendations ----
export async function listRoles(): Promise<Record<string, string>> {
  const r: any = await jget('/api/portfolio/roles')
  return r.roles || {}
}

export async function listRecommendations(role?: string | null): Promise<Recommendation[]> {
  const path = role ? `/api/portfolio/recommendations?role=${encodeURIComponent(role)}` : '/api/portfolio/recommendations'
  const r: any = await jget(path)
  return r.items || []
}

export async function bulkSetRecommendations(role: string, items: { stock_code: string; stock_name?: string; weight: number; note?: string }[]) {
  return jget('/api/portfolio/recommendations', { method: 'POST', body: { role, items } })
}

export async function deleteRecommendation(role: string, code: string) {
  return jget(`/api/portfolio/recommendations/${encodeURIComponent(role)}/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export async function compareWithRole(role: string): Promise<CompareResult> {
  return jget(`/api/portfolio/recommendations/compare?role=${encodeURIComponent(role)}`)
}

// ---- OCR 截图识别 ----
export async function extractFromImages(images: string[]): Promise<ExtractResult> {
  return jget('/api/portfolio/extract', { method: 'POST', body: { images }, timeoutMs: 30000 })
}

// ---- Analyze 主入口 ----
export async function analyzePortfolio(body: {
  total_capital: number
  fee_wan: number
  stocks: { code: string; name?: string; price?: number; capital?: number; atr?: number }[]
  existing?: { code: string; name?: string; cost: number; qty: number; cur?: number }[]
  last_action_date?: string | null
  fee_confirmed?: boolean
  price_confirmed_codes?: string[]
}): Promise<AnalyzeReport> {
  return jget('/api/portfolio/analyze', { method: 'POST', body, timeoutMs: 15000 })
}

// ---- AI 研报解读 ----
export async function researchReport(body: {
  stock_code?: string
  stock_name?: string
  query?: string
}): Promise<ResearchReport> {
  return jget('/api/portfolio/research', { method: 'POST', body, timeoutMs: 20000 })
}

// ---- 账户与保证金账本 ----
export async function getLedger(): Promise<LedgerState> {
  return jget('/api/portfolio/ledger')
}

export async function appendLedgerEvent(type: string, payload: any): Promise<LedgerState> {
  return jget('/api/portfolio/ledger', { method: 'POST', body: { type, payload }, timeoutMs: 15000 })
}

export async function previewLedgerEvent(type: string, amount?: number, fee_rate_wan?: number): Promise<{ ok: boolean; preview: LedgerPreview; snapshot: LedgerSnapshot }> {
  return jget('/api/portfolio/ledger/preview', { method: 'POST', body: { type, amount, fee_rate_wan }, timeoutMs: 15000 })
}

export async function clearLedger(): Promise<{ ok: boolean }> {
  return jget('/api/portfolio/ledger', { method: 'DELETE' })
}

// ---- 持仓方案跟踪 ----
export async function listPlans(): Promise<{ ok: boolean; items: PlanItem[] }> {
  return jget('/api/portfolio/plans')
}

export async function deletePlan(code: string): Promise<{ ok: boolean }> {
  return jget(`/api/portfolio/plans/${encodeURIComponent(code)}`, { method: 'DELETE' })
}
