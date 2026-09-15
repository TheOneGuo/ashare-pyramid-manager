// utils/useCache.ts — 前端内存缓存（TTL + 单飞去重 + 容量上限 + 预取）
//
// 背景（2026-09-15 审计 Q5）：后端读 Turso 偶发变慢（单次数秒），
// 而 Tab 来回切换、页面 onShow 都会重新拉同一批只读接口，造成重复等待与无谓的后端压力。
//
// 设计要点：
//   - 单飞（single-flight）：同一 key 并发请求只发一次，其余复用同一个 Promise；
//   - TTL：过期后重新拉取，避免「切回页面永远是旧数据」；
//   - 容量上限：Map 无界增长会内存泄漏，超过上限按插入顺序淘汰最旧的；
//   - 只缓存「读」：写操作（POST/DELETE）后必须显式 invalidate，否则会读到脏数据。
//
// ⚠️ 使用约束：
//   1) 只用于只读 GET；任何写操作后要调用 invalidate() 清掉相关 key。
//   2) 缓存是进程内内存，App 重启即失效，不替代后端缓存。

import { ref, type Ref } from 'vue'

interface Entry {
  value: any
  /** 过期时间戳（ms） */
  expire: number
  /** 正在飞行中的请求，用于单飞去重 */
  inflight?: Promise<any>
  /** 插入序号，用于容量淘汰 */
  seq: number
}

const store = new Map<string, Entry>()
let seqCounter = 0

/** 缓存条目上限，超出后淘汰最旧的（防止长时间运行内存无界增长） */
const MAX_ENTRIES = 200

function evictIfNeeded() {
  if (store.size <= MAX_ENTRIES) return
  const overflow = store.size - MAX_ENTRIES
  const keys = [...store.entries()].sort((a, b) => a[1].seq - b[1].seq).map(([k]) => k)
  for (let i = 0; i < overflow && i < keys.length; i++) store.delete(keys[i])
}

function isFresh(e: Entry | undefined, now: number): boolean {
  return !!e && e.expire > now
}

/**
 * 取缓存；无有效缓存则调用 fetcher，并对同一 key 做单飞去重。
 * @param key   缓存键（建议含参数，如 `fundflow`、`hist:600519:120`）
 * @param ttlMs 有效期（ms）
 * @param fetcher 取数函数（只在缓存未命中时调用）
 * @param opts.force  true 时忽略现有缓存强制刷新（下拉刷新场景）
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts: { force?: boolean } = {},
): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)

  if (!opts.force && isFresh(hit, now)) return hit!.value as T
  // 已有同名请求在飞：直接复用，不发第二次
  if (!opts.force && hit?.inflight) return hit.inflight as Promise<T>

  const p = (async () => {
    try {
      const value = await fetcher()
      store.set(key, { value, expire: Date.now() + ttlMs, seq: ++seqCounter })
      return value
    } catch (e) {
      // 失败不写缓存，且把 inflight 清掉，保证下次能重试
      const cur = store.get(key)
      if (cur) delete cur.inflight
      throw e
    } finally {
      const cur = store.get(key)
      if (cur) delete cur.inflight
      evictIfNeeded()
    }
  })()

  // 记录 inflight（保留旧值以便失败时仍有一段可展示的数据）
  store.set(key, {
    value: hit?.value,
    expire: hit?.expire ?? 0,
    inflight: p,
    seq: hit?.seq ?? ++seqCounter,
  })
  return p
}

/** 同步读取缓存（不触发请求），用于「先用旧值渲染」 */
export function peekCache<T>(key: string): T | undefined {
  const e = store.get(key)
  return isFresh(e, Date.now()) ? (e!.value as T) : undefined
}

/** 失效：传前缀则批量清理（如 invalidate('/api/holdings')），不传则清空全部 */
export function invalidate(prefix?: string) {
  if (!prefix) {
    store.clear()
    return
  }
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) store.delete(k)
  }
}

/** 预取：后台静默灌缓存，失败静默忽略（预取不是关键路径） */
export function prefetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): void {
  if (isFresh(store.get(key), Date.now())) return
  cached<T>(key, ttlMs, fetcher).catch(() => {})
}

/** 调试用：当前缓存大小 */
export function cacheSize(): number {
  return store.size
}

export interface UseCacheReturn<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string>
  /** 强制刷新（忽略缓存） */
  refresh: () => Promise<void>
  /** 非强制加载（命中缓存直接用） */
  load: () => Promise<void>
}

/**
 * 组合式封装：页面里直接用 data/loading/error，无需自己管缓存与竞态。
 * 首次调用会尝试用已有缓存同步填充 data，避免短暂空白。
 */
export function useCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts: { immediate?: boolean; force?: boolean } = {},
): UseCacheReturn<T> {
  const data = ref<T | null>(peekCache<T>(key) ?? null) as Ref<T | null>
  const loading = ref(false)
  const error = ref('')

  async function run(force: boolean) {
    loading.value = true
    error.value = ''
    try {
      data.value = await cached<T>(key, ttlMs, fetcher, { force })
    } catch (e: any) {
      error.value = e?.message || '加载失败'
    } finally {
      loading.value = false
    }
  }

  if (opts.immediate !== false) run(!!opts.force)

  return {
    data,
    loading,
    error,
    refresh: () => run(true),
    load: () => run(false),
  }
}
