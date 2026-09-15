// api/market.ts — 行情数据（历史K线/北向/龙虎榜/F10），后端经 provider 抽象层取数
//
// 2026-09-15 重构：原先这里用裸 fetch —— 微信小程序端没有 fetch，这些接口在微信端直接不可用。
// 现统一走 utils/request.ts（uni.request，三端通用），并接入 useCache 做 TTL 缓存 + 单飞去重。
import { getJson } from '@/utils/request'
import { cached } from '@/utils/useCache'
import { CACHE_KEYS, CACHE_TTL_MS } from '@/utils/cacheConfig'

export interface KLine {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount?: number
}

export interface NorthFlow {
  交易日: string
  类型: string
  板块: string
  资金方向: string
  交易状态: number
  成交净买额: number
  资金净流入: number
  当日资金余额: number
  上涨数: number
  持平数: number
  下跌数: number
  相关指数: string
  指数涨幅: number
}

export interface LhbItem {
  序号: number
  代码: string
  名称: string
  上榜日: string
  解读: string
  收盘价: number
  涨跌幅: number
  龙虎榜净买额: number
  龙虎榜买入额: number
  龙虎榜卖出额: number
  龙虎榜成交额: number
  市场总成交额: number
  净买额占比: number
  成交额占比: number
  换手率: number
  流通市值: number
  上榜原因: string
}

export interface MarketResp<T> {
  ok: boolean
  code?: string
  count?: number
  source?: string
  cached?: boolean
  items?: T[]
  error?: string
}

export async function fetchHist(code: string, opts?: { limit?: number; start?: string; end?: string; adjust?: string }): Promise<MarketResp<KLine>> {
  const limit = opts?.limit ?? 0
  const adjust = opts?.adjust || ''
  const query: Record<string, any> = { code }
  if (opts?.limit) query.limit = String(opts.limit)
  if (opts?.start) query.start = opts.start
  if (opts?.end) query.end = opts.end || '20500101'
  if (opts?.adjust) query.adjust = opts.adjust

  const key = `${CACHE_KEYS.hist(code, limit, adjust)}:${opts?.start || ''}:${opts?.end || ''}`
  return cached(key, CACHE_TTL_MS.market, () => getJson<MarketResp<KLine>>('/api/market/hist', query))
}

export async function fetchNorth(limit = 60): Promise<MarketResp<NorthFlow>> {
  return cached(CACHE_KEYS.north(limit), CACHE_TTL_MS.market, () =>
    getJson<MarketResp<NorthFlow>>('/api/market/north', { limit }),
  )
}

export async function fetchLhb(date: string, limit = 50): Promise<MarketResp<LhbItem>> {
  return cached(CACHE_KEYS.lhb(date, limit), CACHE_TTL_MS.market, () =>
    getJson<MarketResp<LhbItem>>('/api/market/lhb', { date, limit }),
  )
}

export async function fetchF10(code: string, kind = 'indicator', limit = 40): Promise<MarketResp<Record<string, any>>> {
  return cached(CACHE_KEYS.f10(code, kind, limit), CACHE_TTL_MS.market, () =>
    getJson<MarketResp<Record<string, any>>>('/api/market/f10', { code, kind, limit }),
  )
}
