// stock-service.ts — 持仓入库富化服务
// 等价替代 akshare（本机无 Python/akshare，且商用受限）：
//   - 代码→名称/现价：腾讯行情 qt.gtimg.cn（akshare 底层同源）
//   - 名称→代码：新浪智能提示 suggest3.sinajs.cn
// 任意来源（拍照/导入文件/手动）只需 code|name 任一项 + cost + shares，
// 自动补全另一项与现价，并算出盈亏。

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------- 行情/解析（同源 akshare 上游） ----------

async function fetchText(url: string): Promise<string> {
  const ctl: any = (AbortSignal as any).timeout ? (AbortSignal as any).timeout(10_000) : undefined
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (AsharePyramid)' }, signal: ctl })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const buf = await r.arrayBuffer()
  return new TextDecoder('gbk').decode(buf)
}

// 腾讯行情单只：返回 {name, price} 或 null
export async function fetchQuote(code: string): Promise<{ name: string; price: number } | null> {
  const c = String(code).padStart(6, '0')
  const prefix = c.startsWith('6') ? 'sh' : 'sz'
  const url = `https://qt.gtimg.cn/q=${prefix}${c}`
  try {
    const txt = await fetchText(url)
    // v_sh600519="1~贵州茅台~600519~1341.99~..."
    const m = txt.match(/="\d+~([^~]+)~\d+~([\d.]+)~/)
    if (!m) return null
    const price = parseFloat(m[2])
    if (Number.isNaN(price)) return null
    return { name: m[1], price }
  } catch {
    return null
  }
}

// 名称→代码：新浪智能提示
export async function resolveCodeByName(name: string): Promise<{ code: string; market: string; name: string } | null> {
  const q = encodeURIComponent(name.trim())
  const url = `https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15,16,17,18,19,20&key=${q}&name=1`
  try {
    const txt = await fetchText(url)
    // var 1="贵州茅台,11,600519,sh600519,贵州茅台,,贵州茅台,99,1,ESG,,";
    const m = txt.match(/="([^"]+)"/)
    if (!m) return null
    const parts = m[1].split(',')
    if (parts.length < 4) return null
    const nm = parts[0]
    const code = parts[2]
    const full = parts[3] // sh600519
    if (!/^\d{6}$/.test(code)) return null
    const market = full.startsWith('sh') ? 'SH' : 'SZ'
    return { code, market, name: nm }
  } catch {
    return null
  }
}

// ---------- 富化单条持仓 ----------

/**
 * 归一化股票名称。
 * 行情源（腾讯 qt.gtimg.cn）对部分标的会在汉字间插入排版空格（实测「五 粮 液」），
 * 与用户手动录入/导入的「五粮液」不一致。若直接落库，60s 轮询会周期性把干净名称覆盖成带空格版本。
 * 规则：去掉所有空白字符；仅剩 6 位数字（即没解析出名称）时回退为空串，交由上层用代码兜底。
 */
export function cleanStockName(raw?: string | null, code?: string): string {
  const s = String(raw ?? '').replace(/\s+/g, '').trim()
  if (!s) return ''
  if (/^\d{6}$/.test(s) && s === String(code ?? '').padStart(6, '0')) return ''
  return s
}

export interface RawHolding {
  code?: string
  name?: string
  cost: number
  shares: number
}

export interface EnrichedHolding {
  stock_code: string
  short_name: string
  market: string
  shares: number
  cost_basis: number
  current_price: number
  pnl: number
  pnl_pct: number
}

export async function enrichHolding(raw: RawHolding): Promise<EnrichedHolding> {
  let code = (raw.code || '').trim()
  let name = (raw.name || '').trim()
  if (!code && !name) throw new Error('需提供代码或名称至少一项')
  if (!code && name) {
    const r = await resolveCodeByName(name)
    if (!r) throw new Error(`无法通过名称「${name}」解析到代码`)
    code = r.code
    name = r.name || name
  }
  const market = code.startsWith('6') ? 'SH' : 'SZ'
  if (!name || name === code) {
    const q = await fetchQuote(code)
    if (q) name = q.name
  }
  name = cleanStockName(name, code)
  const q = await fetchQuote(code)
  if (!q) throw new Error(`无法获取 ${code} 的实时行情`)
  const price = q.price
  const pnl = (price - raw.cost) * raw.shares
  const pnl_pct = raw.cost > 0 ? ((price - raw.cost) / raw.cost) * 100 : 0
  return {
    stock_code: code.padStart(6, '0'),
    short_name: name,
    market,
    shares: raw.shares,
    cost_basis: raw.cost,
    current_price: price,
    pnl,
    pnl_pct,
  }
}

