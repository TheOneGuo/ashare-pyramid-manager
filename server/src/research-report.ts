// research-report.ts · AI 研报解读（结构化 mock 版）
// 对应原项目 ai-research-panel 的「十二个研究模块」展示。
//
// 当前为「展示壳 + 结构化 mock」：无需 API key 即可演示完整研报 UI。
// 后续接真 LLM 时，只需把 buildMockReport 换成真实生成逻辑（保持返回结构一致即可）。

// 十二个研究模块（与原项目体例一致）
export const RESEARCH_MODULES: string[] = [
  '公司概况与主营业务',
  '行业空间与增长',
  '竞争格局与护城河',
  '商业模式与盈利质量',
  '产业链与上下游',
  '客户结构与大客户',
  '产能、订单与供需',
  '财务质量（三张表）',
  '估值与同业对比',
  '催化剂与时间轴',
  '风险清单',
  '管理层与公司治理',
]

// 风险提示（与免责声明一致，原项目风格）
const DISCLAIMER =
  '本研报由本地结构化模板生成（演示模式，未接入真实 LLM）。' +
  '所有内容仅用于研究复盘与基本面跟踪参考，不构成任何买卖建议；实际决策请自行研判并控制风险。'

// ============================================================================
// 先进生产力行业识别：半导体 / 生物制药 / 新能源 / 航空航天 / 关键原材料
// 用户要求：与这些行业相关的研报打"推荐"评级
// ============================================================================
export const ADVANCED_PRODUCTIVITY_KEYWORDS: { category: string; keywords: string[] }[] = [
  { category: '半导体', keywords: ['半导体', '芯片', '集成电路', 'IC设计', '晶圆', 'wafer', 'semiconductor', 'chip', 'fab', '光刻机', 'ASML', 'TSMC', '台积电', '中芯国际', 'GPU', 'AI芯片', '存储芯片', 'DRAM', 'NAND', '设备厂', '封测', 'EDA', 'IP授权'] },
  { category: '生物制药', keywords: ['生物制药', '创新药', '生物药', '抗体', 'ADC', 'PD-1', 'PD-L1', 'CAR-T', '基因', 'mRNA', '疫苗', '单抗', '双抗', 'GLP-1', '减肥药', '肿瘤', '靶向', 'biotech', 'pharma', 'biopharma', 'CRO', 'CDMO', '创新医疗器械'] },
  { category: '新能源', keywords: ['新能源', '锂电', '锂电池', '动力电池', '储能', '光伏', '太阳能', '风电', '氢能', '氢燃料', '固态电池', '钠离子', '碳酸锂', '正极材料', '负极材料', '电解液', '隔膜', 'EV', 'electric vehicle', 'battery', 'solar', 'wind', 'hydrogen'] },
  { category: '航空航天', keywords: ['航空航天', '航空发动机', '大飞机', 'C919', '卫星', '火箭', '商业航天', '低空经济', '无人机', 'eVTOL', '载人航天', '北斗', 'spaceX', 'aerospace', 'satellite', 'rocket', 'drone', 'aviation'] },
  { category: '关键原材料', keywords: ['稀土', '永磁', '锂矿', '钴矿', '镍矿', '半导体材料', '光刻胶', '电子特气', '硅片', '靶材', '关键矿产', '战略物资', '稀土永磁', '永磁电机', '镨钕', '铟', '锗', '钨', '钼', 'rare earth', 'lithium', 'cobalt', 'nickel', 'silicon wafer', 'photoresist'] },
]

export interface ProductivityMatch {
  isRecommended: boolean
  categories: string[]
}

export function detectAdvancedProductivity(text: string): ProductivityMatch {
  if (!text) return { isRecommended: false, categories: [] }
  const t = text.toLowerCase()
  const cats: string[] = []
  for (const { category, keywords } of ADVANCED_PRODUCTIVITY_KEYWORDS) {
    if (keywords.some((k) => t.includes(k.toLowerCase()))) {
      cats.push(category)
    }
  }
  return { isRecommended: cats.length > 0, categories: cats }
}

// ============================================================================
// 标题翻译 + 代码标记：英文标题 → 中文，外资研报里同时出现美股+ A 股代码时标出
// 调用 LLM（chatJson），失败时返回原标题
// ============================================================================
import { chatJson, isLlmAvailable } from './llm.js'

