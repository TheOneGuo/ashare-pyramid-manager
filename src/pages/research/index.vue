<template>
  <view class="rs-page" :class="{ 'h5-mode': isH5 }">
    <TabBarComp v-if="isH5" />
    <!-- 固定在顶部的 head 区：标题 + 两个子 tab -->
    <view class="rs-head">
      <view class="rs-header">
        <text class="rs-title">AI 研报</text>
        <text class="rs-meta">全部研报 AI 精读 · 我的持仓研报</text>
      </view>

      <view class="rs-tabbar">
        <view class="rs-tab" :class="{ 'rs-tab--active': tab === 'all' }" @tap="onSwitchTab('all')">
          <text>全部研报 AI 精读</text>
        </view>
        <view class="rs-tab" :class="{ 'rs-tab--active': tab === 'mine' }" @tap="onSwitchTab('mine')">
          <text>我的持仓研报</text>
        </view>
      </view>
    </view>

    <!-- 可滚动内容区 -->
    <view class="rs-body">
      <!-- ============================================================ -->
      <!-- Tab 1：全部研报 AI 精读 -->
      <!-- ============================================================ -->
      <view v-if="tab === 'all'" class="rs-pane">
        <view v-if="allLoading && allItems.length === 0" class="rs-empty"><text>正在加载研报列表…</text></view>
        <view v-else-if="allItems.length === 0" class="rs-empty"><text>暂无研报</text></view>

        <view v-for="r in allItems" :key="r.reportId" class="rs-card rs-report-card" @tap="onAllClickRow(r)">
          <view class="rs-report-head">
            <view class="rs-report-head-main">
              <view class="rs-report-title-row">
                <text class="rs-report-title">{{ r.title }}</text>
                <text v-if="r.recommended" class="rs-rec-badge">⭐ 推荐</text>
              </view>
              <view class="rs-fx-row-meta">
                <text class="rs-fx-org">{{ r.broker || r.orgName }}</text>
                <text class="rs-fx-date">{{ r.pubDate }}</text>
                <text v-if="r.pageNum" class="rs-fx-pages">· {{ r.pageNum }} 页</text>
                <text v-if="r.categories && r.categories.length" class="rs-fx-pages">· {{ r.categories.join(' / ') }}</text>
              </view>
            </view>
            <text class="rs-report-chevron">▸</text>
          </view>
        </view>

        <!-- 底部筛选条：日期 + 机构（一行展示） -->
        <view class="rs-filter-bar">
          <view class="rs-filter-row">
            <text class="rs-filter-label">筛选日期</text>
            <scroll-view scroll-x class="rs-filter-scroll" show-scrollbar="false">
              <view class="rs-filter-pills">
                <view
                  v-for="t in ALL_DATE_RANGES"
                  :key="t.value"
                  class="rs-fx-time-pill"
                  :class="{ active: allDateRange === t.value }"
                  @tap="onAllDateChange(t.value)"
                >
                  <text>{{ t.label }} ({{ allCounts.byDate[t.value] || 0 }})</text>
                </view>
              </view>
            </scroll-view>
          </view>
          <view class="rs-filter-row">
            <text class="rs-filter-label">筛选机构</text>
            <scroll-view scroll-x class="rs-filter-scroll" show-scrollbar="false">
              <view class="rs-filter-pills">
                <view
                  class="rs-fx-time-pill"
                  :class="{ active: !allBroker }"
                  @tap="onAllBrokerChange('')"
                >
                  <text>全部 ({{ allCounts.total }})</text>
                </view>
                <view
                  v-for="b in allBrokers"
                  :key="b"
                  class="rs-fx-time-pill"
                  :class="{ active: allBroker === b }"
                  @tap="onAllBrokerChange(b)"
                >
                  <text>{{ b }} ({{ allCounts.byBroker[b] || 0 }})</text>
                </view>
              </view>
            </scroll-view>
          </view>
        </view>
      </view>

      <!-- ============================================================ -->
      <!-- Tab 2：我的持仓研报 -->
      <!-- ============================================================ -->
      <view v-if="tab === 'mine'" class="rs-pane">
        <view class="rs-card">
          <text class="rs-section-title">持仓标的研报</text>
          <text class="rs-note rs-note--muted">为持仓自动拉取卖方研报（高盛/摩根/瑞银/华泰/中金 等 30+ 家）。默认显示最近 1 个月，列表自动加载；点击查看研报可下载或打开 PDF / MD 原文。涉及先进生产力行业的研报标⭐推荐。</text>
          <view class="rs-actions">
            <view class="rs-btn rs-btn--primary" hover-class="rs-btn--hover" @tap="onMineLoad(true)" :class="{ 'rs-btn--loading': mineLoading }">
              <text>{{ mineLoading ? '拉取中…' : '📊 为持仓搜卖方' }}</text>
            </view>
          </view>
        </view>

        <view v-if="mineLoading && mineItems.length === 0" class="rs-empty"><text>正在拉取持仓相关研报…</text></view>
        <view v-else-if="mineItems.length === 0 && mineLoaded" class="rs-empty"><text>暂无持仓相关研报</text></view>
        <view v-else-if="!mineLoaded" class="rs-empty"><text>首次进入自动加载中…</text></view>

        <view v-for="r in mineItems" :key="r.key" class="rs-card rs-report-card">
          <view class="rs-report-head" @tap="onMineToggleExpand(r)">
            <view class="rs-report-head-main">
              <view class="rs-report-title-row">
                <text class="rs-report-title">{{ r.title }}</text>
                <text v-if="r.recommended" class="rs-rec-badge">⭐ 推荐</text>
              </view>
              <view class="rs-fx-row-meta">
                <text class="rs-fx-org">{{ r.broker || r.orgName }}</text>
                <text class="rs-fx-date">{{ r.pubDate }}</text>
                <text v-if="r.holdingCode" class="rs-fx-pages">· 关联 {{ r.holdingName || r.holdingCode }}</text>
                <text v-if="r.categories && r.categories.length" class="rs-fx-pages">· {{ r.categories.join(' / ') }}</text>
              </view>
            </view>
            <text class="rs-report-chevron">{{ mineExpanded.has(r.key) ? '▾' : '▸' }}</text>
          </view>

          <view v-if="mineExpanded.has(r.key)" class="rs-report-body">
            <view v-if="mineIngestedMap[r.key]" class="rs-tldr">
              <text class="rs-tldr-label">✦ 一句话精读</text>
              <text class="rs-tldr-body">{{ mineIngestedMap[r.key].tldr }}</text>
            </view>
            <view v-else class="rs-tldr" style="opacity:0.7">
              <text class="rs-tldr-label">✦ AI 精读</text>
              <text class="rs-tldr-body">点下方「一键 AI 精读」下载 PDF + 提炼关键信息</text>
            </view>

            <view v-if="mineIngestedMap[r.key]?.key_points?.length" class="rs-block">
              <text class="rs-block-label">📌 核心观点（关键信息）</text>
              <view v-for="(p, i) in mineIngestedMap[r.key].key_points" :key="i" class="rs-li"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
            </view>
            <view v-if="mineIngestedMap[r.key]?.opportunities?.length" class="rs-block">
              <text class="rs-block-label">💡 产生的影响 / 新机会</text>
              <view v-for="(p, i) in mineIngestedMap[r.key].opportunities" :key="i" class="rs-li"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
            </view>
            <view v-if="mineIngestedMap[r.key]?.risks?.length" class="rs-block">
              <text class="rs-block-label rs-block-label--risk">⚠️ 风险点</text>
              <view v-for="(p, i) in mineIngestedMap[r.key].risks" :key="i" class="rs-li rs-li--risk"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
            </view>

            <view class="rs-actions">
              <view class="rs-btn rs-btn--primary" hover-class="rs-btn--hover" :class="{ 'rs-btn--loading': mineIngesting === r.key }" @tap.stop="onMineIngest(r)">
                <text>{{ mineIngesting === r.key ? 'AI 精读中…' : (mineIngestedMap[r.key] ? '🔄 重读研报' : '✦ 一键 AI 精读') }}</text>
              </view>
              <view class="rs-btn rs-btn--ghost" hover-class="rs-btn--hover" @tap.stop="onMineViewOriginal(r)">
                <text>📄 查看研报</text>
              </view>
            </view>
          </view>
        </view>

        <!-- 底部一行：搜索 + 日期 + 搜索按钮 -->
        <view class="rs-mine-bottom-bar">
          <input
            class="rs-mine-search-input"
            v-model="mineSearchInput"
            placeholder="输入股票代码 / 名称"
            :disabled="mineLoading"
            @confirm="onMineSearch"
          />
          <scroll-view scroll-x class="rs-mine-date-scroll" show-scrollbar="false">
            <view class="rs-mine-date-pills">
              <view
                v-for="t in ALL_DATE_RANGES"
                :key="t.value"
                class="rs-fx-time-pill"
                :class="{ active: mineTimeRange === t.value }"
                @tap="onMineTimeChange(t.value)"
              >
                <text>{{ t.label }}</text>
              </view>
            </view>
          </scroll-view>
          <view class="rs-btn rs-btn--primary rs-mine-search-btn" hover-class="rs-btn--hover" @tap="onMineSearch" :class="{ 'rs-btn--loading': mineLoading }">
            <text>搜索</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
