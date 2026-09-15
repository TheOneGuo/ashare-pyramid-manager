// api/portfolio.ts — 持仓分析 / 推荐对比 / 截图识别 后端调用
//
// 2026-09-15 重构：原先这里自带一套 request()（硬编码 10s 超时、无重试、不校验 HTTP 状态码），
// 与 market.ts 的裸 fetch、news 页的裸 uni.request 三套并存。
// 现统一收敛到 utils/request.ts：URL 拼接 / 超时 / 失败重试 / HTTP 状态校验 / 错误归一化全部复用同一实现。
// 原 request(path, { method, body, timeoutMs }) 调用点已整体改名为 request(...)，参数语义不变。
import { request } from '@/utils/request'
import { cached, invalidate } from '@/utils/useCache'
import { CACHE_KEYS, CACHE_TTL_MS } from '@/utils/cacheConfig'

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

// ---- Holdings ----
// 持仓被多个页面共用（news 页筛相关新闻、portfolio 页展示），缓存 30s 减少重复往返。
// ⚠️ 任何写操作后必须 invalidate(CACHE_KEYS.holdings)，否则会读到旧持仓。
export async function listHoldings(opts?: { force?: boolean }): Promise<Holding[]> {
  const r: any = await cached<any>(CACHE_KEYS.holdings, CACHE_TTL_MS.holdings, () => request('/api/holdings'), {
    force: !!opts?.force,
  })
  return r?.items || []
}

export async function upsertHolding(body: { stock_code: string; short_name?: string; market?: string; shares: number; cost_basis: number }) {
  const r = await request('/api/holdings', { method: 'POST', body })
  invalidate(CACHE_KEYS.holdings)
  return r
}

export async function deleteHolding(code: string) {
  const r = await request(`/api/holdings/${code}`, { method: 'DELETE' })
  invalidate(CACHE_KEYS.holdings)
  return r
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
  const r = await request('/api/portfolio/holdings/import', { method: 'POST', body, timeout: 40000 })
  invalidate(CACHE_KEYS.holdings)
  return r
}

// 代码→名称/现价 实时补全（腾讯行情），给拟新买标的在输入后自动补名称
export async function resolveStockCode(code: string): Promise<{ ok: boolean; name: string; price: number | null; code: string }> {
  return request('/api/portfolio/resolve', { method: 'POST', body: { code }, timeout: 8000 })
}

// ---- Roles + Recommendations ----
// 角色字典基本静态（很少变更），缓存 10min
export async function listRoles(): Promise<Record<string, string>> {
  const r: any = await cached<any>(CACHE_KEYS.roles, CACHE_TTL_MS.roles, () => request('/api/portfolio/roles'))
  return r?.roles || {}
}

export async function listRecommendations(role?: string | null): Promise<Recommendation[]> {
  const path = role ? `/api/portfolio/recommendations?role=${encodeURIComponent(role)}` : '/api/portfolio/recommendations'
  const r: any = await request(path)
  return r.items || []
}

export async function bulkSetRecommendations(role: string, items: { stock_code: string; stock_name?: string; weight: number; note?: string }[]) {
  return request('/api/portfolio/recommendations', { method: 'POST', body: { role, items } })
}

