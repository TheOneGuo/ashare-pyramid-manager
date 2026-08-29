// portfolio-extract.ts — 截图 OCR 字段提取
// 对应原 A股景气捕手 project 的 position_strategy.extract_positions_from_images
// 优先用多模态 LLM（DeepSeek-VL / Qwen-VL），无 LLM key 时降级到 mock 数据

const EXTRACT_PROMPT = `你是 A 股持仓截图字段提取器。只从图片中识别每个持仓标的的字段：
- code：股票代码（6 位数字）
- name：股票名称
- cost：成本价（元，2 位小数）
- qty：持仓数量（股，整数）
- cur：当前价或最新价（图中有则填，没有就 0）

只输出严格 JSON：{"positions":[{"code":"","name":"","cost":0,"qty":0,"cur":0}, ...]}
不要包含任何分析、建议、Markdown 或额外解释。
看不清的字段留 0 或空字符串，不要编造。`

const MOCK_POSITIONS = [
  { code: '600519', name: '贵州茅台', cost: 1700.0, qty: 100, cur: 0 },
  { code: '000858', name: '五粮液', cost: 165.0, qty: 200, cur: 0 },
  { code: '300750', name: '宁德时代', cost: 220.0, qty: 100, cur: 0 },
]

interface ExtractInput {
  images?: string[]   // data:image/png;base64,... 或纯 base64
}

interface Position {
  code: string
  name: string
  cost: number
  qty: number
  cur: number
}

function normalizeImage(b64: string): string {
  if (!b64) return b64
  if (b64.startsWith('data:')) return b64
  // 简单嗅探：JPEG / PNG / WebP
  if (b64.startsWith('/9j/')) return `data:image/jpeg;base64,${b64}`
  if (b64.startsWith('iVBOR')) return `data:image/png;base64,${b64}`
  if (b64.startsWith('UklGR')) return `data:image/webp;base64,${b64}`
  return `data:image/png;base64,${b64}`
}

function parsePositions(content: string): Position[] {
  let json = content.trim()
  // 剥 markdown 围栏
  if (json.startsWith('```')) {
    json = json.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
  }
  // 找第一个 { ... } 子串
  const m = json.match(/\{[\s\S]*\}/)
  if (!m) return []
  let obj: any
  try { obj = JSON.parse(m[0]) } catch { return [] }
  const arr = obj.positions || obj.data?.positions || obj.result?.positions || []
  const out: Position[] = []
  for (const p of arr) {
    const code = String(p.code || '').trim()
    if (!code) continue
    out.push({
      code,
      name: String(p.name || '').trim(),
      cost: Number(p.cost) || 0,
      qty: Math.round(Number(p.qty) || 0),
      cur: Number(p.cur) || 0,
    })
  }
  return out
}

async function callLLMExtract(images: string[]): Promise<Position[]> {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) throw new Error('LLM_API_KEY not set')
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.deepseek.com'
  // DeepSeek chat 模型不支持 image_url，优先用 deepseek-vl / qwen-vl
  // 用户 LLM_BASE_URL + LLM_MODEL 决定具体模型
  const model = process.env.LLM_MODEL || 'deepseek-chat'

  const messages: any[] = [{
    role: 'user',
    content: [
      { type: 'text', text: EXTRACT_PROMPT },
      ...images.map((b) => ({ type: 'image_url', image_url: { url: normalizeImage(b) } })),
    ],
  }]

  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, temperature: 0.1 }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(45_000) : undefined,
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`LLM HTTP ${r.status} ${txt.slice(0, 200)}`)
  }
  const j = await r.json()
  const content = j.choices?.[0]?.message?.content || ''
  return parsePositions(String(content))
}

export async function handleExtract(input: ExtractInput) {
  const { images = [] } = input
  if (!images || !images.length) {
    return { ok: false, error: 'images 数组为空（请传 1~3 张 base64）' }
  }
  if (images.length > 3) {
    return { ok: false, error: '单次最多 3 张图' }
  }

  // 优先 LLM
  if (process.env.LLM_API_KEY) {
    try {
      const positions = await callLLMExtract(images)
      if (positions.length > 0) {
        return { ok: true, mock: false, count: positions.length, positions }
      }
      // LLM 返回空，mock 兜底
      return {
        ok: true,
        mock: true,
        note: 'LLM 识别返回为空，启用 mock 数据。',
        count: MOCK_POSITIONS.length,
        positions: MOCK_POSITIONS,
      }
    } catch (e) {
      console.warn('[extract] LLM failed, fallback to mock:', (e as Error).message)
      // 继续走 mock
    }
  }

  // Mock 降级
  return {
    ok: true,
    mock: true,
    note: 'LLM_API_KEY 未配置（或 LLM 失败），返回 mock 数据。在 .env 设置 LLM_API_KEY 后可用真实多模态识别。',
    count: MOCK_POSITIONS.length,
    positions: MOCK_POSITIONS,
  }
}
