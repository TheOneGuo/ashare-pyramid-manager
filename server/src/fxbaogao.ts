// server/src/fxbaogao.ts · 发现报告 (fxbaogao.com) MCP 客户端
//
// 在线 HTTP 版：POST https://api.fxbaogao.com/mcp/  with JSON-RPC 2.0
// 仅暴露 3 个核心 tool：search_reports / get_paragraphs / get_pdf_url
// 缓存：search 结果按 query+page+timeRange 缓存 60s（防重复点击）
//
// 凭证：FXBAOGAO_API_KEY 走 .env，绝不在日志/响应里出现完整 key

import { env } from 'node:process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const API_KEY = (env.FXBAOGAO_API_KEY || '').trim()
const ENDPOINT = 'https://api.fxbaogao.com/mcp/'

export function isFxbaogaoAvailable(): boolean {
  return API_KEY.length > 0
}
export function fxbaogaoKeyTail(): string {
  // 调试用：只返回后 4 位，前缀 0 隐藏
  if (!API_KEY) return ''
  return API_KEY.length > 4 ? '****' + API_KEY.slice(-4) : '****'
}

// ── 缓存 ──
type CacheEntry<T> = { ts: number; data: T }
const cache = new Map<string, CacheEntry<any>>()
const CACHE_TTL_MS = 60_000
function getCached<T>(key: string): T | null {
  const e = cache.get(key)
  if (!e) return null
  if (Date.now() - e.ts > CACHE_TTL_MS) { cache.delete(key); return null }
  return e.data as T
}
function setCached<T>(key: string, data: T) {
  cache.set(key, { ts: Date.now(), data })
  if (cache.size > 200) {
    // 简单 LRU：清掉前 50 个
    const keys = [...cache.keys()].slice(0, 50)
    keys.forEach((k) => cache.delete(k))
  }
}