export async function deleteRecommendation(role: string, code: string) {
  return request(`/api/portfolio/recommendations/${encodeURIComponent(role)}/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

export async function compareWithRole(role: string): Promise<CompareResult> {
  return request(`/api/portfolio/recommendations/compare?role=${encodeURIComponent(role)}`)
}

// ---- OCR 截图识别 ----
export async function extractFromImages(images: string[]): Promise<ExtractResult> {
  return request('/api/portfolio/extract', { method: 'POST', body: { images }, timeout: 30000 })
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
  return request('/api/portfolio/analyze', { method: 'POST', body, timeout: 15000 })
}

// ---- AI 研报解读（已持仓标的，十二模块） ----
export async function researchReport(body: {
  stock_code?: string
  stock_name?: string
  query?: string
}): Promise<ResearchReport> {
  return request('/api/portfolio/research', { method: 'POST', body, timeout: 20000 })
}

// ---- 研报 AI 精读（外部整篇研报入库 + 提炼） ----
export async function ingestReport(body: {
  title?: string
  broker?: string
  industry?: string
  source_url?: string
  raw_text: string
}): Promise<RefinedReport> {
  return request('/api/research/ingest', { method: 'POST', body, timeout: 20000 })
}

export async function listReports(): Promise<{ ok: boolean; items: RefinedReport[] }> {
  return request('/api/research/reports')
}

export async function deleteReport(id: string): Promise<{ ok: boolean }> {
  return request(`/api/research/reports/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// 已持仓标的研报持久化
function parseReport(r: any): ResearchReport | null {
  return r && r.report ? (r.report as ResearchReport) : null
}
export async function saveStockReport(stock_code: string, stock_name: string, report: ResearchReport): Promise<{ ok: boolean }> {
  return request('/api/research/stock-report', { method: 'POST', body: { stock_code, stock_name, report }, timeout: 15000 })
}

export async function listStockReports(): Promise<{ ok: boolean; items: StockReportItem[] }> {
  const r: any = await request('/api/research/stock-reports')
  return { ok: !!r.ok, items: (r.items || []).map((it: any) => ({ ...it, report: parseReport(it) })) }
}

export async function deleteStockReport(code: string): Promise<{ ok: boolean }> {
  return request(`/api/research/stock-reports/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

// ---- 账户与保证金账本 ----
export async function getLedger(): Promise<LedgerState> {
  return request('/api/portfolio/ledger')
}

export async function appendLedgerEvent(type: string, payload: any): Promise<LedgerState> {
  return request('/api/portfolio/ledger', { method: 'POST', body: { type, payload }, timeout: 15000 })
}

export async function previewLedgerEvent(type: string, amount?: number, fee_rate_wan?: number): Promise<{ ok: boolean; preview: LedgerPreview; snapshot: LedgerSnapshot }> {
  return request('/api/portfolio/ledger/preview', { method: 'POST', body: { type, amount, fee_rate_wan }, timeout: 15000 })
}

export async function clearLedger(): Promise<{ ok: boolean }> {
  return request('/api/portfolio/ledger', { method: 'DELETE' })
}

// ---- 持仓方案跟踪 ----
export async function listPlans(): Promise<{ ok: boolean; items: PlanItem[] }> {
  return request('/api/portfolio/plans')
}

export async function deletePlan(code: string): Promise<{ ok: boolean }> {
  return request(`/api/portfolio/plans/${encodeURIComponent(code)}`, { method: 'DELETE' })
}

// 显式「确认并加入跟踪」：把分析得到的方案写入持仓方案跟踪
export async function addPlan(item: {
  stock_code: string
  stock_name?: string
  p0?: number
  atr?: number
  plan_json: any
}): Promise<{ ok: boolean; persisted?: number }> {
  return request('/api/portfolio/plans', { method: 'POST', body: item })
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
  return request('/api/portfolio/holding-profiles')
}

export async function upsertHoldingProfile(body: Partial<HoldingProfile> & { stock_code: string }): Promise<{ ok: boolean }> {
  return request('/api/portfolio/holding-profiles', { method: 'POST', body })
}

export async function deleteHoldingProfile(code: string): Promise<{ ok: boolean }> {
  return request(`/api/portfolio/holding-profiles/${encodeURIComponent(code)}`, { method: 'DELETE' })
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
  return request(`/api/research/fxbaogao/search?${q.toString()}`, { timeout: 30000 })
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
  return request(`/api/research/fxbaogao/paragraphs?${q.toString()}`, { timeout: 20000 })
}
export async function getFxbaogaoPdfUrl(reportId: number): Promise<{ ok: boolean; reportId: number; url: string; viewUrl: string }> {
  return request(`/api/research/fxbaogao/pdf-url?reportId=${reportId}`, { timeout: 20000 })
}
export async function ingestFxbaogaoReport(params: { reportId: number; industry?: string }): Promise<{
  ok: boolean
  report?: any
  pdf_status?: string
  llm_used?: boolean
  raw_text_chars?: number
  error?: string
}> {
  return request('/api/research/fxbaogao/ingest', { method: 'POST', body: params, timeout: 120000 })
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
  return request('/api/research/fxbaogao/auto-search-holdings', { method: 'POST', body: params, timeout: 90000 })
}
export async function getFxbaogaoStatus(): Promise<{ ok: boolean; fxbaogao: { available: boolean; keyTail: string } }> {
  return request('/api/research/fxbaogao/status')
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
  return request(`/api/research/fxbaogao/sync${q}`, { method: 'POST', timeout: 15000 })
}
// 触发后台 AI 精读批次（fire-and-forget：服务端有 already_running 互斥）
export async function triggerFxbaogaoRefine(limit = 10): Promise<{ ok: boolean; started?: boolean; reason?: string }> {
  return request(`/api/research/fxbaogao/refine-batch?limit=${limit}`, { method: 'POST', body: {}, timeout: 10000 })
}
// 单条研报的 AI 精读结果（未精读时 refined 为 null）
export interface FxbaogaoExtract {
  stocks?: { code?: string; name?: string }[]
  industry?: string
  suppliers?: string[]
  buyers?: string[]
  regulations?: string[]
  raw_materials?: string[]
  origin_risks?: string[]
  orders?: string[]
  certifications?: string[]
  financials?: string[]
  key_persons?: string[]
}
export interface FxbaogaoAiResult {
  report_id: number
  title: string
  broker: string
  source_url: string
  tldr: string
  key_points: string[]
  opportunities: string[]
  risks: string[]
  status: string
  model: string
  report_type?: string
  extract?: FxbaogaoExtract
}
export async function getFxbaogaoAi(reportId: number): Promise<{ ok: boolean; reportId: number; refined: FxbaogaoAiResult | null }> {
  return request(`/api/research/fxbaogao/ai/${reportId}`, { timeout: 15000 })
}
// 精读库按个股检索：LLM 提取的标的（代码/名称）命中的已精读研报（含精读结果，免重复精读）
export interface FxbaogaoExtractItem {
  reportId: number
  title: string
  orgName: string
  broker: string
  pageNum: number
  pubDate: string
  recommended: boolean
  categories: string[]
  pdfUrl: string
  reportType: string
  industryName: string
  tldr: string
  key_points: string[]
  opportunities: string[]
  risks: string[]
  status: string
  model: string
  extract: FxbaogaoExtract
}
export async function searchFxbaogaoExtract(codes: string[], names: string[]): Promise<{ ok: boolean; items: FxbaogaoExtractItem[]; count: number }> {
  const q = new URLSearchParams()
  if (codes.length) q.set('codes', codes.join(','))
  if (names.length) q.set('names', names.join(','))
  return request(`/api/research/fxbaogao/search-extract?${q.toString()}`, { timeout: 15000 })
}
// 同步进度 + 库存量
export async function getFxbaogaoSyncStatus(): Promise<FxbaogaoSyncResult> {
  return request('/api/research/fxbaogao/sync', { timeout: 10000 })
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
  aiStatus?: number
  reportType?: string
  industryName?: string
  region?: string   // CN/US/KR/JP/TW/HK/GLOBAL/OTHER
  perspective?: string // 产业/金融/供应链/技术/订单/认证/''
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
  return request(`/api/research/fxbaogao/reports?${q.toString()}`, { timeout: 15000 })
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
  return request(`/api/research/fxbaogao/search?${q.toString()}`, { timeout: 30000 })
}
export async function listHoldingReports(params: {
  holdings: { stock_code: string; short_name?: string }[]
  timeRange?: string
  maxPerHolding?: number
}): Promise<{ ok: boolean; items: HoldingReportItem[]; count: number; timeRange: string }> {
  return request('/api/research/reports/by-holdings', { method: 'POST', body: params, timeout: 90000 })
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
  return request('/api/research/fxbaogao/auto-search-holdings-deep', { method: 'POST', body: params, timeout: 120000 })
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
  return request(`/api/research/reports/filtered?${q.toString()}`)
}
export async function getResearchReportsGroups(): Promise<{
  ok: boolean
  byDateRange: Record<string, number>
  byBroker: { broker: string; n: number }[]
  total: number
}> {
  return request('/api/research/reports/groups')
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
  return request(`/api/research/reports/${encodeURIComponent(id)}/view`, { timeout: 30000 })
}