// H5 端手动挂载自定义 tabBar
const isH5 = ref(typeof window !== 'undefined')
import TabBarComp from '@/custom-tab-bar/index.vue'
import {
  listAllReports, listHoldingReports, ingestFxbaogaoReport, getFxbaogaoPdfUrl,
  type AllReportItem, type HoldingReportItem,
} from '@/api/portfolio'

// 复用同一份关键词表做前端推荐判断（保持和 server 端 detectAdvancedProductivity 一致）
const ADV_PRODUCTIVITY: { category: string; keywords: string[] }[] = [
  { category: '半导体', keywords: ['半导体', '芯片', '集成电路', 'IC', '晶圆', 'wafer', 'chip', 'fab', '光刻机', 'ASML', 'TSMC', '台积电', '中芯国际', 'GPU', '存储', 'DRAM', 'NAND', '封测', 'EDA'] },
  { category: '生物制药', keywords: ['生物制药', '创新药', '生物药', '抗体', 'ADC', 'PD-1', 'PD-L1', 'CAR-T', '基因', 'mRNA', '疫苗', '单抗', '双抗', 'GLP-1', '减肥药', '肿瘤', '靶向', 'biotech', 'pharma', 'CRO', 'CDMO'] },
  { category: '新能源', keywords: ['新能源', '锂电', '锂电池', '动力电池', '储能', '光伏', '太阳能', '风电', '氢能', '氢燃料', '固态电池', '钠离子', '碳酸锂', '正极', '负极', '电解液', '隔膜', 'EV', 'battery', 'solar', 'wind', 'hydrogen', '动储'] },
  { category: '航空航天', keywords: ['航空航天', '航空发动机', '大飞机', 'C919', '卫星', '火箭', '商业航天', '低空经济', '无人机', 'eVTOL', '载人航天', '北斗', 'aerospace', 'satellite', 'rocket', 'drone', 'aviation'] },
  { category: '关键原材料', keywords: ['稀土', '永磁', '锂矿', '钴矿', '镍矿', '半导体材料', '光刻胶', '电子特气', '硅片', '靶材', '关键矿产', '战略物资', '镨钕', '铟', '锗', '钨', '钼', 'rare earth', 'lithium', 'cobalt', 'nickel', 'silicon wafer', 'photoresist'] },
]
function clientDetect(text: string): { recommended: boolean; categories: string[] } {
  if (!text) return { recommended: false, categories: [] }
  const t = text.toLowerCase()
  const cats: string[] = []
  for (const { category, keywords } of ADV_PRODUCTIVITY) {
    if (keywords.some((k) => t.includes(k.toLowerCase()))) cats.push(category)
  }
  return { recommended: cats.length > 0, categories: cats }
}

