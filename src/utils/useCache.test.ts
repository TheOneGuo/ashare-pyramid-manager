// useCache.test.ts — 内存缓存单元测试（含对抗性用例）
//
// 覆盖目标：TTL 过期、单飞去重（并发只发一次）、force 穿透、
// 失败不写缓存、前缀失效、容量上限淘汰、预取去重。

import { cached, peekCache, invalidate, prefetch, cacheSize } from '@/utils/useCache'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

beforeEach(() => {
  invalidate()
})

describe('cached 基本行为', () => {
  it('首次未命中则调用 fetcher', async () => {
    const fn = jest.fn().mockResolvedValue({ v: 1 })
    await expect(cached('k1', 1000, fn)).resolves.toEqual({ v: 1 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('TTL 内二次调用不重复拉取', async () => {
    const fn = jest.fn().mockResolvedValue(42)
    await cached('k', 5000, fn)
    await cached('k', 5000, fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('TTL 过期后重新拉取', async () => {
    const fn = jest.fn().mockResolvedValue(1)
    await cached('k', 30, fn)
    await sleep(50)
    await cached('k', 30, fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('force 穿透缓存强制刷新（下拉刷新场景）', async () => {
    const fn = jest.fn().mockResolvedValue(1)
    await cached('k', 60000, fn)
    await cached('k', 60000, fn, { force: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('不同 key 互不干扰', async () => {
    await cached('a', 1000, async () => 'A')
    await cached('b', 1000, async () => 'B')
    expect(peekCache('a')).toBe('A')
    expect(peekCache('b')).toBe('B')
  })
})

describe('单飞（single-flight）', () => {
  it('并发同 key 只发一次请求，且结果一致', async () => {
    let resolveFn: (v: any) => void
    const fn = jest.fn().mockImplementation(
      () => new Promise((r) => { resolveFn = r }),
    )
    const p1 = cached('sf', 10000, fn)
    const p2 = cached('sf', 10000, fn)
    const p3 = cached('sf', 10000, fn)
    expect(fn).toHaveBeenCalledTimes(1)
    ;(resolveFn! as any)('done')
    await expect(Promise.all([p1, p2, p3])).resolves.toEqual(['done', 'done', 'done'])
  })
})

describe('失败处理', () => {
  it('请求失败不写缓存，下次可重试', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok')
    await expect(cached('k', 10000, fn)).rejects.toThrow('boom')
    // 失败后 inflight 必须清掉，否则永远卡在失败的 Promise 上
    await expect(cached('k', 10000, fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('失败后并发请求不会全部永远 pending', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'))
    await expect(cached('k2', 10000, fn)).rejects.toThrow('boom')
    await expect(cached('k2', 10000, fn)).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('peekCache / invalidate', () => {
  it('peekCache 命中未过期值', async () => {
    await cached('k', 5000, async () => 'v')
    expect(peekCache('k')).toBe('v')
  })

  it('peekCache 对过期值返回 undefined', async () => {
    await cached('k', 20, async () => 'v')
    await sleep(40)
    expect(peekCache('k')).toBeUndefined()
  })

  it('invalidate(前缀) 批量清理', async () => {
    await cached('/api/holdings', 60000, async () => 1)
    await cached('/api/holdings?x=1', 60000, async () => 2)
    await cached('/api/news', 60000, async () => 3)
    invalidate('/api/holdings')
    expect(peekCache('/api/holdings')).toBeUndefined()
    expect(peekCache('/api/holdings?x=1')).toBeUndefined()
    expect(peekCache('/api/news')).toBe(3)
  })

  it('invalidate() 不传参则清空全部', async () => {
    await cached('a', 60000, async () => 1)
    invalidate()
    expect(cacheSize()).toBe(0)
  })
})

describe('容量上限', () => {
  it('超过 200 条按插入顺序淘汰最旧的，避免内存无界增长', async () => {
    for (let i = 0; i < 260; i++) {
      await cached(`bulk:${i}`, 60000, async () => i)
    }
    expect(cacheSize()).toBeLessThanOrEqual(200)
    // 最旧的若干条应已被淘汰
    expect(peekCache('bulk:0')).toBeUndefined()
    // 最新的仍在
    expect(peekCache('bulk:259')).toBe(259)
  })
})

describe('prefetch', () => {
  it('预取写入缓存且失败静默', async () => {
    prefetch('pf', 5000, async () => 'v')
    // 预取是异步的，等一拍
    await sleep(10)
    expect(peekCache('pf')).toBe('v')
  })

  it('已有有效缓存时不重复预取', async () => {
    await cached('pf2', 60000, async () => 'orig')
    const fn = jest.fn().mockResolvedValue('new')
    prefetch('pf2', 60000, fn)
    await sleep(10)
    expect(fn).not.toHaveBeenCalled()
  })

  it('预取失败不抛出（不阻塞调用方）', async () => {
    expect(() => prefetch('pf3', 5000, async () => { throw new Error('x') })).not.toThrow()
    await sleep(10)
    expect(peekCache('pf3')).toBeUndefined()
  })
})