// ── JSON-RPC 核心 ──
async function rpcCall<T = any>(toolName: string, args: Record<string, any>): Promise<T> {
  if (!isFxbaogaoAvailable()) {
    throw new Error('FXBAOGAO_API_KEY not configured (set in server/.env)')
  }
  const payload = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  }
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`fxbaogao HTTP ${r.status}: ${text.slice(0, 200)}`)
  }
  const data: any = await r.json()
  if (data?.error) {
    throw new Error(`fxbaogao RPC error: ${data.error.message || JSON.stringify(data.error)}`)
  }
  // MCP 显式错误标记
  if (data?.result?.isError) {
    const errText = String(data?.result?.content?.[0]?.text || 'unknown error').slice(0, 150)
    throw new Error(`fxbaogao tool error: ${errText}`)
  }
  // result.content[0].text 是 JSON 字符串
  const txt: string = data?.result?.content?.[0]?.text
  if (!txt) {
    if (data?.result?.isError) {
      throw new Error(`fxbaogao tool error: ${txt || 'unknown'}`)
    }
    return [] as unknown as T
  }
  // 服务端频控/业务错误：返回非 JSON 的错误文本（如「请求超速」），直接抛错，
  // 避免把错误文案当成合法数据（例如被当作 PDF URL）往下游传。
  const trimmed = txt.trim()
  if (!/^[\[{]/u.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    // 期望 get_pdf_url 返回 URL 字符串，其余非 JSON 文本按错误处理
    if (/超速|限流|失败|错误|无效|异常|权益|用完|未登录|需登录|权限|too\s*many|rate\s*limit|error|invalid/i.test(txt)) {
      throw new Error(`fxbaogao tool error: ${txt.slice(0, 150)}`)
    }
  }
  // 解析失败兜底
  try { return JSON.parse(txt) as T } catch { return txt as unknown as T }
}

// ── 数据类型 ──
export interface FxbaogaoReport {
  reportId: number
  title: string
  orgName: string         // 来源机构（高盛 / 浙商证券 / 财报 / 招股说明书...）
  pageNum: number
  pubTime: number         // 秒级时间戳
  pubTimeStr: string      // '2026/08/27/'
  industryName: string    // fxbaogao 自带行业分类（食品饮料/金融/机械设备...）
  paragraphs: any[]
  viewUrl: string         // 拼接的官网阅读链接
}

export interface FxbaogaoParagraphsResp {
  summary: string
  toc: any[]
  hits: any[]
  raw: string             // 原始 JSON 字符串（兜底）
}

// ── 公开 API ──
export async function searchFxbaogaoReports(args: {
  keywords?: string
  startTime?: string       // 'last7day' | 'last1mon' | 'last3mon' | 'last1year' | ms timestamp string
  endTime?: string         // ms timestamp string
  pageNum?: number
  orgNames?: string[]
}): Promise<FxbaogaoReport[]> {
  const pageNum = Math.min(Math.max(args.pageNum || 1, 1), 200)
  const cacheKey = JSON.stringify({ k: args.keywords, s: args.startTime, e: args.endTime, p: pageNum, o: args.orgNames })
  const cached = getCached<FxbaogaoReport[]>(cacheKey)
  if (cached) return cached

  const data = await rpcCall<any[]>('search_reports', {
    keywords: args.keywords || '',
    startTime: args.startTime || 'last1mon',
    pageNum,
    ...(args.endTime ? { endTime: args.endTime } : {}),
    ...(args.orgNames && args.orgNames.length ? { orgNames: args.orgNames } : {}),
  })
  const list: FxbaogaoReport[] = Array.isArray(data) ? data.map((r: any) => ({
    reportId: Number(r.reportId),
    title: String(r.title || '').replace(/<[^>]+>/g, ''), // 去 <em> 高亮
    orgName: String(r.orgName || '').replace(/<[^>]+>/g, ''),
    pageNum: Number(r.pageNum || 0),
    pubTime: Number(r.pubTime || 0),
    pubTimeStr: String(r.pubTimeStr || ''),
    industryName: String(r.industryName || '').replace(/<[^>]+>/g, ''),
    paragraphs: (r.paragraphs || []).map((p: any) => ({
      ...p,
      content: String(p?.content || p?.text || '').replace(/<[^>]+>/g, ''),
    })),
    viewUrl: `https://www.fxbaogao.com/view?id=${r.reportId}`,
  })) : []
  setCached(cacheKey, list)
  return list
}

export async function getFxbaogaoParagraphs(args: { reportId: number; keyword?: string }): Promise<FxbaogaoParagraphsResp> {
  const cacheKey = `p:${args.reportId}:${args.keyword || ''}`
  const cached = getCached<FxbaogaoParagraphsResp>(cacheKey)
  if (cached) return cached
  const data = await rpcCall<any>('get_paragraphs', { reportId: args.reportId, keyword: args.keyword || '' })
  // data 可能是对象 {summary, toc, hits, content} 或字符串
  let resp: FxbaogaoParagraphsResp
  if (typeof data === 'string') {
    resp = { summary: data, toc: [], hits: [], raw: data }
  } else if (data && typeof data === 'object') {
    resp = {
      summary: String(data.summary || data.content || data.text || ''),
      toc: Array.isArray(data.toc) ? data.toc : [],
      hits: Array.isArray(data.hits) ? data.hits : (Array.isArray(data.paragraphs) ? data.paragraphs : []),
      raw: JSON.stringify(data).slice(0, 60000),
    }
  } else {
    resp = { summary: '', toc: [], hits: [], raw: '' }
  }
  setCached(cacheKey, resp)
  return resp
}

// ── get_pdf_url 限流/额度熔断 ──────────────────────────────
// fxbaogao 下载接口有严格频控（返回「请求超速」code 300013），且受账号月度下载额度约束
// （高级VIP 约 600 篇/月，超限返回「权益已用完」）。一旦触发就全局熔断一段时间，
// 期间所有 get_pdf_url 直接快速失败，避免反复重试把剩余额度/时间窗口烧光。
let pdfUrlBlockedUntil = 0
let pdfUrlBlockReason = ''
const PDF_URL_BLOCK_RATE_MS = 30 * 60 * 1000      // 限流（请求超速）：熔断 30 分钟
const PDF_URL_BLOCK_QUOTA_MS = 8 * 60 * 60 * 1000 // 额度（权益已用完）：熔断 8 小时

export function isPdfUrlBlocked(): { blocked: boolean; until: number; reason: string } {
  if (Date.now() < pdfUrlBlockedUntil) return { blocked: true, until: pdfUrlBlockedUntil, reason: pdfUrlBlockReason }
  return { blocked: false, until: 0, reason: '' }
}
function blockPdfUrl(reason: string, ms: number) {
  pdfUrlBlockReason = reason
  pdfUrlBlockedUntil = Math.max(pdfUrlBlockedUntil, Date.now() + ms)
}
export function resetPdfUrlBlock() {
  pdfUrlBlockedUntil = 0
  pdfUrlBlockReason = ''
}

// 从直链提取 auth_key 过期时间（秒）。无 auth_key → 返回 0（无法判定，乐观视为可用）
function pdfUrlAuthExpiry(url: string): number {
  const m = String(url || '').match(/auth_key=(\d{10})/)
  return m ? Number(m[1]) : 0
}
// 缓存直链是否仍有效：无 auth_key 时乐观可用；有 auth_key 时必须在过期前（留 5 分钟余量）
function isCachedPdfUrlUsable(url: string): boolean {
  const exp = pdfUrlAuthExpiry(url)
  if (!exp) return /^https?:\/\//i.test(String(url || ''))
  return exp > Math.floor(Date.now() / 1000) + 300
}

// get_pdf_url 有严格频控，连续调用会返回「请求超速」；做最小间隔限速 + 退避重试
let lastPdfUrlAt = 0
const PDF_URL_MIN_INTERVAL_MS = 800
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── 每日新下载预算（21 点任务专用） ────────────────────
// index.js 注入两个钩子：
//   downloadGuard：返回是否还允许「新签发」下载（剩额度 > 0）——决定是否消耗月度额度
//   newDownloadHook：get_pdf_url 成功签发后回调（当日新下载数 +1）
// 手动精读（refine-batch / ingest）不注入 guard，不受预算限制。
let downloadGuard: (() => boolean) | null = null
let newDownloadHook: ((reportId: number) => void) | null = null
export function setDownloadGuard(fn: (() => boolean) | null) { downloadGuard = fn }
export function setNewDownloadHook(fn: ((reportId: number) => void) | null) { newDownloadHook = fn }

export async function getFxbaogaoPdfUrl(args: { reportId: number }, attempt = 0): Promise<string> {
  const cacheKey = `u:${args.reportId}`
  const cached = getCached<string>(cacheKey)
  if (cached) return cached
  // 熔断：快速失败，不再消耗调用次数
  const blk = isPdfUrlBlocked()
  if (blk.blocked) throw new Error(`fxbaogao 下载接口暂时受限：${blk.reason}，请稍后再试`)
  // 每日预算：21 点任务到达上限后，新签发直接失败（cached 命中/复用直链不受影响）
  if (downloadGuard && !downloadGuard()) {
    throw new Error('今日新下载预算已用完（19 篇），请明日 21 点任务再下载新研报')
  }
  const wait = PDF_URL_MIN_INTERVAL_MS - (Date.now() - lastPdfUrlAt)
  if (wait > 0) await sleepMs(wait)
  try {
    const data = await rpcCall<any>('get_pdf_url', { reportId: args.reportId })
    // data 可能是字符串 URL 或对象
    let url = ''
    if (typeof data === 'string') {
      // 抓 URL
      const m = data.match(/https?:\/\/[^\s'"<>]+/i)
      url = m ? m[0] : ''
    } else if (data && typeof data === 'object') {
      url = String(data.url || data.pdfUrl || data.downloadUrl || '')
    }
    lastPdfUrlAt = Date.now()
    // 校验：必须返回合法 http(s) 直链，否则视为失败（不缓存错误值，留给下游重试）
    if (!/^https?:\/\/[^\s]+$/i.test(url)) {
      if (attempt < 2) {
        await sleepMs(1000 * (attempt + 1))
        return getFxbaogaoPdfUrl(args, attempt + 1)
      }
      throw new Error(`fxbaogao: invalid/empty pdf url: ${String(url || data || '').slice(0, 60)}`)
    }
    setCached(cacheKey, url)
    // 成功签发 = 消耗 1 次下载额度 → 当日计数 +1（21 点任务预算用）
    if (newDownloadHook) { try { newDownloadHook(Number(args.reportId)) } catch {} }
    return url
  } catch (e) {
    lastPdfUrlAt = Date.now()
    const msg = String(e?.message || e)
    // 限流/额度：设置熔断，向上抛清晰错误
    if (/请求超速|超速|限流|too\s*many|rate\s*limit/i.test(msg)) {
      blockPdfUrl('下载接口限流（请求超速）', PDF_URL_BLOCK_RATE_MS)
      throw new Error('fxbaogao 下载接口限流（请求超速），系统已自动暂停下载，请稍后再试')
    }
    if (/权益|用完|额度|quota|exhaust/i.test(msg)) {
      blockPdfUrl('本月下载额度已用尽', PDF_URL_BLOCK_QUOTA_MS)
      throw new Error('fxbaogao 本月下载额度已用尽，暂时无法下载新 PDF，请下月或升级会员后再试')
    }
    if (attempt < 2) {
      await sleepMs(1000 * (attempt + 1))
      return getFxbaogaoPdfUrl(args, attempt + 1)
    }
    throw e
  }
}

// ── 本地磁盘 PDF 缓存 ─────────────────────────────────────
// 每次成功下载的 PDF 落盘缓存。之后精读/重试同一 reportId 直接读本地，
// 不再消耗 get_pdf_url 调用次数与月度下载额度。
// 版权约束：已购研报仅供用户本人使用，缓存目录不入 git（server/.gitignore 已加 data/）。
const PDF_CACHE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/fxbaogao-pdfs')
function pdfCachePath(reportId: number): string {
  return path.join(PDF_CACHE_DIR, `${Number(reportId)}.pdf`)
}
export function hasCachedPdf(reportId: number): boolean {
  try { return existsSync(pdfCachePath(reportId)) } catch { return false }
}
function readCachedPdf(reportId: number): Buffer | null {
  try {
    const p = pdfCachePath(reportId)
    if (!existsSync(p)) return null
    const buf = readFileSync(p)
    if (buf.length < 2000) return null // 太小的视为坏缓存，重新下载
    return buf
  } catch { return null }
}
export function saveCachedPdf(reportId: number, buf: Buffer) {
  try {
    if (!buf || buf.length < 2000) return
    mkdirSync(PDF_CACHE_DIR, { recursive: true })
    writeFileSync(pdfCachePath(reportId), buf)
  } catch {}
}

// 下载 PDF 到 buffer（供后端解析文本用）
// 第一优先：本地磁盘缓存（免费）；其次：DB 缓存直链（不消耗 get_pdf_url 额度）；
// 最后才走 get_pdf_url（消耗额度，有频控/额度熔断兜底）。
export async function downloadFxbaogaoPdf(args: { reportId: number }, knownUrl = ''): Promise<Buffer> {
  // 1) 磁盘缓存命中：直接返回，完全不占线上额度
  const cachedBuf = readCachedPdf(Number(args.reportId))
  if (cachedBuf) return cachedBuf
  // 2) 已知直链未过期优先
  const isKnownUsable = isCachedPdfUrlUsable(knownUrl)
  let url = isKnownUsable ? knownUrl : ''
  if (!url) url = await getFxbaogaoPdfUrl(args)
  if (!url) throw new Error('fxbaogao: empty pdf url')
  if (!/^https?:\/\//i.test(url)) throw new Error(`fxbaogao: invalid pdf url: ${String(url).slice(0, 60)}`)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ashare-pyramid-manager/1.0' } })
      if (!r.ok) {
        // 403/404/410：auth_key 过期或链接失效 → 且已知直链不可用时刷新一次
        if (attempt === 0 && !isKnownUsable && (r.status === 403 || r.status === 404 || r.status === 410)) {
          url = await getFxbaogaoPdfUrl(args)
          continue
        }
        throw new Error(`fxbaogao PDF download failed: HTTP ${r.status}`)
      }
      const ab = await r.arrayBuffer()
      const buf = Buffer.from(ab)
      saveCachedPdf(Number(args.reportId), buf) // 3) 下载成功即落盘，此后免费复用
      return buf
    } catch (e) {
      // 已知直链下载时网络失败/失效 → 刷新直链重试一次（限流会在 getFxbaogaoPdfUrl 内熔断）
      if (attempt === 0 && isKnownUsable) {
        url = await getFxbaogaoPdfUrl(args)
        continue
      }
      throw e
    }
  }
  throw new Error('fxbaogao: pdf download failed after retry')
}

// ── 分片同步（全量研报入库） ─────────────────────────────
// 单次 search 最多返回 PAGE_MAX 条（20/页 × 上限页数），且不支持一次翻全量，
// 因此按时间窗口把大范围切成若干小片，逐片逐页拉取、去重后批量入库。
// API 对高频连续请求容易超时，故调用间留固定间隔（SYNC_DELAY_MS）。

const SYNC_PAGE_MAX = 200          // 单个时间片内最多翻的页数
const SYNC_PAGE_SIZE = 20          // 每页条数（服务端行为，若变化动态感知）
const SYNC_DELAY_MS = 250          // 连续请求间隔（ms）
const DEFAULT_SYNC_DAYS = 30       // 默认回拉近 N 天

export interface SyncProgress {
  running: boolean
  startedAt: number
  finishedAt: number
  shardTotal: number
  shardDone: number
  fetched: number        // 本片命中去重数
  upserted: number       // 已入库（含幂等）
  errors: number
  lastError: string
  totalInDb: number
  windowDays: number
}

let syncState: SyncProgress = {
  running: false, startedAt: 0, finishedAt: 0, shardTotal: 0, shardDone: 0,
  fetched: 0, upserted: 0, errors: 0, lastError: '', totalInDb: 0, windowDays: 0,
}
export function getSyncProgress(): SyncProgress { return { ...syncState } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 逐片分页收集一个 [startMs, endMs] 窗口内的全部去重研报
async function collectWindow(startMs: number, endMs: number, visit: (r: FxbaogaoReport) => void) {
  const ids = new Set<number>()
  let dupSeen = false
  for (let p = 1; p <= SYNC_PAGE_MAX; p++) {
    const list = await searchFxbaogaoReports({
      keywords: '', startTime: String(startMs), endTime: String(endMs), pageNum: p,
    })
    if (!Array.isArray(list) || list.length === 0) break
    for (const r of list) {
      if (ids.has(r.reportId)) { dupSeen = true; continue }
      ids.add(r.reportId)
      visit(r)
    }
    // 只剩重复（到达本窗口尾部）或不足一页 → 停止
    if (dupSeen || list.length < SYNC_PAGE_SIZE) break
    await sleep(SYNC_DELAY_MS)
  }
}

// 将最近 windowDays 天按「天」分片，逐片入库。
// onBatch(row[]) 每满一批回调一次，交给 db.upsertFxbaogaoReports。
export async function syncFxbaogaoToDb(opts: {
  windowDays?: number
  onStats?: (s: SyncProgress) => void
  upsert: (rows: FxbaogaoReport[]) => Promise<number>
}): Promise<SyncProgress> {
  if (syncState.running) { return { ...syncState, running: true } }
  const windowDays = Math.min(Math.max(Number(opts.windowDays) || DEFAULT_SYNC_DAYS, 1), 365)
  const now = Date.now()
  // 以自然日（本地时区）对齐，从当前时刻往前逐天
  const localDayStart = (t: number) => { const x = new Date(t); x.setHours(0,0,0,0); return x.getTime() }
  const todayStart = localDayStart(now)
  const shards: Array<{ start: number; end: number }> = []
  for (let i = 0; i < windowDays; i++) {
    const start = todayStart - i * 86400000
    if (start > now) continue
    let end = start + 86400000 - 1
    if (end > now) end = now // 今天只拉到当前时刻
    shards.push({ start, end })
  }
  shards.reverse() // 旧 → 新

  syncState = { running: true, startedAt: now, finishedAt: 0, shardTotal: shards.length, shardDone: 0,
    fetched: 0, upserted: 0, errors: 0, lastError: '', totalInDb: 0, windowDays }
  for (let s = 0; s < shards.length; s++) {
    const { start, end } = shards[s]
    const batch: FxbaogaoReport[] = []
    syncState.lastError = ''
    try {
      await collectWindow(start, end, (r) => {
        batch.push(r)
        syncState.fetched++
      })
      if (batch.length) {
        const n = await opts.upsert(batch)
        syncState.upserted += n
        syncState.totalInDb += batch.length
      }
    } catch (e: any) {
      syncState.errors++
      syncState.lastError = String(e?.message || e).slice(0, 200)
    }
    syncState.shardDone = s + 1
    if (opts.onStats) opts.onStats({ ...syncState })
    await sleep(SYNC_DELAY_MS)
  }
  syncState.running = false
  syncState.finishedAt = Date.now()
  if (opts.onStats) opts.onStats({ ...syncState })
  return { ...syncState }
}

// 从 PDF Buffer 抽文本
export async function extractPdfText(buf: Buffer, maxChars = 24000): Promise<string> {
  // pdf-parse 是 CommonJS；ESM 里 `import 'pdf-parse'` 拿到的 default 可能在某些版本里
  // 是模块对象本身而不是函数（会触发它去读内置 test PDF 的兜底逻辑）。
  // 用 createRequire 强制走 CJS 拿函数本身。
  const { createRequire } = await import('node:module')
  const requireCJS = createRequire(import.meta.url)
  const pdfParse: any = requireCJS('pdf-parse')
  const result: any = await pdfParse(buf)
  const text: string = String(result?.text || '')
  return text.slice(0, maxChars)
}

// ── 线上 15 分钟管线：增量拉取 + AI 精读 ─────────────────────────
// 说明：fetch+pull 与 db 写入解耦。这里只负责「从 fxbaogao 拉取 + 精读」，
// db 相关的回调由 index.js 注入（保持本文件不 import db.js，避免循环依赖）。

import { refineWithLlm, type LlmExtraction } from './research-report.js'
import { llmConfigInfo, chatJson, isLlmAvailable } from './llm.js'

export interface FxbaogaoRefineItem {
  reportId: number
  title: string
  orgName: string
  pageNum: number
  pubTime: number
  pubTimeStr: string
  pdfUrl?: string   // 数据库缓存的直链，优先复用（避免 get_pdf_url 频控）
}

export interface FxbaogaoRefineResult {
  ok: boolean
  reportId: number
  title: string
  broker: string
  tldr: string
  key_points: string[]
  opportunities: string[]
  risks: string[]
  raw_text: string
  status: string       // refined-llm / refined-mock / pdf_failed
  model: string
  pdf_url: string
  report_type?: string  // stock/industry/macro/strategy/minutes/other
  region?: string       // CN/US/KR/JP/TW/HK/GLOBAL/OTHER
  perspective?: string  // 产业/金融/供应链/技术/订单/认证/''
  extract?: LlmExtraction
  error?: string
}

// 精读单条研报：标记待处理 → 拿 PDF 直链(顺带缓存) → 下载 → 抽文本 → LLM 提炼
export async function refineOneFxbaogao(
  item: FxbaogaoRefineItem,
  hooks: {
    markPending?: (id: number) => Promise<void>
    savePdfUrl?: (id: number, url: string) => Promise<void>
    saveResult: (r: Omit<FxbaogaoRefineResult, 'ok' | 'pdf_url'> & { pdf_url: string }) => Promise<void>
  },
): Promise<FxbaogaoRefineResult> {
  const id = Number(item.reportId)
  const title = String(item.title || `发现报告 #${id}`)
  const broker = String(item.orgName || '外部研报')
  const viewUrl = `https://www.fxbaogao.com/view?id=${id}`
  const base: Omit<FxbaogaoRefineResult, 'ok'> = {
    reportId: id, title, broker, tldr: '', key_points: [], opportunities: [], risks: [],
    raw_text: '', status: 'pdf_failed', model: '', pdf_url: '',
  }
  try {
    if (hooks.markPending) await hooks.markPending(id).catch(() => {})
    // 1) PDF 直链（并缓存到库）
    let pdfUrl = ''
    try { pdfUrl = await getFxbaogaoPdfUrl({ reportId: id }) } catch {}
    if (pdfUrl && hooks.savePdfUrl) hooks.savePdfUrl(id, pdfUrl).catch(() => {})
    // 2) 下载 + 抽文本（优先复用 DB 缓存直链，失效再刷新，减少 get_pdf_url 频控）
    let rawText = ''
    try {
      const buf = await downloadFxbaogaoPdf({ reportId: id }, item.pdfUrl || '')
      rawText = await extractPdfText(buf, 24000)
    } catch (e: any) {
      base.error = 'pdf_failed:' + String(e?.message || e).slice(0, 120)
    }
    // 3) LLM 提炼（无 key / 失败走 mock 兜底）
    let llmResult: { tldr: string; key_points: string[]; opportunities: string[]; risks: string[]; report_type?: string; region?: string; perspective?: string; extraction?: LlmExtraction; mode: 'llm' | 'fallback' } | null = null
    if (rawText.length > 200) {
      try { llmResult = await refineWithLlm({ raw_text: rawText, title, broker }) } catch {}
    }
    const model = llmConfigInfo().model || ''
    const refined = {
      ...base,
      title, broker,
      raw_text: rawText,
      tldr: llmResult?.tldr || '',
      key_points: llmResult?.key_points || [],
      opportunities: llmResult?.opportunities || [],
      risks: llmResult?.risks || [],
      report_type: llmResult?.report_type || '',
      region: llmResult?.region || '',
      perspective: llmResult?.perspective || '',
      extract: llmResult?.extraction || null,
      status: llmResult?.mode === 'llm' ? 'refined-llm' : (rawText.length > 200 ? 'refined-mock' : 'pdf_failed'),
      model: llmResult?.mode === 'llm' ? model : '',
    }
    if (refined.status === 'refined-llm' || refined.status === 'refined-mock') {
      // mock 也落库：目的是保住已抽取的原文，重试时不必再下载 PDF。
      // 但它不算「成功」——db 侧 upsertFxbaogaoAi 只在 refined-llm 时写 ai_status=2，
      // mock 会留在待精读队列里等下一轮重试，并且不计入「成功精读 N 篇」。
      await hooks.saveResult({ ...refined, source_url: viewUrl })
      return { ok: refined.status === 'refined-llm', ...refined, pdf_url: pdfUrl }
    }
    return { ok: false, ...refined, pdf_url: pdfUrl }
  } catch (e: any) {
    return { ok: false, ...base, error: String(e?.message || e).slice(0, 200), pdf_url: '' }
  }
}

// 批量精读：按顺序消费未精读队列（15 分钟任务调用，limit 限流）
export async function refineFxbaogaoBatch(
  items: FxbaogaoRefineItem[],
  hooks: {
    markPending?: (id: number) => Promise<void>
    savePdfUrl?: (id: number, url: string) => Promise<void>
    saveResult: (r: Omit<FxbaogaoRefineResult, 'ok' | 'pdf_url'> & { pdf_url: string }) => Promise<void>
  },
  opts: { concurrency?: number; delayMs?: number } = {},
): Promise<{ ok: number; failed: number; total: number }> {
  const results = []
  for (const item of items) {
    try {
      const r = await refineOneFxbaogao(item, hooks)
      results.push(r)
    } catch (e: any) {
      results.push({ ok: false, reportId: Number(item.reportId), title: item.title, broker: item.orgName, error: String(e?.message || e).slice(0, 200) } as any)
    }
    await sleep(Math.max(0, Number(opts.delayMs) || 200))
  }
  const ok = results.filter((r) => r.ok).length
  return { ok, failed: results.length - ok, total: results.length }
}

// ── LLM 标题判定（每日 21 点选题） ─────────────────────────
// 让 LLM 按标题判断：是否涉及 7 大重点主题、所属地区、类型（行业/宏观）。
// 只有判定相关的研报才消耗下载额度；LLM 不可用时走关键词兜底（地区/类型沿用启发式值）。

const TITLE_KEYWORD_FALLBACK = /半导体|芯片|集成电路|晶圆|封测|存储|NAND|DRAM|HBM|光刻|EDA|先进制程|稀土|锂矿|钴|镍|铜|铀|稀有金属|关键矿产|航空|航天|卫星|火箭|无人机|大飞机|航空发动机|AI|人工智能|大模型|算力|数据中心|GPU|具身|机器人|人形|智能驾驶|自动驾驶|新能源|光伏|储能|风电|锂电|电池|氢能|充电桩|电力|电网|特高压|核电|电源|先进制造|智能制造|工业母机|机床|激光|3D打印|军工|高端装备|工程机械/i

export interface FxbaogaoTitleJudgment {
  reportId: number
  relevant: boolean
  region: string   // CN/US/KR/JP/TW/HK/GLOBAL/OTHER
  category: string // industry | macro
}

export async function judgeFxbaogaoTitlesByLlm(
  items: Array<{ reportId: number; title: string; dbRegion: string; dbType: string }>,
): Promise<FxbaogaoTitleJudgment[]> {
  const fallback = (it: { reportId: number; title: string; dbRegion: string; dbType: string }): FxbaogaoTitleJudgment => ({
    reportId: it.reportId,
    relevant: TITLE_KEYWORD_FALLBACK.test(String(it.title || '')),
    region: it.dbRegion || 'OTHER',
    category: it.dbType === 'macro' ? 'macro' : 'industry',
  })
  if (!isLlmAvailable()) return items.map(fallback)
  const results: FxbaogaoTitleJudgment[] = []
  const CHUNK = 50
  for (let s = 0; s < items.length; s += CHUNK) {
    const chunk = items.slice(s, s + CHUNK)
    const ids = chunk.map((it, j) => ({ i: j, id: it.reportId, title: String(it.title || '').slice(0, 80) }))
    const judged = await chatJson<any>({
      system: [
        '你是券商研报选题筛选器。对每篇研报标题做三项判定：',
        '1) relevant：是否涉及以下 8 大主题之一：半导体全产业链技术（芯片/存储/晶圆/设备材料等）、关键矿产（稀土/锂钴镍铜等）、航空航天（航空/航天/卫星）、AI 人工智能、具身智能机器人、新能源（光伏/储能/风电/锂电/氢能）、电力设施（电网/特高压/核电/电源设备）、先进制造（高端装备/工业母机/智能制造）。只有标题明确相关才 true，只提公司名或泛泛宏观的为 false。',
        '2) region：研报覆盖地区，取值 CN/US/KR/JP/TW/HK/GLOBAL/OTHER，标题无地区信息则 OTHER。',
        '3) category：行业研究填 industry，宏观/策略填 macro。',
        '输出 JSON：{"results":[{"i":0,"relevant":true,"region":"CN","category":"industry"}]}，i 为输入条目序号，全部条目都要输出，不要省略。',
      ].join('\n'),
      user: JSON.stringify(ids),
      jsonHint: true,
      maxTokens: 4000,
      temperature: 0.1,
    })
    const arr: any[] = Array.isArray(judged?.results) ? judged.results : []
    for (let j = 0; j < chunk.length; j++) {
      const it = chunk[j]
      const r = arr.find((x) => Number(x?.i) === j)
      if (r && typeof r.relevant === 'boolean') {
        results.push({
          reportId: it.reportId,
          relevant: !!r.relevant,
          region: String(r.region || it.dbRegion || 'OTHER').toUpperCase(),
          category: String(r.category || '') === 'macro' ? 'macro' : 'industry',
        })
      } else {
        results.push(fallback(it))
      }
    }
  }
  return results
}
