// server/src/fxbaogao.ts · 发现报告 (fxbaogao.com) MCP 客户端
//
// 在线 HTTP 版：POST https://api.fxbaogao.com/mcp/  with JSON-RPC 2.0
// 仅暴露 3 个核心 tool：search_reports / get_paragraphs / get_pdf_url
// 缓存：search 结果按 query+page+timeRange 缓存 60s（防重复点击）
//
// 凭证：FXBAOGAO_API_KEY 走 .env，绝不在日志/响应里出现完整 key

import { env } from 'node:process'

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
  // result.content[0].text 是 JSON 字符串
  const txt: string = data?.result?.content?.[0]?.text
  if (!txt) {
    if (data?.result?.isError) {
      throw new Error(`fxbaogao tool error: ${txt || 'unknown'}`)
    }
    return [] as unknown as T
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

export async function getFxbaogaoPdfUrl(args: { reportId: number }): Promise<string> {
  const cacheKey = `u:${args.reportId}`
  const cached = getCached<string>(cacheKey)
  if (cached) return cached
  const data = await rpcCall<string>('get_pdf_url', { reportId: args.reportId })
  // data 可能是字符串 URL 或对象
  let url = ''
  if (typeof data === 'string') {
    // 抓 URL
    const m = data.match(/https?:\/\/[^\s'"<>]+\.pdf\?[^\s'"<>]+/i)
    url = m ? m[0] : data.replace(/^["']|["']$/g, '')
  } else if (data && typeof data === 'object') {
    url = String(data.url || data.pdfUrl || data.downloadUrl || '')
  }
  setCached(cacheKey, url)
  return url
}

// 下载 PDF 到 buffer（供后端解析文本用）
export async function downloadFxbaogaoPdf(args: { reportId: number }): Promise<Buffer> {
  const url = await getFxbaogaoPdfUrl(args)
  if (!url) throw new Error('fxbaogao: empty pdf url')
  const r = await fetch(url, { headers: { 'User-Agent': 'ashare-pyramid-manager/1.0' } })
  if (!r.ok) throw new Error(`fxbaogao PDF download failed: HTTP ${r.status}`)
  const ab = await r.arrayBuffer()
  return Buffer.from(ab)
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

import { refineWithLlm } from './research-report.js'
import { llmConfigInfo } from './llm.js'

export interface FxbaogaoRefineItem {
  reportId: number
  title: string
  orgName: string
  pageNum: number
  pubTime: number
  pubTimeStr: string
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
    // 2) 下载 + 抽文本
    let rawText = ''
    try {
      const buf = await downloadFxbaogaoPdf({ reportId: id })
      rawText = await extractPdfText(buf, 24000)
    } catch (e: any) {
      base.error = 'pdf_failed:' + String(e?.message || e).slice(0, 120)
    }
    // 3) LLM 提炼（无 key / 失败走 mock 兜底）
    let llmResult: { tldr: string; key_points: string[]; opportunities: string[]; risks: string[]; mode: 'llm' | 'fallback' } | null = null
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
      status: llmResult?.mode === 'llm' ? 'refined-llm' : (rawText.length > 200 ? 'refined-mock' : 'pdf_failed'),
      model: llmResult?.mode === 'llm' ? model : '',
    }
    if (refined.status === 'refined-llm' || refined.status === 'refined-mock') {
      await hooks.saveResult({ ...refined, source_url: viewUrl })
      return { ok: true, ...refined, pdf_url: pdfUrl }
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
