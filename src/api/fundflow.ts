// api/fundflow.ts — 资金流向（资金动态）数据封装，风格仿 market.ts
import { env } from '@/utils/env'

const API_BASE = env.API_BASE_URL && env.API_BASE_URL.length > 0 ? env.API_BASE_URL : ''

export type FundType = 'joint' | 'public_fund' | 'stabilization' | 'foreign'

export interface FundNode {
  type: FundType
  name: string
  emoji: string
  colorKey: 'joint' | 'public' | 'stab' | 'foreign'
  totalPct: number
}
export interface SectorNode {
  code: string
  name: string
  pct: number
  pct5d: number
  rank: number
}
export interface StockItem {
  code: string
  name: string
  sector: string
  pct: number
  rank: number
}
export interface SankeyEdge {
  fund: FundType
  sectorCode: string
  pct: number
}
export interface FundFlowResp {
  ok: boolean
  source: 'mock' | 'eastmoney' | 'partner'
  asOf: string
  funds: FundNode[]
  sankey: { left: FundNode[]; right: SectorNode[]; edges: SankeyEdge[] }
  sectors: Record<FundType, SectorNode[]>
  stocks: Record<FundType, StockItem[]>
  error?: string
}

function build(path: string): string {
  if (API_BASE) return API_BASE.replace(/\/$/, '') + path
  return path
}

// 单一全量拉取：一次拿 4 类资金的 sankey + 板块/个股榜，子 tab 切换零请求（纯前端高亮）
export async function fetchFundFlow(): Promise<FundFlowResp> {
  const resp = await fetch(build('/api/fundflow'))
  return resp.json()
}
