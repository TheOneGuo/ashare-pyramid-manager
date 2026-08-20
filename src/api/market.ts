// api/market.ts — 行情数据（历史K线/北向/龙虎榜/F10），后端经 provider 抽象层取数
import { env } from '@/utils/env'

const API_BASE = env.API_BASE_URL && env.API_BASE_URL.length > 0 ? env.API_BASE_URL : ''

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

function build(path: string): string {
  if (API_BASE) return API_BASE.replace(/\/$/, '') + path
  return path
}

export async function fetchHist(code: string, opts?: { limit?: number; start?: string; end?: string; adjust?: string }): Promise<MarketResp<KLine>> {
  const p = new URLSearchParams({ code })
  if (opts?.limit) p.set('limit', String(opts.limit))
  if (opts?.start) p.set('start', opts.start)
  if (opts?.end) p.set('end', opts.end || '20500101')
  if (opts?.adjust) p.set('adjust', opts.adjust)
  const resp = await fetch(build('/api/market/hist?' + p.toString()))
  return resp.json()
}

export async function fetchNorth(limit = 60): Promise<MarketResp<NorthFlow>> {
  const resp = await fetch(build('/api/market/north?limit=' + limit))
  return resp.json()
}

export async function fetchLhb(date: string, limit = 50): Promise<MarketResp<LhbItem>> {
  const resp = await fetch(build('/api/market/lhb?date=' + date + '&limit=' + limit))
  return resp.json()
}

export async function fetchF10(code: string, kind = 'indicator', limit = 40): Promise<MarketResp<Record<string, any>>> {
  const p = new URLSearchParams({ code, kind })
  if (limit) p.set('limit', String(limit))
  const resp = await fetch(build('/api/market/f10?' + p.toString()))
  return resp.json()
}