const TRANSLATE_SYSTEM = `你是研报标题翻译助手。任务：
1. 如果标题是英文，翻译成简洁中文（保留公司名/股票代码/关键术语如 Buy/Sell/Overweight）
2. 如果原文中同时出现美股代码（如 TSLA、AAPL、NVO）和 A 股代码（如 600519、300750），在中文标题后用方括号标出：[美:TSLA / A:600519]
3. 只输出最终的中文标题，不要解释。`

export interface TranslatedTitle {
  titleZh: string
  usCodes: string[]
  aCodes: string[]
}

export async function translateReportTitle(origTitle: string, hint?: string): Promise<TranslatedTitle> {
  const fallback: TranslatedTitle = { titleZh: origTitle, usCodes: [], aCodes: [] }
  if (!isLlmAvailable() || !origTitle || !/[a-zA-Z]/.test(origTitle)) return fallback
  const user = `原标题：${origTitle}\n${hint ? '上下文：' + hint : ''}\n输出格式（严格 JSON）：{"title_zh": "...", "us_codes": ["..."], "a_codes": ["..."]}`
  const r = await chatJson<{ title_zh?: string; us_codes?: string[]; a_codes?: string[] }>({
    system: TRANSLATE_SYSTEM, user, jsonHint: true, maxTokens: 200, temperature: 0.2,
  })
  if (!r || typeof r !== 'object') return fallback
  const titleZh = String(r.title_zh || origTitle).trim().slice(0, 200)
  const usCodes = Array.isArray(r.us_codes) ? r.us_codes.map((x) => String(x).toUpperCase()).filter(Boolean).slice(0, 5) : []
  const aCodes = Array.isArray(r.a_codes) ? r.a_codes.map((x) => String(x).toLowerCase()).filter(Boolean).slice(0, 5) : []
  return { titleZh, usCodes, aCodes }
}

// ============================================================================
// Txt 原文 → JSON-Markdown 渲染：把上游 LLM 提炼的 tldr/key_points/...
// 转成可读 Markdown（用于"查看原文"按钮在 txt 时的展示）
// ============================================================================
export function refinedToMarkdown(r: {
  title?: string
  broker?: string
  industry?: string
  tldr?: string
  key_points?: string[]
  opportunities?: string[]
  risks?: string[]
  status?: string
  created_at?: number
}): string {
  const lines: string[] = []
  lines.push(`# ${r.title || '研报精读'}`)
  if (r.broker || r.industry) {
    const meta = [r.broker && `**来源**：${r.broker}`, r.industry && `**行业**：${r.industry}`].filter(Boolean).join('  ·  ')
    if (meta) lines.push(meta)
  }
  if (r.status) lines.push(`**状态**：${r.status}${r.created_at ? '  ·  **时间**：' + new Date(r.created_at).toISOString() : ''}`)
  lines.push('')
  if (r.tldr) {
    lines.push('## 一句话精读')
    lines.push(r.tldr)
    lines.push('')
  }
  if (r.key_points?.length) {
    lines.push('## 核心观点')
    r.key_points.forEach((p, i) => lines.push(`${i + 1}. ${p}`))
    lines.push('')
  }
  if (r.opportunities?.length) {
    lines.push('## 新机会')
    r.opportunities.forEach((p) => lines.push(`- ${p}`))
    lines.push('')
  }
  if (r.risks?.length) {
    lines.push('## 风险点')
    r.risks.forEach((p) => lines.push(`- ${p}`))
    lines.push('')
  }
  lines.push('---')
  lines.push('*本内容由 AI 自动提炼，仅供参考，不构成投资建议。*')
  return lines.join('\n')
}

export interface ResearchModuleBlock {
  title: string
  summary: string
  points: string[]
  verdict?: string // 模块级结论（如 强/中/弱）
}

export interface ResearchReport {
  ok: true
  stock_code: string
  stock_name: string
  query: string
  generated_at: string
  mode: 'mock' // 后续可扩展 'llm'
  overall: string // 一句话总评
  rating: string // 综合评级（如 跟踪 / 增持观察 / 谨慎）
  modules: ResearchModuleBlock[]
  disclaimer: string
}

function normalizeCode(code: string): string {
  const c = String(code || '').trim()
  return /^\d{6}$/.test(c) ? c : c
}

