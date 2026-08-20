/**
 * 简单内存 TTL 缓存（热点行情数据降频打微服务）
 *
 * - 按完整 query string 做 key（code + 参数不同即不同缓存）
 * - 不同接口不同 TTL：K线/北向/龙虎榜 60s，F10 财务 60s（用户指定）
 * - 进程内单例；重启即清空。不落盘（开发期足够）。
 */
type Entry = { value: any; expireAt: number };

const store = new Map<string, Entry>();

// 单位：毫秒
const TTL: Record<string, number> = {
  hist: 60_000,
  north: 60_000,
  lhb: 60_000,
  f10: 60_000,
};

function keyOf(kind: string, req: any): string {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  return `${kind}${qs}`;
}

export function getCached(kind: string, req: any): any | undefined {
  const ttl = TTL[kind] ?? 60_000;
  const k = keyOf(kind, req);
  const e = store.get(k);
  if (!e) return undefined;
  if (Date.now() > e.expireAt) {
    store.delete(k);
    return undefined;
  }
  return e.value;
}

export function setCached(kind: string, req: any, value: any): void {
  const ttl = TTL[kind] ?? 60_000;
  store.set(keyOf(kind, req), { value, expireAt: Date.now() + ttl });
}

export function cacheTTL(kind: string): number {
  return TTL[kind] ?? 60_000;
}
