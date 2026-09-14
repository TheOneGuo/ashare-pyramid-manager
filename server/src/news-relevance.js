// news-relevance.js — 财经快讯「相关性过滤 + 近似去重 + 每源配额」
//
// 背景（Gray 2026-09-10 提出）：
//   1) 新浪/华尔街见闻/Jin10 等源大量重复同一条消息，快讯流里看着像刷屏；
//   2) 一批与「A股标的 / 美股标的 / 中美政府政策法规 / 地缘政治 / 航道 / 关键原材料」
//      无关的社会、娱乐、体育、地方事务新闻混在流里；
//   3) 低频源（格隆汇约 20 条/日）被高频源（新浪约 2000 条/日）按时间倒序挤出窗口。
//
// 处理顺序（在读取层做，不删数据，便于随时调参回溯）：
//   applyRelevance → dedupeSimilar → applySourceQuota → scoreAll（重要度打分）
//   打分必须放在去重之后：多源共振（dup_count）本身就是重要性信号。
//
// 设计取舍：
//   - **白名单（命中任一主题词即保留）**，不用黑名单。因为「游戏/影视/旅游」这些词既是
//     社会新闻常见词，也是 A 股板块名（游戏版号、影视院线），黑名单会误杀板块消息；
//     而纯白名单天然把「湖人夺冠」「某地天气」这类无主题词的内容挡在外面。
//   - 过滤只在**读取层**做：DB 仍保留全量原文，调词表不需要重采，也便于回溯误杀。
//   - 任一环节都可用环境变量关闭：NEWS_FILTER_OFF=1 全局关；接口 ?raw=1 单次绕过。

