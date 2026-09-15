// utils/cacheConfig.ts — 缓存键与 TTL 的单一来源
//
// 单独成文件是为了避免循环依赖：api/*.ts 与 utils/prefetch.ts 都要引用同一批 key，
// 若把 key 定义在 prefetch.ts 里，就会形成 api → prefetch → api 的环。
//
// TTL 取值原则：
//   - 盘中会变、但秒级变化无意义的（资金流）→ 60s
//   - 用户自己会改、需要较快感知的（持仓）→ 30s，且写操作后必须 invalidate
//   - 基本静态的配置类（角色字典）→ 10min
//   - 随参数变化的历史数据（K线/F10）→ 120s，key 里带参数

export const CACHE_KEYS = {
  fundflow: 'fundflow',
  holdings: 'holdings',
  roles: 'portfolio:roles',
  fxbaogaoStatus: 'fxbaogao:status',
  researchGroups: 'research:groups',
  hist: (code: string, limit: number, adjust: string) => `market:hist:${code}:${limit}:${adjust}`,
  f10: (code: string, kind: string, limit: number) => `market:f10:${code}:${kind}:${limit}`,
  north: (limit: number) => `market:north:${limit}`,
  lhb: (date: string, limit: number) => `market:lhb:${date}:${limit}`,
} as const

export const CACHE_TTL_MS = {
  fundflow: 60_000,
  holdings: 30_000,
  roles: 600_000,
  fxbaogaoStatus: 300_000,
  researchGroups: 300_000,
  market: 120_000,
} as const
