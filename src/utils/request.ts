// utils/request.ts — 全端统一网络请求层
//
// 背景（2026-09-15 审计 Q5）：此前项目里三套请求写法并存且各有缺陷——
//   1) src/api/market.ts、fundflow.ts 用裸 fetch：小程序端没有 fetch，这两个页面在微信端直接不可用；
//   2) src/api/portfolio.ts 有自己的 jget()：只处理 JSON 解析，超时硬编码 10s、无重试、不校验 HTTP 状态码；
//   3) pages/news/index.vue 直接 uni.request：超时各写各的（12s/20s），错误信息靠调用方各自兜。
// 结果是「同一个后端抖动，在不同页面表现完全不同」，且新增接口时容易漏掉超时/错误处理。
//
// 本模块把 URL 拼接、超时、重试、HTTP 状态校验、错误归一化收敛到一处。
// 统一走 uni.request（H5 / 小程序 / App 三端都可用），不再使用裸 fetch。
//
// 注意：二进制下载（如截图转 base64）不走这里，仍用原生能力，见 pages/portfolio。

import { env } from '@/utils/env'

const API_BASE =
  env.API_BASE_URL && env.API_BASE_URL.length > 0 ? env.API_BASE_URL.replace(/\/+$/, '') : ''

/** 默认超时。后端读 Turso 偶发变慢，8s 会在数据返回前先超时，故放宽到 15s。 */
export const DEFAULT_TIMEOUT_MS = 15000

/** 归一化后的请求错误：调用方只需看 message / status，不必分辨 errMsg 还是 message。 */
export class ApiError extends Error {
  name = 'ApiError'
  /** HTTP 状态码；网络层失败（超时/断网）为 0 */
  status: number
  url: string
  /** 原始响应体（若可解析），便于上层取 error 字段做提示 */
  payload: any

  constructor(message: string, opts: { status?: number; url?: string; payload?: any } = {}) {
    super(message)
    this.status = opts.status ?? 0
    this.url = opts.url ?? ''
    this.payload = opts.payload
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** query 参数，值会拼接进 URL；undefined/null 自动跳过 */
  query?: Record<string, string | number | boolean | undefined | null>
  /** 请求体（对象会被 JSON 序列化） */
  body?: any
  /** 超时毫秒数，默认 DEFAULT_TIMEOUT_MS */
  timeout?: number
  headers?: Record<string, string>
  /**
   * 失败重试次数。默认：GET 为 1（幂等，可安全重试），其余方法为 0（避免重复提交）。
   * 只有「网络层失败 / 超时 / 5xx」才重试，4xx 不重试（重试也不会变对）。
   */
  retry?: number
  retryDelayMs?: number
  /** 失败时是否抛出 ApiError。false 时返回 null，交由调用方降级（默认 true）。 */
  throwOnError?: boolean
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 拼接完整 URL：有 API_BASE 就前缀，否则走相对路径（H5 dev 由 vite proxy 转发）。 */
export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = API_BASE || ''
  let url = base + (path.startsWith('/') ? path : '/' + path)
  if (query) {
    const p = new URLSearchParams()
    Object.keys(query).forEach((k) => {
      const v = query[k]
      if (v === undefined || v === null || v === '') return
      p.set(k, String(v))
    })
    const qs = p.toString()
    if (qs) url += (url.includes('?') ? '&' : '?') + qs
  }
  return url
}

function parseBody(raw: any): any {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    throw new ApiError('响应不是合法 JSON')
  }
}

/** 是否值得重试：网络层失败、超时、或服务端 5xx。4xx 重试无意义。 */
function isRetriable(status: number): boolean {
  return status === 0 || status >= 500
}

function doRequest<T>(path: string, opts: RequestOptions): Promise<T> {
  const url = buildUrl(path, opts.query)
  const method = opts.method || 'GET'
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS

  return new Promise<T>((resolve, reject) => {
    // 兜底：非 uni 环境（jest / node 脚本）直接报错，避免静默 undefined
    const uniAny: any = (globalThis as any).uni
    if (!uniAny || typeof uniAny.request !== 'function') {
      reject(new ApiError('当前环境不支持 uni.request', { url }))
      return
    }
    uniAny.request({
      url,
      method: method as any,
      data: opts.body,
      timeout,
      header: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      success: (res: any) => {
        const status = Number(res?.statusCode || 0)
        let payload: any = undefined
        try {
          payload = parseBody(res?.data)
        } catch (e: any) {
          if (status >= 400) {
            reject(new ApiError(`HTTP ${status}`, { status, url }))
          } else {
            reject(new ApiError(e?.message || '响应解析失败', { status, url }))
          }
          return
        }
        if (status >= 400) {
          // 优先透传服务端给的 error/message，避免页面只显示一个干巴巴的 "HTTP 500"
          const msg = payload?.error || payload?.message || `HTTP ${status}`
          reject(new ApiError(String(msg), { status, url, payload }))
          return
        }
        resolve(payload as T)
      },
      fail: (err: any) => {
        reject(new ApiError(err?.errMsg || err?.message || '网络请求失败', { url }))
      },
    })
  })
}

/**
 * 统一请求入口。
 * @throws ApiError（除非 throwOnError: false，此时返回 null）
 */
export async function request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method || 'GET'
  const retry = opts.retry ?? (method === 'GET' ? 1 : 0)
  const retryDelayMs = opts.retryDelayMs ?? 600
  const throwOnError = opts.throwOnError !== false

  let lastErr: any
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      return await doRequest<T>(path, opts)
    } catch (e: any) {
      lastErr = e
      const status = e?.status ?? 0
      if (attempt < retry && isRetriable(status)) {
        await sleep(retryDelayMs * (attempt + 1))
        continue
      }
      break
    }
  }
  if (throwOnError) throw lastErr
  return null as any
}

/** 语义糖：GET 取 JSON */
export function getJson<T = any>(path: string, query?: RequestOptions['query'], opts: RequestOptions = {}): Promise<T> {
  return request<T>(path, { ...opts, method: 'GET', query })
}

/** 语义糖：POST/PUT/DELETE 提交 JSON */
export function sendJson<T = any>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: any, opts: RequestOptions = {}): Promise<T> {
  return request<T>(path, { ...opts, method, body })
}
