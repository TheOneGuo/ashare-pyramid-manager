// holding-profiles.ts
// 持仓产业链画像：每个持仓配置「间接关联关键词」，用于从宏观/地缘/商品/政策新闻中
// 反查相关性（政策/地缘/商品新闻通常不出现股票名，只能靠产业链关键词命中）。
//
// 14 类关联维度映射到关键词组：
//   - 公告/个股新闻      → 直接关联（代码命中，由 collector 处理，不在此列）
//   - 分红              → dividendKw
//   - 并购/收购          → maKw
//   - 订单/合同          → orderKw
//   - 客户认证          → certKw
//   - 上游原材料价格/供给 → rawMatKw（商品期货/现货关键词）
//   - 产品市场价格       → productKw
//   - 航道/禁航/禁运     → geoKw（地缘）
//   - 海外同类标的新闻    → overseasKw（海外公司/对手）
//   - 海外政策(关税/汇率/利息/进出口) → policyOverseasKw
//   - 国内行业政策法规    → policyDomesticKw
//   - 上游产地/运输      → transportKw
//
// 注意：这是静态知识库，生产环境应可编辑（DB 表 holding_profiles）。
// 关键词命中采用「标题/正文包含任一关键词」即视为相关。

export interface HoldingProfile {
  stock_code: string;
  short_name: string;
  // 行业
  industry: string;
  // 上游原材料（用于商品/供给新闻）
  raw_materials: string[];
  // 主营产品（用于产品价格新闻）
  products: string[];
  // 主要客户（用于客户/订单新闻）
  customers: string[];
  // 海外可比公司（用于海外同类标的/对手新闻）
  overseas_peers: string[];
  // 政策域（国内行业政策）
  policy_domains: string[];
  // 运输/航道/产地（地缘禁航）
  transport: string[];
  // 额外自定义关键词（分红/并购/订单等事件型）
  extra_keywords: string[];
}

// 全局通用关键词（任何持仓都可能相关）
const GLOBAL_KW = ['A股', '股市', '证监会', '央行', '降准', '降息', '印花税', '北向资金', '融资融券'];

export const HOLDING_PROFILES: HoldingProfile[] = [
  {
    stock_code: '600519',
    short_name: '贵州茅台',
    industry: '白酒',
    raw_materials: ['高粱', '小麦', '白酒', '茅台', '酱香'],
    products: ['白酒', '茅台', '飞天茅台', '茅台酒'],
    customers: ['经销商', '电商', 'i茅台'],
    overseas_peers: ['Diageo', '帝亚吉欧', 'Pernod', '保乐力加', 'Ricard'],
    policy_domains: ['白酒消费税', '消费税', '食品监管', '白酒行业'],
    transport: ['赤水河', '贵州', '川黔', '航运', '运价', '禁运'],
    extra_keywords: ['茅台分红', '茅台收购', '茅台订单', '茅台提价', '白酒消费税', '禁酒令', 'BDI'],
  },
  {
    stock_code: '000858',
    short_name: '五粮液',
    industry: '白酒',
    raw_materials: ['高粱', '小麦', '白酒', '五粮液', '浓香'],
    products: ['白酒', '五粮液', '第八代五粮液'],
    customers: ['经销商', '电商'],
    overseas_peers: ['Diageo', '帝亚吉欧', 'Pernod', '保乐力加'],
    policy_domains: ['白酒消费税', '消费税', '白酒行业'],
    transport: ['宜宾', '四川', '航运', '运价', '禁运'],
    extra_keywords: ['五粮液分红', '五粮液提价', '白酒消费税'],
  },
  {
    stock_code: '600036',
    short_name: '招商银行',
    industry: '银行',
    raw_materials: ['利率', 'LPR', '国债'],
    products: ['零售银行', '财富管理', '按揭', '信用卡'],
    customers: ['企业客户', '零售客户'],
    overseas_peers: ['HSBC', '汇丰', 'JPMorgan', '摩根大通', 'Citigroup', '花旗'],
    policy_domains: ['货币政策', '房贷政策', '金融监管', '银行业', '房地产金融', '证监会', '银保监'],
    transport: ['航运', '运价', '禁运'],
    extra_keywords: ['招商银行分红', '银行息差', '降准', '降息', '房贷', '存款利率'],
  },
  {
    stock_code: '300750',
    short_name: '宁德时代',
    industry: '动力电池',
    raw_materials: ['锂', '碳酸锂', '镍', '钴', '正极材料', '电解液', '隔膜', '锂电池'],
    products: ['动力电池', '储能', '电池', '麒麟电池', '神行电池'],
    customers: ['特斯拉', '蔚来', '理想', '小鹏', '宝马', '奔驰', '大众'],
    overseas_peers: ['LG', '松下', 'Panasonic', '三星SDI', 'BYD', '比亚迪', 'CATL'],
    policy_domains: ['新能源政策', '动力电池', '储能政策', '新能源车', '补贴退坡', '反倾销'],
    transport: ['锂矿', '智利', '澳洲', '印尼', '盐湖', '航运', '运价', '禁运'],
    extra_keywords: ['宁德时代订单', '宁德时代分红', '宁德时代海外', '碳酸锂价格', '锂价', '电池反倾销', 'BDI'],
  },
  {
    stock_code: '601318',
    short_name: '中国平安',
    industry: '保险',
    raw_materials: ['利率', '国债收益率', '权益市场'],
    products: ['寿险', '财险', '健康险', '银行', '资管'],
    customers: ['个人客户', '企业客户'],
    overseas_peers: ['AIA', '友邦', 'Prudential', '保诚', 'PingAn'],
    policy_domains: ['保险监管', '偿二代', '寿险改革', '金融监管', '证监会', '银保监'],
    transport: ['航运', '运价', '禁运'],
    extra_keywords: ['中国平安分红', '平安回购', '险资举牌', '降准', '降息'],
  },
];

// 所有画像关键词 → 用于间接匹配
export function buildProfileKeywords(profiles: HoldingProfile[]): { code: string; name: string; keywords: string[] }[] {
  return profiles.map((p) => {
    const kw = new Set<string>([
      p.short_name,
      p.industry,
      ...p.raw_materials,
      ...p.products,
      ...p.customers,
      ...p.overseas_peers,
      ...p.policy_domains,
      ...p.transport,
      ...p.extra_keywords,
      ...GLOBAL_KW,
    ]);
    return { code: p.stock_code, name: p.short_name, keywords: [...kw] };
  });
}

// 判断一条新闻文本是否命中某持仓画像
export function matchHoldingProfile(text: string, profiles: HoldingProfile[]): { code: string; name: string; hit: string[] }[] {
  const lower = text.toLowerCase();
  const result: { code: string; name: string; hit: string[] }[] = [];
  for (const p of profiles) {
    const kws = buildProfileKeywords([p])[0].keywords;
    const hit = kws.filter((k) => k && lower.includes(k.toLowerCase()));
    if (hit.length > 0) result.push({ code: p.stock_code, name: p.short_name, hit });
  }
  return result;
}
