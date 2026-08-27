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
  const pageNum = Math.min(Math.max(args.pageNum || 1, 1), 10)
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