// =====================================================
// 一、主题词表（命中任一即视为相关）
//    注意：只放「有明确指向」的词，避免 通知/政策/标准 这类泛词把噪声放进来。
// =====================================================
const THEMES = {
  // A股标的 / 市场
  a_stock: [
    'A股', '沪指', '上证', '深证', '创业板', '科创板', '北交所', '沪深', '两市',
    '涨停', '跌停', '个股', '板块', '龙虎榜', '主力资金', '北向资金', '南向资金',
    '上市公司', '公告称', '公告，', '招股书', '新股', 'IPO', '定增', '向特定对象发行',
    '回购', '分红', '派息', '解禁', '减持', '增持', '控制权', '股权转让', '要约收购',
    '重组', '并购', '收购', '停牌', '复牌', '退市', '业绩预告', '业绩快报',
    '中标', '签约金额', '定增获批', '问询函', '监管函', '立案调查', '行政处罚',
    '券商', '公募', '私募', '险资', '中长期资金', '投资者回报', '市值管理', '做市',
    '上市公司公告', '股东大会', '董事会', '监事会', '董监高',
  ],
  // 美股 / 海外上市中国公司 / 产业链关键公司
  us_stock: [
    '美股', '纳斯达克', '标普500', '标普', '道琼斯', '纽交所', '中概股', 'ADR',
    'SEC', '财报', '盘前', '盘后', '美元指数', '英伟达', '苹果公司', '特斯拉',
    '微软', '谷歌', '亚马逊', 'Meta', '台积电', '博通', '甲骨文', '美光',
    '英特尔', 'AMD', '高通', '阿斯麦', 'ASML', '应用材料', '三星', 'SK海力士',
    '联发科', '爱立信', '诺基亚',
  ],
  // 公司基本面（任何市场都影响标的，外企财报会传导到 A 股产业链）
  company_financials: [
    '营收', '净利', '净利润', '毛利率', '销售额', '业绩', '销量', '产量',
    '库存', '产能', '扩产', '减产', '停产', '复产', '涨价', '降价', '提价',
  ],
  // 中国政府 / 部门政策法规
  cn_policy: [
    '国务院', '国常会', '国务院办公厅', '发改委', '国家发展改革委', '工信部', '财政部',
    '央行', '中国人民银行', '人民银行', '证监会', '金融监管总局', '银保监', '商务部',
    '海关总署', '税务总局', '市场监管总局', '住建部', '交通运输部', '生态环境部',
    '农业农村部', '国家能源局', '外汇局', '国家外汇局', '国家统计局', '全国人大',
    '政治局', '中央经济工作会议', '十五五', '十四五', '国新办', '国资委',
    '管理条例', '实施细则', '征求意见稿', '反垄断', '反不正当竞争', '听证会',
    '专项债', '地方债', '特别国债', '财政政策', '货币政策', '财政贴息',
  ],
  // 美国政府 / 机构政策法规
  us_policy: [
    '美联储', 'FOMC', 'Fed', '鲍威尔', '白宫', '美国财政部', '美国商务部',
    '美国贸易代表', 'USTR', '美国国会', '参议院', '众议院', '特朗普', '贝森特',
    '美国证券交易委员会', '美国国务院', 'CFIUS', '301调查', '232调查',
    '出口管制', '实体清单', '关税', '制裁', '反倾销', '反补贴', '芯片法案',
    '通胀削减法案', '美国人工智能安全法案',
  ],
  // 地缘政治
  geopolitics: [
    '地缘', '冲突', '战争', '军事', '空袭', '无人机', '停火', '和谈', '会谈',
    '峰会', '封锁', '禁运', '俄乌', '俄罗斯', '乌克兰', '中东', '以色列', '伊朗',
    '加沙', '黎巴嫩', '叙利亚', '也门', '胡塞', '沙特', '台海', '南海', '朝鲜',
    '委内瑞拉', '外交', '元首互动',
  ],
  // 航道 / 航运
  shipping: [
    '航运', '海运', '港口', '码头', '集运', '集装箱', '运价', '船东', '油轮',
    '干散货', 'BDI', '波罗的海', '红海', '苏伊士', '巴拿马', '马六甲', '霍尔木兹',
    '好望角', '航线', '绕行', '拥堵', '船期', '集运欧线', '液化天然气船', 'LNG船',
  ],
  // 关键原材料 / 大宗商品 / 贵金属行情
  materials: [
    '原油', '布伦特', 'WTI', '天然气', '煤炭', '焦煤', '焦炭', '螺纹钢', '铁矿石',
    '铜', '铝', '锌', '铅', '镍', '锡', '锂', '碳酸锂', '稀土', '钨', '钼', '锑',
    '锗', '镓', '石墨', '多晶硅', '工业硅', '纯碱', '玻璃', '甲醇', 'PTA', '乙二醇',
    '苯乙烯', '沥青', '燃料油', '橡胶', '棕榈油', '豆粕', '豆一', '豆二', '玉米',
    '小麦', '白糖', '棉花', '生猪', '黄金', '白银', '铂', '钯', '铀', '钾肥',
    '磷矿', '萤石', '铝土矿', '铜精矿', '商品期货', '大宗商品', '现货升水',
    '商业库存', '港口库存', '伦铜', '沪铜', '金价', '油价',
    // 行情口径变体（实测漏杀：「纽约期银日内跌2%，现报67.27美元/盎司」）
    '期银', '期金', '沪银', '沪金', 'COMEX', '伦敦金', '现货黄金', '盎司',
    '成品油', '汽柴油', '原油期货', '国际油价', '伦铝', '伦镍', '伦锌',
  ],
  // 宏观 / 经济数据 / 汇率利率
  macro: [
    'GDP', 'CPI', 'PPI', 'PMI', '社融', 'M2', '信贷', '利率', '降息', '加息',
    '降准', 'LPR', '公开市场操作', '逆回购', 'MLF', '存款准备金', '汇率', '人民币',
    '国债收益率', '收益率', '非农', '失业率', '零售销售', '财政赤字', '外贸',
    '进出口', '出口', '进口', '经济数据', '库存系数', '国际收支', '外汇储备',
    '汇市', '外汇', '货币贬值', '美元走强', '美元走弱',
  ],
  // 产业 / 科技（与上市标的基本面直接相关）
  industry: [
    '半导体', '芯片', '晶圆', '光刻', '封装', '存储', '算力', '数据中心', '人工智能',
    '大模型', '光伏', '组件', '储能', '锂电', '动力电池', '新能源车', '乘用车',
    '汽车经销商', '军工', '航天', '航空', '创新药', '集采', 'CXO', '医疗器械',
    '白酒', '消费电子', '机器人', '低空经济', '核电', '风电', '电网', '特高压',
    '钢铁', '水泥', '化工', '化纤', '造纸', '养殖', '种业', '5G', '6G', '卫星',
    // 存储/算力/光模块产业链（实测漏杀：DeepSeek 新模型对 HBM/SSD 需求影响）
    'HBM', 'SSD', 'DRAM', 'NAND', '内存', '闪存', '光模块', 'CPO', '液冷',
    '覆铜板', '铜箔', 'PCB', 'MLCC', 'OpenAI', 'DeepSeek', 'Anthropic',
  ],
};