// ============= Tab 状态 =============
const tab = ref<'all' | 'mine'>('all')

// ============= Tab 1：全部研报 =============
const ALL_DATE_RANGES = [
  { value: 'last7day', label: '1天' },
  { value: 'last7day', label: '1周' },
  { value: 'last1mon', label: '1月' },
  { value: 'last3mon', label: '3月' },
  { value: 'last1year', label: '全部' },
]
// 注意：fxbaogao 不支持 last1day，1天/1周 都用 last7day（最近 7 天数据做近似）
const allDateRange = ref('last7day')
const allBroker = ref<string>('')
interface AllItemWithDate extends AllReportItem {
  _dateRange: string
}
const allItems = ref<AllItemWithDate[]>([])
const allLoading = ref(false)
const allError = ref('')

const allBrokers = computed(() => {
  const set = new Set<string>()
  for (const r of allItems.value) {
    const b = r.broker || r.orgName
    if (b) set.add(b)
  }
  return Array.from(set).sort()
})

const allCounts = computed(() => {
  const byDate: Record<string, number> = {}
  const byBroker: Record<string, number> = {}
  let total = 0
  for (const r of allItems.value) {
    byDate[r._dateRange] = (byDate[r._dateRange] || 0) + 1
    const b = r.broker || r.orgName
    if (b) byBroker[b] = (byBroker[b] || 0) + 1
    total++
  }
  return { byDate, byBroker, total }
})