function mockBlock(title: string, name: string): ResearchModuleBlock {
  // 每个模块给一个贴合 A股 研究语境的占位结论，避免空壳。
  const map: Record<string, { summary: string; points: string[]; verdict?: string }> = {
    '公司概况与主营业务': {
      verdict: '中',
      summary: `${name} 主营业务清晰，收入结构以核心产品为主，近年围绕主业做延伸布局。`,
      points: [
        '主营构成：核心产品占收入比重较高，业务集中度需关注。',
        '区域/客户分布：以国内为主，海外占比视业务而定。',
        '近三年营收复合增速与行业景气高度相关。',
      ],
    },
    '行业空间与增长': {
      verdict: '中高',
      summary: `所在赛道处于成长期，下游需求受周期与政策双重驱动，渗透率仍有提升空间。`,
      points: [
        '市场规模：测算未来 3 年行业 CAGR 处双位数区间。',
        '驱动因素：下游扩产、国产替代、新品迭代为三大增量。',
        '观测指标：产能利用率、新增订单、招标量。',
      ],
    },
    '竞争格局与护城河': {
      verdict: '中',
      summary: `${name} 在细分环节具备一定份额，但头部集中度仍高，护城河以成本/客户黏性为主。`,
      points: [
        '市占率：处于第二梯队，与龙头存在差距。',
        '护城河：工艺know-how + 认证壁垒 + 规模效应。',
        '潜在颠覆：新技术路线或跨界玩家的替代风险。',
      ],
    },
    '商业模式与盈利质量': {
      verdict: '中',
      summary: '以制造/产品交付为主，毛利受原材料与产能利用率影响，盈利质量需结合现金流看。',
      points: [
        '收入确认：以产品交付/验收为主，回款周期适中。',
        '毛利波动：与上游价格、良率高度相关。',
        '盈利质量：关注经营现金流对净利润的覆盖。',
      ],
    },
    '产业链与上下游': {
      verdict: '中',
      summary: '上游受大宗/电子料价格影响，下游对接终端或中游客户，议价能力中游。',
      points: [
        '上游：关键材料/设备存在进口依赖或集中供应。',
        '下游：绑定大客户可平滑波动，但集中度风险并存。',
        '库存：关注存货周转与减值迹象。',
      ],
    },
    '客户结构与大客户': {
      verdict: '中',
      summary: '大客户贡献占比较高，需关注单一客户依赖与年降压力。',
      points: [
        '前五大客户占比：偏高，需分散。',
        '粘性：通过认证+联合研发形成绑定。',
        '风险：大客户自研/二供导入的份额侵蚀。',
      ],
    },
    '产能、订单与供需': {
      verdict: '中高',
      summary: '处于扩产周期，新增产能释放节奏决定供需与价格弹性。',
      points: [
        '产能：在建/规划产能较大，关注投产时点。',
        '订单：在手订单覆盖度与能见度。',
        '供需：新增供给若集中释放，价格或承压。',
      ],
    },
    '财务质量（三张表）': {
      verdict: '中',
      summary: '资产负债率适中，资本开支阶段性抬升，关注自由现金流。',
      points: [
        '资产负债表：有息负债与授信额度匹配扩产。',
        '利润表：毛利/费用率随稼动率波动。',
        '现金流量表：Capex 高峰自由现金流转负属正常。',
      ],
    },
    '估值与同业对比': {
      verdict: '中',
      summary: '当前估值处于板块中枢，需结合增速用 PEG 综合判断。',
      points: [
        'PE/PEG：与可比公司对比处合理区间。',
        'EV/EBITDA：重资产属性下需纳入考量。',
        '隐含预期：股价已反映部分扩产兑现预期。',
      ],
    },
    '催化剂与时间轴': {
      verdict: '中',
      summary: '未来 1-2 年催化集中于产能落地、大客户导入与业绩兑现。',
      points: [
        '近催化：新建产线投产 / 新品送样通过。',
        '中催化：大客户份额提升 / 中标落地。',
        '远催化：行业需求拐点 / 政策利好。',
      ],
    },
    '风险清单': {
      verdict: '关注',
      summary: '核心风险为价格下行、产能消化不及预期与宏观需求波动。',
      points: [
        '价格风险：供需错配导致产品降价。',
        '执行风险：扩产延期或良率不达标。',
        '外部风险：贸易限制、汇率、利率扰动。',
      ],
    },
    '管理层与公司治理': {
      verdict: '中',
      summary: '实控人持股集中，治理规范性随上市年限提升。',
      points: [
        '股权：实控人/管理层持股稳定。',
        '激励：股权激励覆盖核心骨干。',
        '治理：关注关联交易与信息披露合规。',
      ],
    },
  }
  const m = map[title] || { summary: '', points: [], verdict: undefined }
  return { title, ...m }
}