// 展会/论坛/座谈/培训 这类「活动通稿」不算快讯（见 cnwallstreet 抽样）
const JUNK_PATTERNS = [
  /博览会|展会|论坛将于|座谈会在|培训班|研讨会将于|会议将于/,
  /^\s*[^，。！？]{0,12}(要闻|动态|发布会|解读|汇总|归档)\s*$/,
  /现价\s*[\d.]+\s*[（(]/,            // 期货报价行，如「豆一2609 现价 5113 (+55%)」
];

const MIN_TITLE_LEN = 10;              // 过短的标题多为导航/标签页残留
const STOCK_CODE = /\b(?:0\d{5}|3\d{5}|6\d{5}|8\d{5}|4\d{5})\b/;  // A股/北交所 6 位代码
const US_TICKER = /(?:\$[A-Z]{1,5}\b|\((?:NASDAQ|NYSE|AMEX)\)|纳斯达克:\s*[A-Z]{1,5})/;

function envNum(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

const FILTER_OFF = /^(1|true|on|yes)$/i.test(String(process.env.NEWS_FILTER_OFF || ''));
const MIN_PER_SOURCE = envNum('NEWS_MIN_PER_SOURCE', 5);        // 每个活跃源保底条数
const MAX_SOURCE_RATIO = Number(process.env.NEWS_MAX_SOURCE_RATIO) || 0.45; // 单源占单页上限
const DEFAULT_MIN_PER_SOURCE = envNum('NEWS_DEFAULT_MIN_PER_SOURCE', 3); // 未在 SOURCE_PROFILE 里登记的源的保底
// 重要度置顶最多占一页的比例（其余仍是时间倒序，保证「快讯」的时间感）
const PIN_MAX_RATIO = Number(process.env.NEWS_PIN_MAX_RATIO) || 0.4;

// =====================================================
// 一·B、重要度打分（scoreItem）
//   只对「已通过相关性过滤」的条目打分；分数用于前端高亮 A股/美股 重点快讯。
//   dup_count 由 dedupeSimilar 产出，因此必须「先去重再打分」。
// =====================================================

/** 主题基础分（命中多个主题累加） */
export const THEME_POINTS = {
  a_stock: 5,
  us_stock: 5,
  cn_policy: 4,
  us_policy: 4,
  company_financials: 3,
  macro: 2,
  materials: 2,
  shipping: 2,
  geopolitics: 2,
  industry: 2,
  code: 4,
};

/** 主题 → UI 展示文案 */
const THEME_LABEL = {
  a_stock: 'A股',
  us_stock: '美股',
  cn_policy: '国内政策',
  us_policy: '美国政策',
  company_financials: '公司业绩',
  macro: '宏观',
  materials: '大宗商品',
  shipping: '航运',
  geopolitics: '地缘',
  industry: '产业',
};

/** 强信号词：出现任一即 +3（全条只计一次，不按出现次数叠加） */
export const STRONG_KEYWORDS = [
  '涨停', '跌停', '停牌', '复牌', '退市', '立案', '问询函', '重组', '并购', '要约',
  '减持', '增持', '回购', '业绩预告', '业绩快报', '财报', '美联储', '降息', '加息',
  '降准', 'FOMC', '关税', '制裁', '实体清单', '出口管制', '301调查', '英伟达', '苹果', '特斯拉',
];
const STRONG_POINTS = 3;
const ENTITY_POINTS = 3;     // 标题里出现 A股 6 位代码 / 美股 ticker
const HOLDING_POINTS = 6;    // 与持仓标的相关
const LEVEL_S = 14;          // >= 14 → S 重大
const LEVEL_A = 8;           // >= 8  → A 重要，否则 B 一般

// 统一的文本规范化（相关性判断用）：去空白/标点/标签符号，便于词表匹配
function normalizeForMatch(s) {
  return String(s || '')
    .replace(/[#＃]/g, '')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase();
}

// 去重用的规范化：先剥掉源名/时间戳等噪音外壳，再统一标点与大小写
function normalizeForDup(s) {
  return normalizeForMatch(stripNoise(String(s || '')))
    .replace(/[【】\[\]]/g, '')
    .replace(/[，。、；：！？,.;:!?…—\-–~～"'“”‘’()（）{}<>《》|/\\*+%$@&]/g, '');
}

/**
 * 去重用的「消息指纹」：剥掉各源自带的噪音外壳，只留下消息本身。
 *
 * 需要剥掉的噪音（同一条消息在不同源/不同时刻的唯一差异都来自这些）：
 * - 源名前缀：【金十数据】/【财经Daily】/【格隆汇】…
 * - 时间戳前缀：10:06:31 / 2026-09-13 09:40:11 —— 同一消息被滚动播报时只差时间
 * - 「金十数据9月14日讯，」这类导语
 * 剥掉后同一消息的指纹就趋同，containment 才能真正命中。
 */
function stripNoise(s) {
  return s
    // 源名括号壳（含「格隆汇」这类自有品牌）
    .replace(/^[【\[]?[^【\[\]】]{1,12}[】\]]/, '')
    // HH:MM 或 HH:MM:SS 前缀
    .replace(/^\d{1,2}:\d{2}(:\d{2})?/, '')
    // YYYY-MM-DD[ T]HH:MM[:SS] 前缀
    .replace(/^\d{4}-\d{2}-\d{2}[t ]?\d{1,2}:\d{2}(:\d{2})?/, '')
    // 「…讯，」导语
    .replace(/[^，。；]{1,10}(讯|报道|消息)[，,]/g, '')
    .trim();
}

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function containment(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const g of small) if (big.has(g)) inter++;
  return inter / small.size;
}

/**
 * 时间戳 → 本地日历日的整数序号（用于给去重比对做「相邻两天」分桶）。
 * 北京时区固定 +8，不依赖运行环境的 TZ。
 */
const CN_DAY_MS = 86400_000;
function localDayKey(ms) {
  const t = Number(ms) || 0;
  if (t <= 0) return 0;
  return Math.floor((t + 8 * 3600_000) / CN_DAY_MS);
}

/**
 * 相关性判断：命中任一主题词 / 股票代码 / 美股 ticker 即保留。
 * @returns {{keep: boolean, tags: string[]}}
 */
export function classify(item) {
  const title = String(item?.title || '');
  const text = normalizeForMatch(title + ' ' + String(item?.summary || '').slice(0, 120));
  const tags = [];

  if (STOCK_CODE.test(title) || US_TICKER.test(title)) tags.push('code');
  for (const [theme, words] of Object.entries(THEMES)) {
    for (const w of words) {
      if (text.includes(normalizeForMatch(w))) {
        tags.push(theme);
        break;
      }
    }
  }
  if (tags.length === 0) return { keep: false, tags };

  // 明确的活动通稿/报价行，即便命中主题词也不当作快讯
  for (const re of JUNK_PATTERNS) {
    if (re.test(title)) return { keep: false, tags: [...tags, 'junk'] };
  }
  return { keep: true, tags: [...new Set(tags)] };
}

/** 过于简短的标题（导航/标签残留）单独判断，避免误杀「伦铜库存减少1075吨」这类短讯 */
function tooShort(title, tags) {
  if (tags.includes('code')) return false;
  const compact = normalizeForMatch(title).replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  return compact.length < MIN_TITLE_LEN;
}

/** 相关性过滤：返回保留项（带 tags），并给出丢弃统计 */
export function applyRelevance(items) {
  const kept = [];
  const dropped = [];
  for (const it of items) {
    const { keep, tags } = classify(it);
    if (!keep || tooShort(it.title, tags)) {
      dropped.push(it.title);
      continue;
    }
    kept.push({ ...it, tags });
  }
  return { kept, dropped };
}

/**
 * 重要度打分。必须在 dedupeSimilar 之后调用，才能读到 dup_count。
 *
 * 规则（顺序即优先级无关，纯累加）：
 *   主题基础分（THEME_POINTS，多主题累加） + 强信号词（+3，全条只计一次）
 *   + 标题内标的实体（A股代码/美股 ticker，+3）
 *   + 多源共振（dup_count>=3 → +4；==2 → +2；同一条消息被多家源报，本身就是重要性信号）
 *   + 持仓相关（opts.holding_codes 命中 → +6）
 *   + 时效（30 分钟内 +2 / 2 小时内 +1）
 *
 * @param {object} item 快讯条目（需要 title/summary/published_at/dup_count）
 * @param {string[]} tags classify() 产出的主题标签
 * @param {{holding_codes?: string[], now?: number}} opts
 * @returns {{score: number, level: 'S'|'A'|'B', level_label: string, reasons: string[]}}
 */
export function scoreItem(item, tags, opts = {}) {
  const tagList = Array.isArray(tags) ? tags : [];
  const title = String(item?.title || '');
  const summary = String(item?.summary || '');
  const text = normalizeForMatch(title + ' ' + summary.slice(0, 120));
  const reasons = [];
  let score = 0;

  // 1) 主题基础分 + 主题标签文案
  for (const [theme, points] of Object.entries(THEME_POINTS)) {
    if (!tagList.includes(theme)) continue;
    score += points;
    if (THEME_LABEL[theme]) reasons.push(THEME_LABEL[theme]);
  }

  // 2) 强信号词（命中任一 +3，只计一次）
  if (STRONG_KEYWORDS.some((w) => text.includes(normalizeForMatch(w)))) {
    score += STRONG_POINTS;
    reasons.push('强信号');
  }

  // 3) 标题里的标的实体（复用相关性用的代码正则）
  if (STOCK_CODE.test(title) || US_TICKER.test(title)) {
    score += ENTITY_POINTS;
    reasons.push('标的代码');
  }

  // 4) 多源共振
  const dup = Number(item?.dup_count) || 1;
  if (dup >= 3) {
    score += 4;
    reasons.push(`多源×${dup}`);
  } else if (dup === 2) {
    score += 2;
    reasons.push('多源×2');
  }

  // 5) 持仓相关
  const holdingCodes = Array.isArray(opts.holding_codes) ? opts.holding_codes : [];
  if (holdingCodes.length > 0) {
    const hit = holdingCodes.some((c) => {
      const code = String(c || '').trim();
      return code.length > 0 && (title.includes(code) || summary.includes(code));
    });
    if (hit) {
      score += HOLDING_POINTS;
      reasons.push('持仓相关');
    }
  }

  // 6) 时效
  const now = Number(opts.now) || Date.now();
  const publishedAt = Number(item?.published_at) || 0;
  if (publishedAt > 0) {
    const age = now - publishedAt;
    if (age >= 0 && age <= 30 * 60_000) {
      score += 2;
      reasons.push('刚刚');
    } else if (age > 0 && age <= 2 * 3600_000) {
      score += 1;
      reasons.push('近期');
    }
  }

  const level = score >= LEVEL_S ? 'S' : score >= LEVEL_A ? 'A' : 'B';
  const level_label = level === 'S' ? '重大' : level === 'A' ? '重要' : '一般';
  return { score, level, level_label, reasons };
}

/** 批量打分：给每条快讯挂上 score/level/level_label/reasons（原地返回新数组） */
export function scoreAll(items, opts = {}) {
  return items.map((it) => ({ ...it, ...scoreItem(it, it.tags || [], opts) }));
}

/**
 * 近似去重：跨源同一消息只留一条（保留时间最新者），并在 also_in 里标出其它来源。
 * 三条判定（任一命中即视为同一条）：
 *   1. 规范化后完全相同；
 *   2. (bigram 包含度 ≥ 0.85 且双方长度 ≥ 12 且长度比 ≥ 0.5) —— 用于长度接近的改写；
 *   3. bigram 包含度 ≥ 0.9 且较短方长度 ≥ 12 —— 不要求长度比，用于
 *      「金十数据只有标题（20 字）vs 新浪 7×24 带正文全文（100 字）」这类
 *      一方完整包含在另一方里的情况（旧规则因长度比 0.2 < 0.5 而漏合并）。
 * 注意：绝不做「前缀相同即重复」的判定——「欧洲央行行长拉加德：…」类同前缀不同事件会被误杀。
 */
const DUP_CONTAIN_HIGH = 0.9;    // 高包含度阈值（不看长度比）
const DUP_CONTAIN_LOW = 0.85;    // 常规包含度阈值（需配合长度比）
const DUP_MIN_LEN = 12;          // 参与包含度判定的最短规范化长度
const DUP_LEN_RATIO = 0.5;       // 常规判定的最短/最长长度比要求

export function dedupeSimilar(items) {
  const out = [];
  const keys = [];   // { norm, grams }
  const keyDay = []; // 与 keys 同序的「本地日历日」分桶键，见下方 DAY_BUCKET_MS
  let merged = 0;

  for (const it of items) {
    const norm = normalizeForDup(it.title);
    if (!norm) { out.push(it); continue; }
    const grams = bigrams(norm);
    const day = localDayKey(it.published_at);
    const buckets = [day, day - 1];   // 跨午夜的同一条消息也能合并

    let hit = -1;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      // 只在相邻两天内比对：快讯流窗口是 24h，跨天比对既无收益又会让 500+ 条的
      // 两两 bigram 比对变成 O(n²) 热点（实测去重是 shapeNewsFeed 里最慢的一步）。
      if (!buckets.includes(keyDay[i])) continue;
      if (k.norm === norm) { hit = i; break; }
      const minLen = Math.min(norm.length, k.norm.length);
      if (minLen < DUP_MIN_LEN) continue;                       // 太短不做包含度判定
      const ratio = minLen / Math.max(norm.length, k.norm.length);
      const c = containment(grams, k.grams);
      if (c >= DUP_CONTAIN_HIGH) { hit = i; break; }            // 规则 3：真包含，不看长度比
      if (ratio >= DUP_LEN_RATIO && c >= DUP_CONTAIN_LOW) { hit = i; break; } // 规则 2
    }

    if (hit === -1) {
      keys.push({ norm, grams });
      keyDay.push(day);
      out.push(it);
      continue;
    }
    // 命中重复：保留先出现者（调用方已按时间倒序），记录「同一消息还出现在哪些源」
    const keep = out[hit];
    const other = it.source_name || it.source_channel;
    if (other !== (keep.source_name || keep.source_channel)) {
      const alsoIn = new Set(keep.also_in || []);
      alsoIn.add(other);
      keep.also_in = [...alsoIn];
    }
    keep.dup_count = (keep.dup_count || 1) + 1;
    merged++;
  }
  return { items: out, merged };
}

/**
 * 每源配额档位（按实测占比定：sina_724 51% / jin10data 21% 必须压最狠，
 * 否则整页被单一源刷满；低频高价值源给保底 5 条，避免被时间倒序挤光）。
 * 未登记的源（macro_* / eastmoney_* 等）走 DEFAULT_PROFILE：保底 3 条 + 单源 ≤45%。
 */
export const SOURCE_PROFILE = {
  // 高频源：压得最狠（占比上限 25%），但也要有保底，否则会被自家高频刷掉后一页全空
  sina_724: { minPerSource: 5, maxRatio: 0.25 },
  jin10data: { minPerSource: 5, maxRatio: 0.25 },
  cnwallstreet: { minPerSource: 5, maxRatio: 0.35 },
  ywcqdz: { minPerSource: 5, maxRatio: 0.35 },
  FinanceNewsDaily: { minPerSource: 5, maxRatio: 0.35 },
  cai_lian_she_1: { minPerSource: 5, maxRatio: 0.35 },
};

const DEFAULT_PROFILE = {
  minPerSource: DEFAULT_MIN_PER_SOURCE,
  maxRatio: MAX_SOURCE_RATIO,
};

/**
 * 取某个频道的配额档位（与默认值合并）。
 * @param {string} channel source_channel
 * @returns {{minPerSource: number, maxRatio: number}}
 */
export function getProfile(channel) {
  const p = SOURCE_PROFILE[channel];
  return {
    minPerSource: Number(p?.minPerSource) > 0 ? Number(p.minPerSource) : DEFAULT_PROFILE.minPerSource,
    maxRatio: Number(p?.maxRatio) > 0 ? Number(p.maxRatio) : DEFAULT_PROFILE.maxRatio,
  };
}

/**
 * 每源配额：先给每个活跃源保底（各自 minPerSource，保证低频源不被挤掉），
 * 再按时间倒序补满，但单源不超过该源自己的 cap = max(保底, ceil(limit*maxRatio))。
 * 入参需已按 published_at 倒序。
 */
export function applySourceQuota(items, { limit = 30, minPerSource = MIN_PER_SOURCE, maxRatio = MAX_SOURCE_RATIO } = {}) {
  if (items.length <= limit) return { items, quotaApplied: 0 };
  const picked = new Set();
  const count = new Map();

  // 每个频道的保底/上限：显式入参 minPerSource/maxRatio 作为「未登记频道」的兜底
  const fallbackFloor = Number(minPerSource) > 0 ? Number(minPerSource) : DEFAULT_PROFILE.minPerSource;
  const fallbackRatio = Number(maxRatio) > 0 ? Number(maxRatio) : DEFAULT_PROFILE.maxRatio;
  const floorOf = (ch) => (SOURCE_PROFILE[ch] ? getProfile(ch).minPerSource : fallbackFloor);
  const capOf = (ch) => {
    const p = SOURCE_PROFILE[ch] ? getProfile(ch) : { minPerSource: fallbackFloor, maxRatio: fallbackRatio };
    return Math.max(p.minPerSource, Math.ceil(limit * p.maxRatio));
  };

  const take = (it, i) => {
    picked.add(i);
    count.set(it.source_channel, (count.get(it.source_channel) || 0) + 1);
  };

  // 第一轮：保底（各源按自身档位）
  for (let i = 0; i < items.length && picked.size < limit; i++) {
    const ch = items[i].source_channel;
    if ((count.get(ch) || 0) < floorOf(ch)) take(items[i], i);
  }
  // 第二轮：按时间倒序补满（受该源自己的单源上限约束）
  for (let i = 0; i < items.length && picked.size < limit; i++) {
    if (picked.has(i)) continue;
    const ch = items[i].source_channel;
    if ((count.get(ch) || 0) >= capOf(ch)) continue;
    take(items[i], i);
  }
  // 第三轮：仍不满（源太少/上限太紧）则无视上限补满
  for (let i = 0; i < items.length && picked.size < limit; i++) {
    if (!picked.has(i)) take(items[i], i);
  }

  const ordered = [...picked].sort((a, b) => a - b).map((i) => items[i]);
  return { items: ordered, quotaApplied: 1 };
}

/**
 * 重要度优先排序：高分置顶 + O(n) 时间保序。
 *
 * 为什么不用「按 score 全量排序」：那会把 2 分的旧闻顶到 7 分的新消息前面，
 * 整个流会失去时间感。这里只把「达到 PIN_MIN_SCORE 的少数重点」提到最前
 * （组内仍按分数、再按时间），其余保持原有时间倒序。
 *
 * 另加两条护栏：
 * - 全量排序时对「同源」做 -0.5 微惩罚，避免同一家媒体刷满置顶区；
 * - 置顶数不超过 limit 的 PIN_MAX_RATIO，保证时间流仍然是主体。
 *
 * @param {Array} items 已打分（含 score / level / source_channel / published_at）
 * @param {{limit?: number, pinMinScore?: number, pinMaxRatio?: number}} opts
 */
export function rankByImportance(items, { limit = 30, pinMinScore = LEVEL_A, pinMaxRatio = PIN_MAX_RATIO } = {}) {
  if (!Array.isArray(items) || items.length <= 1) return items;
  const pinCap = Math.max(1, Math.ceil(limit * pinMaxRatio));

  // 先按原始分数粗排候选，再在候选内部做同源微惩罚。
  // 注意必须在「候选集内」计数：若在全池计数，同一源靠前的高分条目会把后面
  // 同源条目压过头，最终置顶区内部反而出现分数倒挂。
  const cand = [];
  for (let idx = 0; idx < items.length; idx++) {
    if ((Number(items[idx].score) || 0) >= pinMinScore) cand.push({ it: items[idx], idx });
  }
  cand.sort((a, b) => (Number(b.it.score) || 0) - (Number(a.it.score) || 0) || (Number(b.it.published_at) || 0) - (Number(a.it.published_at) || 0) || a.idx - b.idx);

  const srcSeen = new Map();
  const effOf = new Map();
  for (const c of cand) {
    const n = srcSeen.get(c.it.source_channel) || 0;
    srcSeen.set(c.it.source_channel, n + 1);
    c.eff = (Number(c.it.score) || 0) - n * 0.5;
    effOf.set(c, c.eff);
  }
  cand.sort((a, b) => b.eff - a.eff || (Number(b.it.published_at) || 0) - (Number(a.it.published_at) || 0) || a.idx - b.idx);

  const chosen = cand.slice(0, pinCap);
  if (chosen.length === 0) return items;
  const pinned = new Set(chosen.map((c) => c.idx));
  return [...chosen.map((c) => ({ ...c.it, pinned: true })), ...items.filter((_, i) => !pinned.has(i))];
}

/**
 * 完整流水线：相关性 → 去重 → 配额 → 截断 → 打分 → 重要度置顶。
 * 入参需已按时间倒序。打分放最后：scoreItem 依赖去重产出的 dup_count（多源共振是正向信号）。
 * filter=false（?raw=1 / NEWS_FILTER_OFF=1）时不做打分，score 等字段为 undefined。
 */
export function shapeNewsFeed(rows, { limit = 30, filter = true, holding_codes = null } = {}) {
  const raw = rows.length;
  if (!filter || FILTER_OFF) {
    // 原始流：不打分、不补字段，保持旧行为便于对账
    return { items: rows.slice(0, limit), stats: { raw, kept: rows.length, filtered: 0, merged: 0, quota: 0, filter_off: true } };
  }
  const { kept, dropped } = applyRelevance(rows);
  const { items: deduped, merged } = dedupeSimilar(kept);
  const { items: final, quotaApplied } = applySourceQuota(deduped, { limit });
  const scored = scoreAll(final, { holding_codes });
  const ranked = rankByImportance(scored, { limit });
  const pinnedCount = ranked.reduce((n, it) => n + (it.pinned ? 1 : 0), 0);
  return {
    items: ranked,
    stats: {
      raw,
      kept: kept.length,
      filtered: dropped.length,
      merged,
      quota: quotaApplied,
      pinned: pinnedCount,
      dropped_samples: dropped.slice(0, 8),
    },
  };
}

export const RELEVANCE_THEMES = Object.keys(THEMES);
