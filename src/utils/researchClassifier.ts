// src/utils/researchClassifier.ts
// 先进生产力行业识别（前端版本，跟 server 端 research-report.ts 保持一致）
// 用于：研报列表的"⭐ 推荐"徽章
export const ADVANCED_PRODUCTIVITY_KEYWORDS: { category: string; keywords: string[] }[] = [
  { category: '半导体', keywords: ['半导体', '芯片', '集成电路', 'IC设计', '晶圆', 'wafer', 'semiconductor', 'chip', 'fab', '光刻机', 'ASML', 'TSMC', '台积电', '中芯国际', 'GPU', 'AI芯片', '存储芯片', 'DRAM', 'NAND', '设备厂', '封测', 'EDA', 'IP授权'] },
  { category: '生物制药', keywords: ['生物制药', '生物药', '抗体', 'ADC', 'PD-1', 'PD-L1', 'CAR-T', '基因', 'mRNA', '疫苗', '单抗', '双抗', 'GLP-1', '减肥药', '肿瘤', '靶向', 'biotech', 'pharma', 'biopharma', 'CRO', 'CDMO', '创新医疗器械', '创新药'] },
  { category: '新能源', keywords: ['新能源', '锂电', '锂电池', '动力电池', '储能', '光伏', '太阳能', '风电', '氢能', '氢燃料', '固态电池', '钠离子', '碳酸锂', '正极材料', '负极材料', '电解液', '隔膜', 'EV', 'electric vehicle', 'battery', 'solar', 'wind', 'hydrogen', '动储', '锂矿', '锂盐'] },
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