export function buildMockReport(input: {
  stock_code?: string
  stock_name?: string
  query?: string
}): ResearchReport {
  const code = normalizeCode(input.stock_code || '')
  const name = (input.stock_name || '该标的').trim() || '该标的'
  const query = (input.query || '').trim()

  const modules = RESEARCH_MODULES.map((t) => mockBlock(t, name))

  // 综合评级（基于各模块 verdict 的简单聚合，演示用）
  const verdicts = modules.map((m) => m.verdict || '')
  const positive = verdicts.filter((v) => v.includes('高')).length
  const cautious = verdicts.filter((v) => v === '关注').length
  let rating = '跟踪观察'
  if (positive >= 3 && cautious === 0) rating = '增持观察'
  else if (cautious >= 2) rating = '谨慎'

  const overall =
    `${name}（${code || '—'}）基本面处于成长期，扩产与国产替代为主线，` +
    `需重点跟踪产能消化与价格变化；综合评级：${rating}。`

  return {
    ok: true,
    stock_code: code,
    stock_name: name,
    query,
    generated_at: new Date().toISOString(),
    mode: 'mock',
    overall,
    rating,
    modules,
    disclaimer: DISCLAIMER,
  }
}

// ─── 研报 AI 精读：整篇外部研报入库 + 提炼 ───
// 输入一段完整研报原文（外资/内资券商/行业研究等），输出结构化精读。
// 当前为结构化 mock：按原文长度/关键词做轻量提炼；接真 LLM 时替换 extractFromText。

export interface RefinedReport {
  ok: true
  id: string
  title: string
  broker: string
  industry: string
  source_url: string
  raw_text: string
  tldr: string
  key_points: string[]
  opportunities: string[]
  risks: string[]
  status: string
  created_at: number
}

function hashId(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return 'r' + h.toString(36) + Date.now().toString(36)
}

// 关键词命中（演示用）+ 句级切分
function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/[。！？\.\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6)
}

const OPPORTUNITY_HINTS = ['空间', '增长', '扩容', '国产替代', '渗透率', '提价', '订单', '中标', '扩产', '新品', '催化', '拐点', '受益', '份额']
const RISK_HINTS = ['风险', '下滑', '降价', '承压', '不及预期', '波动', '竞争', '监管', '贸易', '汇率', '减值', '延期']

function pickByHints(sentences: string[], hints: string[], max = 6): string[] {
  const hit = sentences.filter((s) => hints.some((h) => s.includes(h)))
  const out = hit.slice(0, max)
  // 不足则用首尾句补足
  if (out.length < 3 && sentences.length) {
    for (const s of [sentences[0], sentences[sentences.length - 1]]) {
      if (s && !out.includes(s)) out.push(s)
      if (out.length >= 3) break
    }
  }
  return out
}

export function refineExternalReport(input: {
  title?: string
  broker?: string
  industry?: string
  source_url?: string
  raw_text: string
}): RefinedReport {
  const raw = (input.raw_text || '').trim()
  const sentences = splitSentences(raw)
  const prefix = input.broker ? '由' + input.broker + '提供' : '为外部研报'
  const theme = input.industry ? '，主题：' + input.industry : ''
  const firstSentence = sentences[0] || '（原文较短，未提取到可总结句）'
  const tldr = '本报告' + prefix + theme + '，全文约 ' + raw.length + ' 字。核心结论：' + firstSentence
const key_points = pickByHints(sentences, ['认为', '预计', '预计', '建议', '看好', '核心', '重点', '指出', '目标'], 6)
  const opportunities = pickByHints(sentences, OPPORTUNITY_HINTS, 6)
  const risks = pickByHints(sentences, RISK_HINTS, 6)
  const id = hashId(raw.slice(0, 200) + (input.title || ''))
  const now = Date.now()
  return {
    ok: true,
    id,
    title: (input.title || '').trim() || '未命名研报',
    broker: (input.broker || '').trim(),
    industry: (input.industry || '').trim(),
    source_url: (input.source_url || '').trim(),
    raw_text: raw,
    tldr,
    key_points,
    opportunities,
    risks,
    status: 'refined',
    created_at: now,
  }
}

