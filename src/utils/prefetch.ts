// utils/prefetch.ts — 启动预热（把首屏之后才会用到的数据提前灌进缓存）
//
// 背景（2026-09-15 审计 Q5）：三个 Tab 的数据此前都是「切到才拉」，
// 而后端单次读 Turso 偶发要到几秒，用户切 Tab 时明显感到卡顿。
//
// 做法：App 启动后静默并发预热几个只读接口，把结果写进 useCache。
// 之后用户真正切过去时直接命中缓存，感知上就是秒开。
// 预取失败一律静默忽略——预取不是关键路径，失败不应影响启动。

import { prefetch } from '@/utils/useCache'
import { CACHE_KEYS, CACHE_TTL_MS } from '@/utils/cacheConfig'
import { fetchFundFlow } from '@/api/fundflow'
import { listHoldings, listRoles } from '@/api/portfolio'

/**
 * 启动预热。故意不 await：不阻塞 App 启动。
 * 只预热「体积小、只读、大概率会被看到」的接口；
 * 新闻流（/api/news）体积大且要求新鲜，不预取，否则会污染用户看到的第一屏时序。
 */
export function prefetchAll(): void {
  try {
    prefetch(CACHE_KEYS.holdings, CACHE_TTL_MS.holdings, () => listHoldings())
    prefetch(CACHE_KEYS.fundflow, CACHE_TTL_MS.fundflow, () => fetchFundFlow())
    prefetch(CACHE_KEYS.roles, CACHE_TTL_MS.roles, () => listRoles())
  } catch {
    // 静态兜底：预取异常绝不能影响 App 启动
  }
}
