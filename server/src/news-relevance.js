// news-relevance.js — 财经快讯「相关性过滤 + 近似去重 + 每源配额」
//
// 背景（Gray 2026-09-10 提出）：
//   1) 新浪/华尔街见闻/Jin10 等源大量重复同一条消息，快讯流里看着像刷屏；
//   2) 一批与「A股标的 / 美股标的 / 中美政府政策法规 / 地缘政治 / 航道 / 关键原材料」
//      无关的社会、娱乐、体育、地方事务新闻混在流里；
//   3) 低频源（格隆汇约 20 条/日）被高频源（新浪约 2000 条/日）按时间倒序挤出窗口。
//
// 处理顺序（在读取层做，不删数据，便于随时调参回溯）：
//   applyRelevance → dedupeSimilar → applySourceQuota → slice(limit)
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

// 统一的文本规范化（相关性判断用）：去空白/标点/标签符号，便于词表匹配
function normalizeForMatch(s) {
  return String(s || '')
    .replace(/[#＃]/g, '')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase();
}

// 去重用的规范化：额外剥掉「前导时间戳」和「【】」外壳
function normalizeForDup(s) {
  return normalizeForMatch(s)
    .replace(/^\d{4}-\d{2}-\d{2}[t ]?\d{2}:\d{2}(:\d{2})?/, '')
    .replace(/[【】\[\]]/g, '')
    .replace(/[，。、；：！？,.;:!?…—\-–~～"'“”‘’()（）{}<>《》|/\\*+%$@&]/g, '');
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
 * 近似去重：跨源同一消息只留一条（保留时间最新者），并在 also_in 里标出其它来源。
 * 判定：规范化后完全相同，或 (bigram 包含度 ≥ 0.85 且双方长度 ≥ 12)。后者用于
 * 「新浪带正文全文 vs 华尔街见闻只取标题」这种一方是另一方子串的情况。
 */
export function dedupeSimilar(items) {
  const out = [];
  const keys = [];   // { norm, grams }
  let merged = 0;

  for (const it of items) {
    const norm = normalizeForDup(it.title);
    if (!norm) { out.push(it); continue; }
    const grams = bigrams(norm);

    let hit = -1;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.norm === norm) { hit = i; break; }
      if (norm.length >= 12 && k.norm.length >= 12 &&
          Math.min(norm.length, k.norm.length) / Math.max(norm.length, k.norm.length) >= 0.5 &&
          containment(grams, k.grams) >= 0.85) { hit = i; break; }
    }

    if (hit === -1) {
      keys.push({ norm, grams });
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
 * 每源配额：先给每个活跃源保底 MIN_PER_SOURCE 条（保证低频源不被挤掉），
 * 再按时间倒序补满，但单源不超过 ceil(limit * MAX_SOURCE_RATIO)。
 * 入参需已按 published_at 倒序。
 */
export function applySourceQuota(items, { limit = 30, minPerSource = MIN_PER_SOURCE, maxRatio = MAX_SOURCE_RATIO } = {}) {
  if (items.length <= limit) return { items, quotaApplied: 0 };
  const cap = Math.max(minPerSource, Math.ceil(limit * maxRatio));
  const picked = new Set();
  const count = new Map();

  const take = (it, i) => {
    picked.add(i);
    count.set(it.source_channel, (count.get(it.source_channel) || 0) + 1);
  };

  // 第一轮：保底
  for (let i = 0; i < items.length && picked.size < limit; i++) {
    const ch = items[i].source_channel;
    if ((count.get(ch) || 0) < minPerSource) take(items[i], i);
  }
  // 第二轮：按时间倒序补满（受单源上限约束）
  for (let i = 0; i < items.length && picked.size < limit; i++) {
    if (picked.has(i)) continue;
    const ch = items[i].source_channel;
    if ((count.get(ch) || 0) >= cap) continue;
    take(items[i], i);
  }
  // 第三轮：仍不满（源太少/上限太紧）则无视上限补满
  for (let i = 0; i < items.length && picked.size < limit; i++) {
    if (!picked.has(i)) take(items[i], i);
  }

  const ordered = [...picked].sort((a, b) => a - b).map((i) => items[i]);
  return { items: ordered, quotaApplied: 1 };
}

/** 完整流水线：相关性 → 去重 → 配额 → 截断。入参需已按时间倒序。 */
export function shapeNewsFeed(rows, { limit = 30, filter = true } = {}) {
  const raw = rows.length;
  if (!filter || FILTER_OFF) {
    return { items: rows.slice(0, limit), stats: { raw, kept: rows.length, filtered: 0, merged: 0, quota: 0, filter_off: true } };
  }
  const { kept, dropped } = applyRelevance(rows);
  const { items: deduped, merged } = dedupeSimilar(kept);
  const { items: final, quotaApplied } = applySourceQuota(deduped, { limit });
  return {
    items: final,
    stats: {
      raw,
      kept: kept.length,
      filtered: dropped.length,
      merged,
      quota: quotaApplied,
      dropped_samples: dropped.slice(0, 8),
    },
  };
}

export const RELEVANCE_THEMES = Object.keys(THEMES);