// 处理入口（供 Express 路由调用）
export async function handleResearch(body: {
  stock_code?: string
  stock_name?: string
  query?: string
} = {}): Promise<ResearchReport> {
  // 后续接真 LLM：在此根据 env 中的 AI 配置切换 buildMockReport / buildLlmReport
  return buildMockReport(body)
}

// ============================================================================
// 真 LLM 精读：fxbaogao 研报 PDF 文本 → 结构化字段
// 没有 LLM key 时返回 null（让上层走 mock 兜底）
// ============================================================================
import { chatJson, isLlmAvailable } from './llm.js'

const REFINED_SYSTEM = `你是「节节高」研报精读助手，把卖方/外资研报正文提炼成结构化要点。要求：
- 中文输出，简洁专业，不要客套
- tldr: 一句话总评（含评级/目标价/方向，如无则省略）
- key_points: 核心观点 3-6 条
- opportunities: 新机会/正面催化 3-6 条
- risks: 风险点 3-6 条
- report_type: 研报类型判定，只能是 stock/industry/macro/strategy/minutes/other 之一
  （stock=个股研报, industry=行业研究, macro=宏观, strategy=策略, minutes=会议纪要, other=其他）
- region: 研报主要涉及的市场/地区，只能是 CN/US/KR/JP/TW/HK/GLOBAL/OTHER 之一
  （CN=中国/A股, US=美国/美股, KR=韩国, JP=日本, TW=台湾, HK=香港/港股, GLOBAL=全球, OTHER=其他）
- perspective: 研报的分析视角，只能是 产业/金融/供应链/技术/订单/认证/'' 之一
  （产业=产业与行业格局, 金融=金融/资本/估值视角, 供应链=供应链/上下游/供应商, 技术=技术/研发/工艺,
    订单=订单/产能/交付, 认证=客户认证/进入供应链认证；无法判断用空串）
- extraction: 从正文中尽力提取以下维度（研报未提及的字段用空数组/空串，不要编造）：
  - stocks: 提及的 A 股/港股/美股标的 [{code:"6位代码", name:"公司名"}]
  - industry: 所属行业（如"半导体""食品饮料"）
  - suppliers: 供应商/上游企业
  - buyers: 产品买方/下游客户
  - regulations: 国内外有影响的法律法规/监管政策
  - raw_materials: 提及的原材料
  - origin_risks: 原材料产地的自然风险与地缘冲突风险
  - orders: 订单/在手订单信息
  - certifications: 知名大厂认证/客户认证（如进入苹果/特斯拉供应链）
  - financials: 财报关键数据（营收/利润/增速等）
  - key_persons: 关键控制人/实际控制人/核心管理层
- 严格按 JSON 输出，不要加任何额外字段或解释`

export interface LlmExtraction {
  stocks?: { code?: string; name?: string }[]
  industry?: string
  suppliers?: string[]
  buyers?: string[]
  regulations?: string[]
  raw_materials?: string[]
  origin_risks?: string[]
  orders?: string[]
  certifications?: string[]
  financials?: string[]
  key_persons?: string[]
}