interface AllItemWithDate extends AllReportItem {
  _dateRange: string
}

const allItemsWithDate = ref<AllItemWithDate[]>([])

async function loadAllList() {
  allLoading.value = true
  allError.value = ''
  try {
    // 并行拉 5 个时间范围以计算 count
    const tasks = ALL_DATE_RANGES.map(async (t) => {
      try {
        const r = await listAllReports({ startTime: t.value, pageNum: 1 })
        const enriched = (r.items || []).map((it) => {
          const det = clientDetect((it.title || '') + ' ' + (it.orgName || ''))
          return { ...it, _dateRange: t.value, broker: it.broker || it.orgName, recommended: det.recommended, categories: det.categories }
        })
        return enriched
      } catch {
        return []
      }
    })
    const results = await Promise.all(tasks)
    // 用最近 1 周的结果作为默认显示
    allItemsWithDate.value = results.flat()
    // 默认 allItems = 当前选定日期范围的项目
    allItems.value = allItemsWithDate.value.filter((r) => r._dateRange === allDateRange.value)
    // 默认所有 broker 都显示（已 selected ''）
  } catch (e: any) {
    allError.value = e?.message || '加载失败'
    allItems.value = []
  } finally {
    allLoading.value = false
  }
}

function onAllDateChange(v: string) {
  allDateRange.value = v
  allItems.value = allItemsWithDate.value.filter((r) => r._dateRange === v)
}
function onAllBrokerChange(b: string) {
  allBroker.value = b
}

// 列表显示 = 选中的日期 + 选中的机构
const allDisplay = computed(() => {
  let arr = allItems.value
  if (allBroker.value) arr = arr.filter((r) => (r.broker || r.orgName) === allBroker.value)
  return arr
})