// ---------- 文本/CSV 解析 ----------

// 支持两种格式：
//   (A) 每行：代码 成本 数量
//   (B) 每行：名称 成本 数量
// 以及带表头（代码/名称/成本/数量/现价）的 CSV
export function parseCsvHoldings(text: string): RawHolding[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out: RawHolding[] = []
  const cnNum = (s: string) => parseFloat(String(s).replace(/[元,，\s]/g, ''))
  for (const line of lines) {
    if (/^(代码|名称|code|name|stock)/i.test(line)) continue // 表头
    const cells = line.split(/[,，\t\s]+/).filter(Boolean)
    if (cells.length < 3) continue
    let code = ''
    let name = ''
    let cost = NaN
    let shares = NaN
    for (const cell of cells) {
      if (/^\d{6}$/.test(cell)) code = cell
      else if (cnNum(cell) === 0 && /\D/.test(cell)) name += (name ? ' ' : '') + cell
      else if (Number.isNaN(cost)) cost = cnNum(cell)
      else if (Number.isNaN(shares)) shares = cnNum(cell)
    }
    if (Number.isNaN(shares) || Number.isNaN(cost)) continue
    out.push({ code, name, cost, shares })
  }
  return out
}

// ---------- 文件分发 ----------

export interface ImportResult {
  ok: boolean
  source: string
  count: number
  enriched: EnrichedHolding[]
  errors: string[]
}

export async function importFromText(text: string, source: string): Promise<ImportResult> {
  const raws = parseCsvHoldings(text)
  const enriched: EnrichedHolding[] = []
  const errors: string[] = []
  for (const r of raws) {
    try {
      enriched.push(await enrichHolding(r))
    } catch (e: any) {
      errors.push(`${r.code || r.name || '?'}：${e.message}`)
    }
  }
  return { ok: enriched.length > 0, source, count: enriched.length, enriched, errors }
}

// 处理上传文件（截图/PDF 走 OCR，csv 走文本解析）
// fileB64: data:...;base64,... 或纯 base64；fileName 用于判断类型
export async function importFromFile(fileB64: string, fileName: string, ocrFn: (b64: string[]) => Promise<any>): Promise<ImportResult> {
  const ext = (fileName.split('.').pop() || '').toLowerCase()
  if (ext === 'csv' || ext === 'txt') {
    const b64 = fileB64.replace(/^data:.*;base64,/, '')
    const text = Buffer.from(b64, 'base64').toString('utf8')
    return importFromText(text, `file:${fileName}`)
  }
  if (ext === 'pdf') {
    try {
      const pdf = await import('pdf-parse')
      const b64 = fileB64.replace(/^data:.*;base64,/, '')
      const buf = Buffer.from(b64, 'base64')
      const data: any = await (pdf.default || pdf)(buf)
      return importFromText(data.text || '', `file:${fileName}`)
    } catch (e: any) {
      return { ok: false, source: `file:${fileName}`, count: 0, enriched: [], errors: ['PDF 解析失败：' + e.message] }
    }
  }
  // 图片（截图/拍照）→ OCR
  const ocr = await ocrFn([fileB64])
  const positions = ocr.positions || []
  const enriched: EnrichedHolding[] = []
  const errors: string[] = []
  for (const p of positions) {
    try {
      enriched.push(await enrichHolding({ code: p.code, name: p.name, cost: p.cost, shares: p.qty }))
    } catch (e: any) {
      errors.push(`${p.code || p.name || '?'}：${e.message}`)
    }
  }
  return { ok: enriched.length > 0, source: `file:${fileName}`, count: enriched.length, enriched, errors }
}

export async function writeTempFile(fileB64: string, ext: string): Promise<string> {
  const b64 = fileB64.replace(/^data:.*;base64,/, '')
  const p = path.join(os.tmpdir(), `ashare-up-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
  await fs.writeFile(p, Buffer.from(b64, 'base64'))
  return p
}
