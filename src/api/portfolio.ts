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
  current_price?: number | null
  pnl?: number | null
  pnl_pct?: number | null
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

// 研报 AI 精读：外部整篇研报入库后提炼的结构
export interface RefinedReport {
  ok: boolean
  id: string
  title: string
  broker: string
  industry: string
  source_url: string
  raw_text: string
  tldr: string
  key_points: string[]
  opportunities: string[]
  risks: string[]
  status: string
  created_at: number
}

// 已持仓标的 AI 研报（逐标的持久化）
export interface StockReportItem {
  stock_code: string
  stock_name: string
  report: ResearchReport
  created_at: number
  updated_at: number
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

// 持仓富化入库：拍照/文件/手动 → 自动补全代码/名称/现价/盈亏
export async function importHoldings(body: {
  source: 'photo' | 'file' | 'manual' | 'text'
  images?: string[]
  file_b64?: string
  file_name?: string
  text?: string
  items?: { code?: string; name?: string; cost: number; shares: number }[]
}) {
  return jget('/api/portfolio/holdings/import', { method: 'POST', body, timeoutMs: 40000 })
}

// 代码→名称/现价 实时补全（腾讯行情），给拟新买标的在输入后自动补名称
export async function resolveStockCode(code: string): Promise<{ ok: boolean; name: string; price: number | null; code: string }> {
  return jget('/api/portfolio/resolve', { method: 'POST', body: { code }, timeoutMs: 8000 })
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

// ---- AI 研报解读（已持仓标的，十二模块） ----
export async function researchReport(body: {
  stock_code?: string
  stock_name?: string
  query?: string
}): Promise<ResearchReport> {
  return jget('/api/portfolio/research', { method: 'POST', body, timeoutMs: 20000 })
}

// ---- 研报 AI 精读（外部整篇研报入库 + 提炼） ----
export async function ingestReport(body: {
  title?: string
  broker?: string
  industry?: string
  source_url?: string
  raw_text: string
}): Promise<RefinedReport> {
  return jget('/api/research/ingest', { method: 'POST', body, timeoutMs: 20000 })
}

export async function listReports(): Promise<{ ok: boolean; items: RefinedReport[] }> {
  return jget('/api/research/reports')
}

export async function deleteReport(id: string): Promise<{ ok: boolean }> {
  return jget(`/api/research/reports/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// 已持仓标的研报持久化
function parseReport(r: any): ResearchReport | null {
  return r && r.report ? (r.report as ResearchReport) : null
}
export async function saveStockReport(stock_code: string, stock_name: string, report: ResearchReport): Promise<{ ok: boolean }> {
  return jget('/api/research/stock-report', { method: 'POST', body: { stock_code, stock_name, report }, timeoutMs: 15000 })
}

export async function listStockReports(): Promise<{ ok: boolean; items: StockReportItem[] }> {
  const r: any = await jget('/api/research/stock-reports')
  return { ok: !!r.ok, items: (r.items || []).map((it: any) => ({ ...it, report: parseReport(it) })) }
}

export async function deleteStockReport(code: string): Promise<{ ok: boolean }> {
  return jget(`/api/research/stock-reports/${encodeURIComponent(code)}`, { method: 'DELETE' })
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

// 显式「确认并加入跟踪」：把分析得到的方案写入持仓方案跟踪
export async function addPlan(item: {
  stock_code: string
  stock_name?: string
  p0?: number
  atr?: number
  plan_json: any
}): Promise<{ ok: boolean; persisted?: number }> {
  return jget('/api/portfolio/plans', { method: 'POST', body: item })
}

// ---- 持仓产业链画像（可编辑，间接关联匹配用） ----
export interface HoldingProfile {
  stock_code: string
  short_name?: string
  industry?: string
  raw_materials: string[]
  products: string[]
  customers: string[]
  overseas_peers: string[]
  policy_domains: string[]
  transport: string[]
  extra_keywords: string[]
  from_db?: boolean
  updated_at?: number
}

export async function listHoldingProfiles(): Promise<{ ok: boolean; profiles: HoldingProfile[] }> {
  return jget('/api/portfolio/holding-profiles')
}

export async function upsertHoldingProfile(body: Partial<HoldingProfile> & { stock_code: string }): Promise<{ ok: boolean }> {
  return jget('/api/portfolio/holding-profiles', { method: 'POST', body })
}

export async function deleteHoldingProfile(code: string): Promise<{ ok: boolean }> {
  return jget(`/api/portfolio/holding-profiles/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

// ============================================================================
// 发现报告 (fxbaogao.com) 搜索 + 精读 + 下载
// ============================================================================
export interface FxbaogaoReport {
  reportId: number
  title: string
  orgName: string
  pageNum: number
  pubTime: number
  pubTimeStr: string
  paragraphs: any[]
  viewUrl: string
}
export interface FxbaogaoSearchResult {
  ok: boolean
  items: FxbaogaoReport[]
  count: number
  pageNum: number
  startTime: string
  keywords: string
}
export async function searchFxbaogao(params: {
  keywords?: string
  startTime?: string
  pageNum?: number
  orgNames?: string[]
}): Promise<FxbaogaoSearchResult> {
  const q = new URLSearchParams()
  if (params.keywords) q.set('keywords', params.keywords)
  if (params.startTime) q.set('startTime', params.startTime)
  if (params.pageNum) q.set('pageNum', String(params.pageNum))
  if (params.orgNames?.length) q.set('orgNames', params.orgNames.join(','))
  return jget(`/api/research/fxbaogao/search?${q.toString()}`, { timeoutMs: 30000 })
}
export interface FxbaogaoParagraphsResp {
  ok: boolean
  summary: string
  toc: any[]
  hits: any[]
  raw: string
}
export async function getFxbaogaoParagraphs(params: { reportId: number; keyword?: string }): Promise<FxbaogaoParagraphsResp> {
  const q = new URLSearchParams({ reportId: String(params.reportId) })
  if (params.keyword) q.set('keyword', params.keyword)
  return jget(`/api/research/fxbaogao/paragraphs?${q.toString()}`, { timeoutMs: 20000 })
}
export async function getFxbaogaoPdfUrl(reportId: number): Promise<{ ok: boolean; reportId: number; url: string; viewUrl: string }> {
  return jget(`/api/research/fxbaogao/pdf-url?reportId=${reportId}`, { timeoutMs: 20000 })
}
export async function ingestFxbaogaoReport(params: { reportId: number; industry?: string }): Promise<{
  ok: boolean
  report?: any
  pdf_status?: string
  llm_used?: boolean
  raw_text_chars?: number
  error?: string
}> {
  return jget('/api/research/fxbaogao/ingest', { method: 'POST', body: params, timeoutMs: 120000 })
}
export interface FxbaogaoAutoSearchItem {
  code: string
  name: string
  count: number
  items: FxbaogaoReport[]
  error?: string
}
export async function autoSearchFxbaogaoForHoldings(params: {
  holdings: { stock_code: string; short_name?: string }[]
  timeRange?: string
}): Promise<{ ok: boolean; results: FxbaogaoAutoSearchItem[]; timeRange: string }> {
  return jget('/api/research/fxbaogao/auto-search-holdings', { method: 'POST', body: params, timeoutMs: 90000 })
}
export async function getFxbaogaoStatus(): Promise<{ ok: boolean; fxbaogao: { available: boolean; keyTail: string } }> {
  return jget('/api/research/fxbaogao/status')
}

// ---- 分片同步入库（全量研报 → 数据库） ----
export interface FxbaogaoSyncProgress {
  running: boolean
  startedAt: number
  finishedAt: number
  shardTotal: number
  shardDone: number
  fetched: number
  upserted: number
  errors: number
  lastError: string
  totalInDb: number
  windowDays: number
}
export interface FxbaogaoSyncResult {
  ok: boolean
  started?: boolean
  windowDays?: number
  progress: FxbaogaoSyncProgress
  total?: number
  latestPubTime?: number
}
// 触发同步（异步，轮询 status 拿进度）
export async function syncFxbaogaoAll(windowDays?: number): Promise<FxbaogaoSyncResult> {
  const q = windowDays ? `?windowDays=${windowDays}` : ''
  return jget(`/api/research/fxbaogao/sync${q}`, { method: 'POST', timeoutMs: 15000 })
}
// 同步进度 + 库存量
export async function getFxbaogaoSyncStatus(): Promise<FxbaogaoSyncResult> {
  return jget('/api/research/fxbaogao/sync', { timeoutMs: 10000 })
}
// 从库分页读取全量研报（startMs/endMs 毫秒）
export interface DbReportItem {
  reportId: number
  title: string
  orgName: string
  pageNum: number
  pubTime: number
  pubTimeStr: string
  recommended: boolean
  categories: string[]
  pdfUrl?: string   // PDF 直链缓存（命中即「秒开」原文）
}
export async function listFxbaogaoDbReports(params: {
  pageNum?: number
  pageSize?: number
  startMs?: number
  endMs?: number
}): Promise<{ ok: boolean; items: DbReportItem[]; count: number; pageNum: number; pageSize: number; total: number; latestPubTime: number }> {
  const q = new URLSearchParams()
  if (params.pageNum) q.set('pageNum', String(params.pageNum))
  if (params.pageSize) q.set('pageSize', String(params.pageSize))
  if (params.startMs) q.set('startMs', String(params.startMs))
  if (params.endMs) q.set('endMs', String(params.endMs))
  return jget(`/api/research/fxbaogao/reports?${q.toString()}`, { timeoutMs: 15000 })
}

// ============================================================================
// 统一列表（Tab 1 主源）+ 深度多维度搜索（Tab 3 升级）
// ============================================================================
export interface HoldingReportItem {
  source: 'fxbaogao'
  key: string
  reportId: number
  title: string
  orgName: string
  pubDate: string
  pageNum: number
  viewUrl: string
  recommended: boolean
  categories: string[]
  holdingCode: string
  holdingName: string
  broker: string
}
// 全部研报 Tab 1：通用列表项
export interface AllReportItem {
  reportId: number
  title: string
  orgName: string
  pubDate: string
  pageNum: number
  viewUrl: string
  recommended: boolean
  categories: string[]
  broker: string
}
export interface AllReportsResult {
  ok: boolean
  items: AllReportItem[]
  count: number
  pageNum: number
  startTime: string
  keywords: string
}
export async function listAllReports(params: {
  keywords?: string
  startTime?: string
  pageNum?: number
}): Promise<AllReportsResult> {
  const q = new URLSearchParams()
  if (params.keywords) q.set('keywords', params.keywords)
  if (params.startTime) q.set('startTime', params.startTime)
  if (params.pageNum) q.set('pageNum', String(params.pageNum))
  return jget(`/api/research/fxbaogao/search?${q.toString()}`, { timeoutMs: 30000 })
}
export async function listHoldingReports(params: {
  holdings: { stock_code: string; short_name?: string }[]
  timeRange?: string
  maxPerHolding?: number
}): Promise<{ ok: boolean; items: HoldingReportItem[]; count: number; timeRange: string }> {
  return jget('/api/research/reports/by-holdings', { method: 'POST', body: params, timeoutMs: 90000 })
}

export interface DeepSearchByTopic {
  code: string
  name: string
  byTopic: Record<string, HoldingReportItem[]>
  error?: string
}
export async function deepSearchForHoldings(params: {
  holdings: { stock_code: string; short_name?: string }[]
  topics?: ('industry' | 'supplier' | 'buyer' | 'regulation')[]
  timeRange?: string
}): Promise<{ ok: boolean; results: DeepSearchByTopic[]; timeRange: string; topics: string[] }> {
  return jget('/api/research/fxbaogao/auto-search-holdings-deep', { method: 'POST', body: params, timeoutMs: 120000 })
}

// 全部研报列表（带日期/机构筛选）
export async function getResearchReportsFiltered(params: { dateRange?: string; institution?: string }): Promise<{
  ok: boolean
  items: any[]
  count: number
  dateRange: string
  institution: string
}> {
  const q = new URLSearchParams()
  if (params.dateRange) q.set('dateRange', params.dateRange)
  if (params.institution) q.set('institution', params.institution)
  return jget(`/api/research/reports/filtered?${q.toString()}`)
}
export async function getResearchReportsGroups(): Promise<{
  ok: boolean
  byDateRange: Record<string, number>
  byBroker: { broker: string; n: number }[]
  total: number
}> {
  return jget('/api/research/reports/groups')
}
export async function getResearchReportView(id: string): Promise<{
  ok: boolean
  type: 'pdf' | 'markdown'
  pdfUrl?: string
  markdown?: string
  title?: string
  broker?: string
  error?: string
}> {
  return jget(`/api/research/reports/${encodeURIComponent(id)}/view`, { timeoutMs: 30000 })
}