// onAllClickRow: 直接查看研报（PDF / TXT→MD）
async function onAllClickRow(r: AllReportItem) {
  // 直接触发 PDF / MD 查看（下载 + 打开）
  // 这里先拿 PDF URL：有就开 PDF；否则按 TXT 走 MD 路径（无 raw 时尝试 get_paragraphs 转 MD）
  uni.showLoading({ title: '获取原文…' })
  try {
    const pdfInfo = await getFxbaogaoPdfUrl(r.reportId)
    if (pdfInfo?.url) {
      // PDF：浏览器内嵌/直接打开
      // #ifdef H5
      if (typeof window !== 'undefined') {
        window.open(pdfInfo.url, '_blank')
      }
      // #endif
      // #ifdef MP-WEIXIN
      // 微信小程序：先下载到 temp，再用 wx.openDocument 打开
      uni.downloadFile({
        url: pdfInfo.url,
        success: (d) => {
          if (d.tempFilePath) {
            uni.openDocument({ filePath: d.tempFilePath, fileType: 'pdf', showMenu: true, success: () => uni.showToast({ title: '已打开 PDF', icon: 'success' }) })
          }
        },
        fail: () => uni.showToast({ title: 'PDF 下载失败', icon: 'none' }),
      })
      // #endif
    } else {
      uni.showToast({ title: '未拿到 PDF 链接', icon: 'none' })
    }
  } catch (e: any) {
    uni.showToast({ title: e?.message || '查看失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

// 把 refined raw_text 转成 MD 排版
function refinedToMarkdown(r: { title?: string; broker?: string; industry?: string; tldr?: string; key_points?: string[]; opportunities?: string[]; risks?: string[]; status?: string; created_at?: number }): string {
  const lines: string[] = []
  lines.push(`# ${r.title || '研报精读'}`)
  if (r.broker || r.industry) {
    const meta = [r.broker && `**来源**：${r.broker}`, r.industry && `**行业**：${r.industry}`].filter(Boolean).join('  ·  ')
    if (meta) lines.push(meta)
  }
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
  return lines.join('\n')
}

// 下载 markdown 文件（H5 浏览器原生）
function downloadMarkdown(filename: string, content: string) {
  // #ifdef H5
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  }
  // #endif
  // #ifdef MP-WEIXIN
  // 微信小程序：写到临时文件，提示用户用 MD 阅读器打开
  uni.showToast({ title: 'MD 已生成，请用 MD 阅读器打开', icon: 'none' })
  // #endif
  return false
}

// ============= Tab 2：我的持仓研报 =============
const mineTimeRange = ref('last1mon')
const mineSearchInput = ref('')
const mineItems = ref<HoldingReportItem[]>([])
const mineLoading = ref(false)
const mineLoaded = ref(false)
const mineError = ref('')
const mineExpanded = ref<Set<string>>(new Set())
const mineIngesting = ref<string>('')
const mineIngestedMap = ref<Record<string, any>>({})

async function loadMineList(timeRange?: string) {
  if (mineLoading.value) return
  if (!holdings.value.length) return
  mineLoading.value = true
  mineError.value = ''
  try {
    const r = await listHoldingReports({
      holdings: holdings.value.map((h) => ({ stock_code: h.stock_code, short_name: h.short_name })),
      timeRange: timeRange || mineTimeRange.value,
      maxPerHolding: 30,
    })
    mineItems.value = r.items || []
    mineLoaded.value = true
  } catch (e: any) {
    mineError.value = e?.message || '拉取失败'
    mineItems.value = []
  } finally {
    mineLoading.value = false
  }
}

function onMineLoad(force = false) {
  if (force || !mineLoaded.value) loadMineList()
}
function onMineTimeChange(v: string) {
  mineTimeRange.value = v
  loadMineList(v)
}
function onMineSearch() {
  const code = mineSearchInput.value.trim()
  if (!code) {
    loadMineList()
    return
  }
  // 把搜索词当 holdings[0] 触发 by-holdings
  mineLoading.value = true
  listHoldingReports({
    holdings: [{ stock_code: code, short_name: code }],
    timeRange: mineTimeRange.value,
    maxPerHolding: 30,
  }).then((r) => {
    mineItems.value = r.items || []
    mineLoaded.value = true
  }).catch((e) => {
    uni.showToast({ title: e?.message || '搜索失败', icon: 'none' })
  }).finally(() => {
    mineLoading.value = false
  })
}

function onMineToggleExpand(r: HoldingReportItem) {
  const s = new Set(mineExpanded.value)
  if (s.has(r.key)) s.delete(r.key)
  else s.add(r.key)
  mineExpanded.value = s
}

async function onMineIngest(r: HoldingReportItem) {
  if (mineIngesting.value) return
  mineIngesting.value = r.key
  uni.showLoading({ title: '下载 PDF + AI 精读' })
  try {
    const res = await ingestFxbaogaoReport({ reportId: r.reportId, industry: r.broker || '' })
    if (res?.ok && res.report) {
      const rep = res.report
      const md = refinedToMarkdown(rep)
      mineIngestedMap.value = { ...mineIngestedMap.value, [r.key]: { ...rep, _markdown: md, llm_used: !!res.llm_used } }
      uni.showToast({ title: res.llm_used ? '已精读（LLM）' : '已精读（mock 兜底）', icon: 'success' })
    } else {
      uni.showToast({ title: res?.error || '精读失败', icon: 'none' })
    }
  } catch (e: any) {
    uni.showToast({ title: e?.message || '精读失败', icon: 'none' })
  } finally {
    mineIngesting.value = ''
    uni.hideLoading()
  }
}

// 查看研报（PDF / TXT→MD）
async function onMineViewOriginal(r: HoldingReportItem) {
  // 如果已经精读过：优先用精读结果转 MD 下载
  const ingested = mineIngestedMap.value[r.key]
  if (ingested && ingested._markdown) {
    const ok = downloadMarkdown(`${(ingested.title || r.title || ('report-' + r.reportId)).replace(/[\\/:*?"<>|]/g, '_')}.md`, ingested._markdown)
    if (ok) {
      uni.showToast({ title: '已下载 MD（用 MD 阅读器打开）', icon: 'success' })
      return
    }
  }
  // 否则直接拿 PDF
  uni.showLoading({ title: '获取 PDF…' })
  try {
    const pdfInfo = await getFxbaogaoPdfUrl(r.reportId)
    if (pdfInfo?.url) {
      // #ifdef H5
      if (typeof window !== 'undefined') window.open(pdfInfo.url, '_blank')
      // #endif
      // #ifdef MP-WEIXIN
      uni.downloadFile({
        url: pdfInfo.url,
        success: (d) => {
          if (d.tempFilePath) {
            uni.openDocument({ filePath: d.tempFilePath, fileType: 'pdf', showMenu: true, success: () => uni.showToast({ title: '已打开 PDF', icon: 'success' }) })
          }
        },
        fail: () => uni.showToast({ title: 'PDF 下载失败', icon: 'none' }),
      })
      // #endif
    } else {
      uni.showToast({ title: '未拿到 PDF 链接', icon: 'none' })
    }
  } catch (e: any) {
    uni.showToast({ title: e?.message || '查看失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

// ============= 通用 =============
import { listHoldings, type Holding } from '@/api/portfolio'
const holdings = ref<Holding[]>([])

function onSwitchTab(t: 'all' | 'mine') {
  tab.value = t
  if (t === 'all' && allItemsWithDate.value.length === 0 && !allLoading.value) {
    loadAllList()
  }
  if (t === 'mine' && !mineLoaded.value && !mineLoading.value) {
    loadMineList()
  }
}

onMounted(() => {
  // 默认 Tab 1
  loadAllList()
  listHoldings().then((h) => { holdings.value = h || [] }).then(() => {
    // holdings 拿到后再触发 mine 加载（即便当前 Tab 不是 mine，下次切到时会自动 load）
  })
})

onShow(() => {
  if (tab.value === 'mine' && !mineLoaded.value) loadMineList()
})
</script>

<style lang="scss" scoped>
// ---- design tokens (matching portfolio page palette) ----
$rf-amber: #ffb86b;
$rf-orange: #ff7a3d;
$color-bg: #0d1b2a;
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$app-bg: #0d1b2a;
$app-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$app-border: rgba(255, 184, 107, 0.24);
$app-text: #f5ecd9;
$app-text-muted: #a89a82;
$radius-md: 14rpx;
$radius-lg: 20rpx;
$spacing-base: 24rpx;

.rs-page { min-height: 100vh; background: $app-bg; padding: $spacing-base; padding-bottom: 160rpx; }
.rs-page.h5-mode { position: fixed; left: 0; right: 0; top: 0; bottom: calc(110rpx + env(safe-area-inset-bottom)); display: flex; flex-direction: column; overflow: hidden; }
.rs-head { flex: 0 0 auto; padding: 16rpx 0 8rpx; background: $app-bg; }
.rs-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 0 $spacing-base $spacing-base; }
.rs-body::-webkit-scrollbar { width: 5rpx; }
.rs-body::-webkit-scrollbar-track { background: transparent; }
.rs-body::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #fff4c0 0%, #f4c542 50%, #d89c1c 100%); border-radius: 6rpx; }
.rs-body { scrollbar-width: thin; scrollbar-color: #d89c1c transparent; }
.rs-header { display: flex; flex-direction: column; padding: 16rpx 0 8rpx; margin-bottom: 8rpx; }
.rs-title { display: block; font-size: 44rpx; font-weight: 700; color: $color-text-primary; letter-spacing: 1rpx; }
.rs-meta { display: block; font-size: 22rpx; color: $color-text-secondary; margin-top: 8rpx; letter-spacing: 1rpx; }

.rs-tabbar { display: flex; gap: 12rpx; margin-bottom: $spacing-base; }
.rs-tab { flex: 1; text-align: center; padding: 20rpx 12rpx; border-radius: $radius-md; background: $app-card-bg; border: 1rpx solid $app-border; color: $app-text-muted; font-size: 26rpx; box-sizing: border-box; }
.rs-tab--active { background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%); color: $color-bg; border-color: transparent; font-weight: 600; }

.rs-card { background: $app-card-bg; border-radius: $radius-lg; padding: $spacing-base; border: 1rpx solid $app-border; margin-bottom: $spacing-base; }
.rs-section-title { display: block; font-size: 32rpx; font-weight: 600; color: $app-text; margin-bottom: 10rpx; }
.rs-note { display: block; font-size: 24rpx; line-height: 1.6; margin-bottom: 16rpx; }
.rs-note--muted { color: $app-text-muted; }
.rs-row { display: flex; gap: 12rpx; margin-bottom: 12rpx; }
.rs-input { flex: 1; min-height: 72rpx; padding: 12rpx 18rpx; background: $color-bg; border: 1rpx solid $app-border; border-radius: $radius-md; color: $app-text; font-size: 26rpx; box-sizing: border-box; }
.rs-actions { display: flex; gap: 12rpx; margin-top: 12rpx; }
.rs-btn { flex: 1; text-align: center; padding: 20rpx 12rpx; border-radius: $radius-md; font-size: 28rpx; box-sizing: border-box; }
.rs-btn--ghost { background: $app-card-bg; border: 1rpx solid $app-border; color: $app-text; }
.rs-btn--primary { background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%); color: $color-bg; font-weight: 600; }
.rs-btn--hover { opacity: 0.85; }
.rs-btn--loading { opacity: 0.6; }

.rs-empty { padding: 80rpx 20rpx; text-align: center; color: $app-text-muted; font-size: 26rpx; line-height: 1.7; }

.rs-report-card { }
.rs-report-head { display: flex; justify-content: space-between; align-items: center; gap: 12rpx; }
.rs-report-head-main { min-width: 0; flex: 1; }
.rs-report-title { display: block; font-size: 30rpx; font-weight: 600; color: $app-text; }
.rs-report-chevron { font-size: 32rpx; color: $rf-amber; }
.rs-report-body { margin-top: 16rpx; border-top: 1rpx dashed $app-border; padding-top: 16rpx; }
.rs-tldr { background: rgba(212, 175, 55, 0.08); border-radius: $radius-md; padding: 16rpx; margin-bottom: 16rpx; }
.rs-tldr-label { display: block; font-size: 24rpx; color: $rf-amber; margin-bottom: 6rpx; font-weight: 500; }
.rs-tldr-body { display: block; font-size: 28rpx; line-height: 1.6; color: $app-text; }
.rs-block { margin-top: 16rpx; }
.rs-block-label { display: block; font-size: 26rpx; color: $rf-amber; margin-bottom: 8rpx; font-weight: 500; }
.rs-block-label--risk { color: #ff9a8a; }
.rs-li { display: flex; gap: 8rpx; font-size: 27rpx; line-height: 1.6; color: $app-text; margin-bottom: 4rpx; }
.rs-li--risk { color: #ff9a8a; }
.rs-li-text { flex: 1; min-width: 0; word-break: break-word; }
.rs-dot { color: $rf-amber; }

.rs-fx-time { display: flex; gap: 8rpx; flex-wrap: wrap; }
.rs-fx-time-pill { padding: 10rpx 16rpx; border-radius: 999rpx; background: rgba(255, 184, 107, 0.06); border: 1rpx solid rgba(255, 184, 107, 0.18); color: $app-text-muted; font-size: 22rpx; }
.rs-fx-time-pill.active { background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%); color: $color-bg; border-color: transparent; font-weight: 600; }

.rs-fx-row-meta { display: flex; gap: 12rpx; align-items: center; margin-top: 6rpx; flex-wrap: wrap; }
.rs-fx-org { font-size: 22rpx; color: $rf-amber; background: rgba(212, 175, 55, 0.12); padding: 2rpx 12rpx; border-radius: 6rpx; }
.rs-fx-date { font-size: 22rpx; color: $app-text-muted; }
.rs-fx-pages { font-size: 22rpx; color: $app-text-muted; }

.rs-report-title-row { display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap; }
.rs-rec-badge { font-size: 22rpx; font-weight: 600; color: #0d1b2a; background: linear-gradient(135deg, #ffb86b 0%, #ff7a3d 100%); padding: 4rpx 14rpx; border-radius: 8rpx; flex: 0 0 auto; }

// 底部筛选条（Tab 1）
.rs-filter-bar { margin-top: $spacing-base; padding: 16rpx; background: rgba(255, 255, 255, 0.03); border: 1rpx solid $app-border; border-radius: $radius-lg; }
.rs-filter-row { display: flex; align-items: center; gap: 12rpx; margin-bottom: 12rpx; }
.rs-filter-row:last-child { margin-bottom: 0; }
.rs-filter-label { font-size: 24rpx; color: $app-text-muted; flex: 0 0 auto; }
.rs-filter-scroll { flex: 1; overflow: hidden; white-space: nowrap; }
.rs-filter-pills { display: inline-flex; gap: 8rpx; flex-wrap: nowrap; }

// 底部搜索条（Tab 2 我的持仓研报）
.rs-mine-bottom-bar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10rpx; padding: 14rpx 12rpx; margin-top: $spacing-base; background: $app-bg; border: 1rpx solid $app-border; border-radius: $radius-lg; z-index: 10; }
.rs-mine-search-input { flex: 0 0 200rpx; min-height: 60rpx; padding: 8rpx 12rpx; background: $color-bg; border: 1rpx solid $app-border; border-radius: $radius-md; color: $app-text; font-size: 24rpx; }
.rs-mine-date-scroll { flex: 1; overflow: hidden; white-space: nowrap; }
.rs-mine-date-pills { display: inline-flex; gap: 6rpx; flex-wrap: nowrap; }
.rs-mine-search-btn { flex: 0 0 120rpx; padding: 14rpx 8rpx; font-size: 26rpx; }
</style>