export async function refineWithLlm(input: {
  raw_text: string
  title?: string
  broker?: string
  industry?: string
}): Promise<{ tldr: string; key_points: string[]; opportunities: string[]; risks: string[]; report_type?: string; region?: string; perspective?: string; extraction?: LlmExtraction; mode: 'llm' | 'fallback' } | null> {
  if (!isLlmAvailable()) return null
  const raw = (input.raw_text || '').trim().slice(0, 18000) // 控制 token
  if (raw.length < 200) return null
  const meta = [
    input.title ? `标题：${input.title}` : '',
    input.broker ? `机构：${input.broker}` : '',
    input.industry ? `行业：${input.industry}` : '',
  ].filter(Boolean).join('\n')
  const user = `${meta}\n\n研报正文（截取前 18000 字）：\n${raw}\n\n请按以下 JSON 结构输出（extraction 各字段未提及时用空数组/空串）：
{"tldr":"...", "key_points":["..."], "opportunities":["..."], "risks":["..."], "report_type":"stock|industry|macro|strategy|minutes|other",
 "region":"CN|US|KR|JP|TW|HK|GLOBAL|OTHER", "perspective":"产业|金融|供应链|技术|订单|认证|",
 "extraction":{"stocks":[{"code":"6位代码","name":"公司名"}], "industry":"...", "suppliers":["..."], "buyers":["..."], "regulations":["..."], "raw_materials":["..."], "origin_risks":["..."], "orders":["..."], "certifications":["..."], "financials":["..."], "key_persons":["..."]}}`
  const result = await chatJson<{ tldr?: string; key_points?: string[]; opportunities?: string[]; risks?: string[]; report_type?: string; region?: string; perspective?: string; extraction?: LlmExtraction }>({
    system: REFINED_SYSTEM,
    user,
    jsonHint: true,
    maxTokens: 3200,
    temperature: 0.2,
  })
  if (!result || typeof result !== 'object') return null
  const pickStr = (v: any) => String(v || '').trim()
  const pickList = (v: any): string[] => Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter((x) => x.length > 0).slice(0, 8) : []
  // report_type 归一（非法值兜底 other）
  const rt = pickStr(result.report_type).toLowerCase()
  const reportType = ['stock', 'industry', 'macro', 'strategy', 'minutes', 'other'].includes(rt) ? rt : 'other'
  // region 归一（CN/US/KR/JP/TW/HK/GLOBAL/OTHER，非法值兜底 OTHER）
  const reg = pickStr(result.region).toUpperCase()
  const region = ['CN', 'US', 'KR', 'JP', 'TW', 'HK', 'GLOBAL'].includes(reg) ? reg : 'OTHER'
  // perspective 归一（产业/金融/供应链/技术/订单/认证/''，非法值兜底 ''）
  const pv = pickStr(result.perspective)
  const perspective = ['产业', '金融', '供应链', '技术', '订单', '认证'].includes(pv) ? pv : ''
  // extraction 清洗：数组字段去空、标的代码归一
  const rawExt = (result.extraction && typeof result.extraction === 'object') ? result.extraction : {}
  const stocks = Array.isArray(rawExt.stocks)
    ? rawExt.stocks.map((s: any) => ({ code: String(s?.code || '').replace(/\D/g, '').slice(0, 6), name: String(s?.name || '').trim() })).filter((s: any) => s.code || s.name).slice(0, 10)
    : []
  const extraction: LlmExtraction = {
    stocks,
    industry: pickStr(rawExt.industry).slice(0, 40),
    suppliers: pickList(rawExt.suppliers),
    buyers: pickList(rawExt.buyers),
    regulations: pickList(rawExt.regulations),
    raw_materials: pickList(rawExt.raw_materials),
    origin_risks: pickList(rawExt.origin_risks),
    orders: pickList(rawExt.orders),
    certifications: pickList(rawExt.certifications),
    financials: pickList(rawExt.financials),
    key_persons: pickList(rawExt.key_persons),
  }
  return {
    tldr: pickStr(result.tldr).slice(0, 800),
    key_points: pickList(result.key_points),
    opportunities: pickList(result.opportunities),
    risks: pickList(result.risks),
    report_type: reportType,
    region,
    perspective,
    extraction,
    mode: 'llm',
  }
}

// 把 LLM 提炼结果（或者 mock 兜底结果）合并成完整的 RefinedReport 入库形态
export function buildRefinedReport(input: {
  id?: string
  title: string
  broker: string
  industry: string
  source_url: string
  raw_text: string
  llmResult: { tldr: string; key_points: string[]; opportunities: string[]; risks: string[]; mode: 'llm' | 'fallback' } | null
}): RefinedReport {
  const fallback = refineExternalReport({
    title: input.title,
    broker: input.broker,
    industry: input.industry,
    source_url: input.source_url,
    raw_text: input.raw_text,
  })
  const use = input.llmResult
  const now = Date.now()
  return {
    ...fallback,
    title: (input.title || fallback.title).slice(0, 200),
    broker: (input.broker || fallback.broker).slice(0, 80),
    industry: (input.industry || fallback.industry).slice(0, 80),
    source_url: (input.source_url || fallback.source_url).slice(0, 500),
    raw_text: input.raw_text.slice(0, 60000),
    tldr: (use?.tldr || fallback.tldr).slice(0, 2000),
    key_points: (use?.key_points?.length ? use.key_points : fallback.key_points).slice(0, 8),
    opportunities: (use?.opportunities?.length ? use.opportunities : fallback.opportunities).slice(0, 8),
    risks: (use?.risks?.length ? use.risks : fallback.risks).slice(0, 8),
    status: use?.mode === 'llm' ? 'refined-llm' : 'refined-mock',
    id: input.id || fallback.id,
    created_at: fallback.created_at || now,
  }
}
