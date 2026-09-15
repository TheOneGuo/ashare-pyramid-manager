// api/fundflow.ts — 资金流向（资金动态）数据封装，风格仿 market.ts
// v2：真实数据（腾讯行业板块主力净流入 + 东财北向日度成交），口径说明随响应下发
// 2026-09-15 重构：裸 fetch → 统一 request 层（小程序端可用）+ useCache 缓存。
import { getJson } from '@/utils/request'
import { cached } from '@/utils/useCache'
import { CACHE_KEYS, CACHE_TTL_MS } from '@/utils/cacheConfig'

export type FundType = 'joint' | 'public_fund' | 'stabilization' | 'foreign'

export interface FundNode {
  type: FundType
  name: string
  emoji: string
  colorKey: 'joint' | 'public' | 'stab' | 'foreign'
  totalPct: number // 该口径全行业净流入合计（亿）
}
export interface SectorNode {
  code: string
  name: string
  pct: number // 净流入（亿，带符号）
  pct5d: number
  rank: number
}
export interface StockItem {
  code: string
  name: string
  sector: string
  pct: number // 领涨股涨跌幅 %；持仓股为 0（看 meta）
  rank: number
  meta?: string // 持股说明（报告期 · 增仓/新进/持股家数）
}
export interface SankeyEdge {
  fund: FundType
  sectorCode: string
  pct: number
}
export interface MetricInfo {
  label: string
  unit: string
  notice?: string
}
export interface NorthDay {
  date: string
  dealAmtYi: number
  dealNum: number
  lead: string
  leadZdf: number
}
export interface NorthData {
  asOf: string
  latest: NorthDay | null
  series: NorthDay[]
}
export interface FundFlowResp {
  ok: boolean
  source: string
  asOf: string
  funds: FundNode[]
  metric: Record<FundType, MetricInfo>
  north?: NorthData
  sankey: { left: FundNode[]; right: SectorNode[]; edges: SankeyEdge[] }
  sectors: Record<FundType, SectorNode[]>
  stocks: Record<FundType, StockItem[]>
  error?: string
}

// 单一全量拉取：一次拿 4 类资金口径的 sankey + 板块/个股榜，子 tab 切换零请求（纯前端高亮）
// 该接口返回体较大且盘中变化不频繁，缓存 60s；下拉刷新传 force 强制穿透。
export async function fetchFundFlow(opts?: { force?: boolean }): Promise<FundFlowResp> {
  return cached(CACHE_KEYS.fundflow, CACHE_TTL_MS.fundflow, () => getJson<FundFlowResp>('/api/fundflow'), {
    force: !!opts?.force,
  })
}
