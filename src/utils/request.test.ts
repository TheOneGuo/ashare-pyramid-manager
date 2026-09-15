// request.test.ts — 统一请求层单元测试（含对抗性用例）
//
// 覆盖目标：URL 拼接、JSON 解析、HTTP 状态归一化、重试策略（5xx 重试 / 4xx 不重试）、
// 写操作默认不重试、throwOnError 降级、非 uni 环境兜底。
//
// 注意：env.ts 里用了 import.meta.env（H5 编译期注入），在 ts-jest(commonjs) 下无法加载，
// 故用 jest.mock 工厂替换，真实模块不会被 require。

jest.mock('@/utils/env', () => ({ env: { API_BASE_URL: '' } }))

import { request, getJson, sendJson, buildUrl, ApiError } from '@/utils/request'

/** 安装一个可控的 uni.request 桩，返回每次调用的选项，便于断言 */
function mockUni(handler: (opts: any) => void) {
  const calls: any[] = []
  ;(globalThis as any).uni = {
    request(opts: any) {
      calls.push(opts)
      handler(opts)
    },
  }
  return calls
}

function clearUni() {
  delete (globalThis as any).uni
}

afterEach(() => {
  clearUni()
  jest.restoreAllMocks()
})

describe('buildUrl', () => {
  it('相对路径：无 API_BASE 时原样返回', () => {
    expect(buildUrl('/api/news')).toBe('/api/news')
  })

  it('补齐缺失的斜杠', () => {
    expect(buildUrl('api/news')).toBe('/api/news')
  })

  it('拼接 query 并跳过空值', () => {
    const url = buildUrl('/api/news', { limit: 100, holding: undefined, scope: '', kw: null as any })
    expect(url).toBe('/api/news?limit=100')
  })

  it('已带 ? 的 URL 用 & 追加', () => {
    expect(buildUrl('/api/x?a=1', { b: 2 })).toBe('/api/x?a=1&b=2')
  })
})

describe('request 成功路径', () => {
  it('解析对象响应体', async () => {
    mockUni((o) => o.success({ statusCode: 200, data: { ok: true, items: [1, 2] } }))
    const r = await getJson('/api/news')
    expect(r).toEqual({ ok: true, items: [1, 2] })
  })

  it('解析字符串响应体（后端未设 content-type 的情况）', async () => {
    mockUni((o) => o.success({ statusCode: 200, data: '{"ok":true}' }))
    const r = await getJson('/api/news')
    expect(r).toEqual({ ok: true })
  })

  it('非法 JSON 抛 ApiError', async () => {
    mockUni((o) => o.success({ statusCode: 200, data: '<html>oops' }))
    await expect(getJson('/api/news')).rejects.toBeInstanceOf(ApiError)
  })

  it('默认超时为 15s，且 GET 默认重试 1 次', async () => {
    const calls = mockUni((o) => o.success({ statusCode: 200, data: { ok: true } }))
    await getJson('/api/news')
    expect(calls[0].timeout).toBe(15000)
  })

  it('显式 timeout 生效', async () => {
    const calls = mockUni((o) => o.success({ statusCode: 200, data: {} }))
    await getJson('/api/news', undefined, { timeout: 20000 })
    expect(calls[0].timeout).toBe(20000)
  })
})

describe('request 错误归一化', () => {
  it('4xx 透传服务端 error 字段，而不是干巴巴的 HTTP 码', async () => {
    mockUni((o) => o.success({ statusCode: 400, data: { ok: false, error: '代码格式不对' } }))
    await expect(getJson('/api/x')).rejects.toMatchObject({ status: 400, message: '代码格式不对' })
  })

  it('网络失败归一为 ApiError（status=0）', async () => {
    mockUni((o) => o.fail({ errMsg: 'request:fail timeout' }))
    await expect(getJson('/api/x')).rejects.toMatchObject({ status: 0, message: 'request:fail timeout' })
  })

  it('5xx 且重试次数用尽后抛出', async () => {
    const calls = mockUni((o) => o.success({ statusCode: 500, data: { error: 'boom' } }))
    await expect(getJson('/api/x')).rejects.toBeInstanceOf(ApiError)
    // 默认 retry=1 → 共 2 次
    expect(calls.length).toBe(2)
  })

  it('4xx 不重试（重试也不会变对）', async () => {
    const calls = mockUni((o) => o.success({ statusCode: 404, data: { error: 'not found' } }))
    await expect(getJson('/api/x')).rejects.toBeInstanceOf(ApiError)
    expect(calls.length).toBe(1)
  })

  it('写操作默认不重试，避免重复提交', async () => {
    const calls = mockUni((o) => o.fail({ errMsg: 'network down' }))
    await expect(sendJson('/api/holdings', 'POST', { a: 1 })).rejects.toBeInstanceOf(ApiError)
    expect(calls.length).toBe(1)
  })

  it('retry: 0 显式关闭重试', async () => {
    const calls = mockUni((o) => o.fail({ errMsg: 'x' }))
    await expect(getJson('/api/x', undefined, { retry: 0 })).rejects.toBeInstanceOf(ApiError)
    expect(calls.length).toBe(1)
  })

  it('throwOnError: false 时降级返回 null 而不抛', async () => {
    mockUni((o) => o.success({ statusCode: 500, data: {} }))
    const r = await getJson('/api/x', undefined, { throwOnError: false })
    expect(r).toBeNull()
  })
})

describe('环境兜底', () => {
  it('非 uni 环境（如 node 脚本）明确报错，不静默 undefined', async () => {
    clearUni()
    await expect(getJson('/api/x')).rejects.toThrow(/不支持 uni.request/)
  })
})
