<template>
  <view class="rs-page" :class="{ 'h5-mode': isH5 }">
    <TabBarComp v-if="isH5" />
    <!-- 固定在顶部的 head 区：标题 + 两个子 tab -->
    <view class="rs-head">
      <view class="rs-header">
        <text class="rs-title">AI 研报</text>
        <text class="rs-meta">全部研报 AI 精读 · 持仓和自选个股研报</text>
      </view>

      <view class="rs-tabbar">
        <view class="rs-tab" :class="{ 'rs-tab--active': tab === 'all' }" @tap="onSwitchTab('all')">
          <text>全部研报 AI 精读</text>
        </view>
        <view class="rs-tab" :class="{ 'rs-tab--active': tab === 'mine' }" @tap="onSwitchTab('mine')">
          <text>持仓和自选个股研报</text>
        </view>
      </view>

      <!-- 集成到 Head 的筛选条：日期 + 机构 + 只看推荐 + 只看海外机构研报（同一行，无边框） -->
      <view v-if="tab === 'all'" class="rs-filter-bar">
        <view class="rs-filter-row">
          <view class="rs-filter-item" @tap="openAllDateMenu">
            <text class="rs-filter-label">日期</text>
            <view class="rs-filter-pill">
              <text class="rs-filter-pill-text">{{ ALL_DATE_RANGE_LABELS[allDateIdx] || '1周' }}</text>
              <text class="rs-filter-pill-caret">▾</text>
            </view>
          </view>
          <view class="rs-filter-item" @tap="openAllBrokerMenu">
            <text class="rs-filter-label">机构</text>
            <view class="rs-filter-pill">
              <text class="rs-filter-pill-text">{{ allBrokerLabels[allBrokerIdx] || '全部' }}</text>
              <text class="rs-filter-pill-caret">▾</text>
            </view>
          </view>
          <view class="rs-filter-item rs-filter-item--switch" @tap="onAllOnlyRecToggle">
            <view class="rs-checkbox" :class="{ 'rs-checkbox--on': allOnlyRecommended }">
              <view v-if="allOnlyRecommended" class="rs-checkbox-tick">✓</view>
            </view>
            <text class="rs-filter-switch-label">只看推荐</text>
          </view>
          <view class="rs-filter-item rs-filter-item--switch" @tap="onAllOnlyForeignToggle">
            <view class="rs-checkbox" :class="{ 'rs-checkbox--on': allOnlyForeign }">
              <view v-if="allOnlyForeign" class="rs-checkbox-tick">✓</view>
            </view>
            <text class="rs-filter-switch-label">只看海外机构研报</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 可滚动内容区 -->
    <view class="rs-body" :class="{ 'rs-body--with-bar': tab === 'mine' }">
      <!-- ============================================================ -->
      <!-- Tab 1：全部研报 AI 精读 -->
      <!-- ============================================================ -->
      <view v-if="tab === 'all'" class="rs-pane">
        <view v-if="allLoading && allDisplay.length === 0" class="rs-empty"><text>正在加载研报列表…</text></view>
        <view v-else-if="allDisplay.length === 0" class="rs-empty">
          <text>暂无研报</text>
          <text v-if="!allLoading" class="rs-empty-hint">{{ syncingHint }}</text>
        </view>

        <view v-for="r in allDisplay" :key="r.reportId" class="rs-card rs-report-card">
          <view v-if="r.recommended" class="rs-rec-seal" @tap.stop="onAllClickRow(r)">
            <text class="rs-rec-seal-char">推</text>
            <text class="rs-rec-seal-char">荐</text>
          </view>
          <view class="rs-report-head" @tap="onAllClickRow(r)">
            <view class="rs-report-head-main">
              <view class="rs-report-title-row">
                <text class="rs-report-title">{{ trimTitle(r.title) }}</text>
              </view>
              <view class="rs-fx-row-meta">
                <text v-if="regionLabel(r.region)" class="rs-tag rs-tag--region">{{ regionLabel(r.region) }}</text>
                <text v-if="r.perspective" class="rs-tag rs-tag--persp">{{ r.perspective }}视角</text>
                <text class="rs-fx-org">{{ r.broker || r.orgName }}</text>
                <text v-if="r.aiStatus === 2" class="rs-ai-badge">✦ 已精读</text>
                <text class="rs-fx-date">{{ r.pubDate }}</text>
              </view>
            </view>
            <text class="rs-report-chevron">{{ allExpanded.has(r.reportId) ? '▾' : '▸' }}</text>
          </view>

          <!-- 展开：AI 精读（按需拉取）+ 查看原文 -->
          <view v-if="allExpanded.has(r.reportId)" class="rs-report-body">
            <view v-if="aiLoadingIds.has(r.reportId)" class="rs-tldr" style="opacity:0.7">
              <text class="rs-tldr-label">✦ AI 精读</text>
              <text class="rs-tldr-body">正在读取精读结果…</text>
            </view>
            <template v-else-if="aiMap[r.reportId]">
              <view class="rs-tldr">
                <text class="rs-tldr-label">✦ 一句话精读</text>
                <text class="rs-tldr-body">{{ aiMap[r.reportId].tldr || '（暂无摘要）' }}</text>
              </view>
              <view v-if="aiMap[r.reportId].key_points?.length" class="rs-block">
                <text class="rs-block-label">📌 核心观点</text>
                <view v-for="(p, i) in aiMap[r.reportId].key_points" :key="i" class="rs-li"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
              </view>
              <view v-if="aiMap[r.reportId].opportunities?.length" class="rs-block">
                <text class="rs-block-label">💡 新机会</text>
                <view v-for="(p, i) in aiMap[r.reportId].opportunities" :key="i" class="rs-li"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
              </view>
              <view v-if="aiMap[r.reportId].risks?.length" class="rs-block">
                <text class="rs-block-label rs-block-label--risk">⚠️ 风险点</text>
                <view v-for="(p, i) in aiMap[r.reportId].risks" :key="i" class="rs-li rs-li--risk"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
              </view>
              <!-- AI 提取的结构化信息 -->
              <view v-if="extractRows(aiMap[r.reportId].extract).length" class="rs-block rs-extract">
                <text class="rs-block-label">🔎 关键信息提取</text>
                <view v-for="row in extractRows(aiMap[r.reportId].extract)" :key="row.label" class="rs-extract-row">
                  <text class="rs-extract-k">{{ row.label }}</text>
                  <text class="rs-extract-v">{{ row.value }}</text>
                </view>
              </view>
            </template>
            <!-- 区分两种空态：已精读但读取失败（可点重试）vs 真未精读（线上队列中） -->
            <view v-else class="rs-tldr" :style="r.aiStatus === 2 ? 'opacity:1' : 'opacity:0.7'" @tap.stop="loadAi(r.reportId)">
              <text class="rs-tldr-label">✦ AI 精读</text>
              <text class="rs-tldr-body">{{ r.aiStatus === 2 ? '精读结果读取失败，点击重试' : '线上队列精读中，稍后回来刷新即可；也可点下方「原文」直接阅读 PDF。' }}</text>
            </view>

            <view class="rs-actions">
              <view class="rs-btn rs-btn--primary" hover-class="rs-btn--hover" @tap.stop="onAllViewOriginal(r)">
                <text>📄 查看研报原文</text>
              </view>
              <view class="rs-btn rs-btn--ghost" hover-class="rs-btn--hover" @tap.stop="onAllClickRow(r)">
                <text>收起</text>
              </view>
            </view>
          </view>
        </view>

        <view v-if="allLoadingMore" class="rs-loadmore"><text>加载更多研报…</text></view>
        <view v-else-if="allDisplay.length > 0 && !dbHasMore" class="rs-loadmore rs-loadmore--end"><text>已全部加载</text></view>
      </view>

      <!-- ============================================================ -->
      <!-- Tab 2：持仓和自选个股研报 -->
      <!-- ============================================================ -->
      <view v-if="tab === 'mine'" class="rs-pane">
        <view class="rs-card">
          <text class="rs-section-title">持仓标的研报</text>
          <text class="rs-note rs-note--muted">为持仓自动拉取卖方研报（高盛/摩根/瑞银/华泰/中金 等 30+ 家），并合并线上已精读库中提取到该股的研报。默认显示最近 1 个月；展开可看 AI 提取的标的/行业/供应商/法规等结构化信息。涉及先进生产力行业的研报标⭐推荐。</text>
          <view class="rs-actions">
            <view class="rs-btn rs-btn--primary" hover-class="rs-btn--hover" @tap="onMineLoad(true)" :class="{ 'rs-btn--loading': mineLoading }">
              <text>{{ mineLoading ? '拉取中…' : '与持仓相关研报' }}</text>
            </view>
          </view>
        </view>

        <view v-if="mineLoading && mineItems.length === 0" class="rs-empty"><text>正在拉取持仓相关研报…</text></view>
        <view v-else-if="mineItems.length === 0 && mineLoaded" class="rs-empty">
          <text>暂无持仓相关研报</text>
          <text class="rs-empty-hint">用底部搜索框输入股票代码 / 名称查询自选个股</text>
        </view>
        <view v-else-if="!mineLoaded" class="rs-empty"><text>首次进入自动加载中…</text></view>

        <view v-for="r in mineItems" :key="r.key" class="rs-card rs-report-card">
          <view v-if="r.recommended" class="rs-rec-seal" @tap.stop="onMineToggleExpand(r)">
            <text class="rs-rec-seal-char">推</text>
            <text class="rs-rec-seal-char">荐</text>
          </view>
          <view class="rs-report-head" @tap="onMineToggleExpand(r)">
            <view class="rs-report-head-main">
              <view class="rs-report-title-row">
                <text class="rs-report-title">{{ trimTitle(r.title) }}</text>
              </view>
              <view class="rs-fx-row-meta">
                <text class="rs-fx-org">{{ r.broker || r.orgName }}</text>
                <text class="rs-fx-date">{{ r.pubDate }}</text>
                <text v-if="r.holdingCode" class="rs-fx-pages">· 关联 {{ r.holdingName || r.holdingCode }}</text>
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

            <!-- AI 提取的结构化信息（标的/行业/供应商/买方/法规/原材料/产地风险/订单/认证/财报/控制人） -->
            <view v-if="extractRows(mineIngestedMap[r.key]?.extract).length" class="rs-block rs-extract">
              <text class="rs-block-label">🔎 关键信息提取</text>
              <view v-for="row in extractRows(mineIngestedMap[r.key]?.extract)" :key="row.label" class="rs-extract-row">
                <text class="rs-extract-k">{{ row.label }}</text>
                <text class="rs-extract-v">{{ row.value }}</text>
              </view>
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
      </view>
    </view>

    <!-- 底部搜索栏（在滚动区外，固定贴底不被研报列表覆盖；仅 Tab 2 显示） -->
    <view v-if="tab === 'mine'" class="rs-mine-bottom-bar">
      <input
        class="rs-mine-search-input"
        v-model="mineSearchInput"
        placeholder="输入股票代码 / 名称"
        :disabled="mineLoading"
        @confirm="onMineSearch"
      />
      <view class="rs-filter-pill rs-mine-date-btn" @tap="openMineDateMenu">
        <text class="rs-filter-pill-text">{{ currentMineDateLabel }}</text>
        <text class="rs-filter-pill-caret">▾</text>
      </view>
      <view class="rs-btn rs-btn--primary rs-mine-search-btn" hover-class="rs-btn--hover" @tap="onMineSearch" :class="{ 'rs-btn--loading': mineLoading }">
        <text>搜索</text>
      </view>
    </view>

    <!-- ============================================================ -->
    <!-- 统一底部菜单 sheet（两个 tab 共用） -->
    <!-- ============================================================ -->
    <view v-if="menuOpen" class="rs-menu-mask" @tap="closeMenu">
      <view class="rs-menu-sheet" @tap.stop>
        <view class="rs-menu-handle" />
        <view class="rs-menu-header">
          <text class="rs-menu-title">{{ menuTitle }}</text>
          <view class="rs-menu-close" @tap="closeMenu">
            <text>×</text>
          </view>
        </view>
        <scroll-view scroll-y class="rs-menu-scroll" :show-scrollbar="false">
          <view
            v-for="opt in menuOptions"
            :key="String(opt.value)"
            class="rs-menu-item"
            :class="{ 'rs-menu-item--active': opt.value === menuValue }"
            @tap="onMenuSelect(opt)"
          >
            <text class="rs-menu-item-label">{{ opt.label }}</text>
            <text class="rs-menu-item-count" :class="{ 'rs-menu-item-count--active': opt.value === menuValue }">{{ opt.count }}</text>
            <view v-if="opt.value === menuValue" class="rs-menu-item-tick">✓</view>
          </view>
        </scroll-view>
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
  listHoldingReports, ingestFxbaogaoReport, getFxbaogaoPdfUrl, getFxbaogaoAi, searchFxbaogaoExtract,
  listFxbaogaoDbReports, syncFxbaogaoAll, triggerFxbaogaoRefine,
  type HoldingReportItem, type FxbaogaoAiResult, type FxbaogaoExtract,
} from '@/api/portfolio'

// AI 提取的结构化信息 → 展示行（空的维度自动隐藏）
interface ExtractRow { label: string; value: string }
function extractRows(ext?: FxbaogaoExtract | null): ExtractRow[] {
  if (!ext || typeof ext !== 'object') return []
  const rows: ExtractRow[] = []
  const stocks = (ext.stocks || []).map((s) => (s.code ? `${s.name || ''}(${s.code})` : s.name)).filter(Boolean)
  if (stocks.length) rows.push({ label: '🎯 A股标的', value: stocks.join('、') })
  if (ext.industry) rows.push({ label: '🏭 行业', value: ext.industry })
  if (ext.suppliers?.length) rows.push({ label: '⬆️ 供应商', value: ext.suppliers.join('；') })
  if (ext.buyers?.length) rows.push({ label: '⬇️ 产品买方', value: ext.buyers.join('；') })
  if (ext.regulations?.length) rows.push({ label: '📜 法规政策', value: ext.regulations.join('；') })
  if (ext.raw_materials?.length) rows.push({ label: '⛏ 原材料', value: ext.raw_materials.join('；') })
  if (ext.origin_risks?.length) rows.push({ label: '🌍 产地风险', value: ext.origin_risks.join('；') })
  if (ext.orders?.length) rows.push({ label: '📦 订单', value: ext.orders.join('；') })
  if (ext.certifications?.length) rows.push({ label: '🏅 大厂认证', value: ext.certifications.join('；') })
  if (ext.financials?.length) rows.push({ label: '💰 财报', value: ext.financials.join('；') })
  if (ext.key_persons?.length) rows.push({ label: '👤 关键控制人', value: ext.key_persons.join('；') })
  return rows
}

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

// ============= 通用 =============
import { listHoldings, type Holding } from '@/api/portfolio'
const holdings = ref<Holding[]>([])

// ============= 底部菜单 sheet（统一两个 tab） =============
interface MenuOption { value: string | number; label: string; count?: number }
interface MenuConfig { title: string; options: MenuOption[]; value: string | number; onSelect: (opt: MenuOption) => void }
const menuOpen = ref(false)
const menuTitle = ref('')
const menuOptions = ref<MenuOption[]>([])
const menuValue = ref<string | number>('')

function openMenu(cfg: MenuConfig) {
  menuTitle.value = cfg.title
  menuOptions.value = cfg.options
  menuValue.value = cfg.value
  // 用 ref 暂存回调（避免 menu 关闭时丢失）
  ;(menuSelectHandler as any).value = cfg.onSelect
  menuOpen.value = true
}
const menuSelectHandler = ref<((opt: MenuOption) => void) | null>(null)

function closeMenu() {
  menuOpen.value = false
  menuSelectHandler.value = null
}
function onMenuSelect(opt: MenuOption) {
  if (menuSelectHandler.value) menuSelectHandler.value(opt)
  closeMenu()
}

// Tab 1 打开日期菜单
function openAllDateMenu() {
  const opts: MenuOption[] = ALL_DATE_RANGES.map((t, i) => ({
    value: i,
    label: t.label,
    count: allCounts.value.byDate[ALL_DATE_DAYS[i]] || 0,
  }))
  openMenu({
    title: '选择日期范围',
    options: opts,
    value: allDateIdx.value,
    onSelect: (opt) => {
      allDateIdx.value = Number(opt.value)
      loadAllListFromDb()
    },
  })
}
// Tab 1 打开机构菜单
function openAllBrokerMenu() {
  const opts: MenuOption[] = allBrokerLabels.value.map((label, i) => ({
    value: i,
    label,
    count: i === 0 ? allCounts.value.total : (allCounts.value.byBroker[allBrokers.value[i - 1]] || 0),
  }))
  openMenu({
    title: '选择研报机构',
    options: opts,
    value: allBrokerIdx.value,
    onSelect: (opt) => {
      const idx = Number(opt.value)
      allBrokerIdx.value = idx
      allBroker.value = idx <= 0 ? '' : (allBrokers.value[idx - 1] || '')
    },
  })
}

// ============= Tab 状态 =============
const tab = ref<'all' | 'mine'>('all')

// ============= Tab 1：全部研报 =============
// 日期范围（Tab 1/Tab 2 共用）：value 传给后端 by-holdings 时间范围 key
// 「最新」= 默认，不设时间过滤，只显示库内最新 200 条；其余按回拉天数过滤
const ALL_DATE_RANGES = [
  { value: 'last1day', label: '最新' },
  { value: 'last1day', label: '1天' },
  { value: 'last1week', label: '1周' },
  { value: 'last1mon', label: '1月' },
  { value: 'last3mon', label: '3月' },
]
const ALL_DATE_RANGE_LABELS = ALL_DATE_RANGES.map((t) => t.label)
// Tab 1 从数据库读取研报，日期筛选按「回拉天数」（0 = 最新，仅取前 LATEST_CAP 条）
const ALL_DATE_DAYS = [0, 1, 7, 30, 90]
const allDateIdx = ref(0) // 默认「最新」
const LATEST_CAP = 200 // 「最新」档最多展示条数
const allBroker = ref<string>('')
const allBrokerIdx = ref(0) // 0 = '全部'，>0 = 某个 broker
const allOnlyRecommended = ref(false)
const allOnlyForeign = ref(false) // 只看海外机构研报
interface AllItemWithDate {
  reportId: number
  title: string
  orgName: string
  broker: string
  pageNum: number
  pubTime: number        // 秒（库内单位）
  pubDate: string
  recommended: boolean
  categories: string[]
  pdfUrl?: string // PDF 直链缓存（详情秒开用）
  aiStatus?: number // 0=未精读 1=精读中 2=已精读
  reportType?: string // 服务端分类：stock/industry/macro/strategy/minutes/other
  industryName?: string // fxbaogao 自带行业分类
  region?: string   // CN/US/KR/JP/TW/HK/GLOBAL/OTHER（研报涉及地区）
  perspective?: string // 产业/金融/供应链/技术/订单/认证/''（中资行业研报视角）
}

// 地区码 → 中文标签（与后端 detectFxbaogaoRegion 一致）
const REGION_LABELS: Record<string, string> = {
  CN: '中国', US: '美国', KR: '韩国', JP: '日本', TW: '台湾', HK: '香港', GLOBAL: '全球', OTHER: '',
}
function regionLabel(code: string | undefined): string {
  return REGION_LABELS[String(code || '').toUpperCase()] || ''
}
// 标题展示前去掉前面的空格与换行（数据源里部分标题带 \n/空格前缀）
function trimTitle(t: string | undefined): string {
  return String(t || '').replace(/^[\s\n\r]+/, '')
}
const allItems = ref<AllItemWithDate[]>([])
const allLoading = ref(false)
const allError = ref('')

// ---- 数据库读取状态（fxbaogao 已同步入库的研报） ----
const DB_PAGE_SIZE = 50
const dbPage = ref(0)
const dbHasMore = ref(true)
const allLoadingMore = ref(false)

const allBrokers = computed(() => {
  const set = new Set<string>()
  for (const r of allItems.value) {
    const b = r.broker || r.orgName
    if (b) set.add(b)
  }
  return Array.from(set).sort()
})

const allBrokerLabels = computed(() => ['全部', ...allBrokers.value])

// 个股研报过滤已由服务端 report_type 处理（全部研报 tab 只出综合类），
// 客户端不再做个股过滤，避免误杀标题含持仓名的行业研报。

const allCounts = computed(() => {
  const byDate: Record<string, number> = {}
  const byBroker: Record<string, number> = {}
  let total = 0
  const now = Date.now()
  for (const r of allItems.value) {
    // 按「回拉天数」统计当前已加载数据落入各日期档的数量
    const pubMs = Number(r.pubTime || 0) * 1000
    for (const days of ALL_DATE_DAYS) {
      if (days === 0 || pubMs >= now - days * 86400000) byDate[days] = (byDate[days] || 0) + 1
    }
    const b = r.broker || r.orgName
    if (b) byBroker[b] = (byBroker[b] || 0) + 1
    total++
  }
  return { byDate, byBroker, total }
})

// 把给定「回拉天数」换算成毫秒时间范围（0 = 全部）
function daysToRangeMs(days: number): { startMs: number; endMs: number } {
  const now = Date.now()
  if (!days) return { startMs: 0, endMs: now }
  return { startMs: now - days * 86400000, endMs: now }
}

// 数据库 item → 展示 item（补 recommended / categories；排序由服务端完成）
function toAllItem(it: any): AllItemWithDate {
  const title = it.title || ''
  const det = clientDetect(title + ' ' + (it.orgName || ''))
  return {
    reportId: Number(it.reportId),
    title,
    orgName: String(it.orgName || ''),
    broker: String(it.orgName || ''),
    pageNum: Number(it.pageNum || 0),
    pubTime: Number(it.pubTime || 0),
    pubDate: String(it.pubTimeStr || '').replace(/\/+$/, ''),
    recommended: det.recommended,
    categories: det.categories,
    pdfUrl: String(it.pdfUrl || ''),
    aiStatus: Number(it.aiStatus || 0),
    reportType: String(it.reportType || ''),
    industryName: String(it.industryName || ''),
    region: String(it.region || ''),
    perspective: String(it.perspective || ''),
  }
}

// 从数据库分页读取研报（按选中日期范围过滤 + 触底分页）
async function loadAllListFromDb() {
  const days = ALL_DATE_DAYS[allDateIdx.value] ?? 0
  const isLatest = days === 0
  const { startMs, endMs } = daysToRangeMs(days)
  allLoading.value = !allLoadingMore.value
  try {
    const r = await listFxbaogaoDbReports({ pageNum: 1, pageSize: DB_PAGE_SIZE, startMs, endMs })
    if (!r?.ok) throw new Error('读取研报失败')
    allItems.value = (r.items || []).map(toAllItem)
    dbPage.value = 1
    const got = (r.items || []).length
    dbHasMore.value = got >= DB_PAGE_SIZE && (!isLatest || got < LATEST_CAP)
  } catch (e: any) {
    allError.value = e?.message || '加载失败'
    allItems.value = []
    dbHasMore.value = false
  } finally {
    allLoading.value = false
    allLoadingMore.value = false
  }
}

// 触底加载下一页（追加到当前日期范围）
async function loadAllMoreDb() {
  if (allLoadingMore.value || allLoading.value) return
  if (!dbHasMore.value) return
  const next = dbPage.value + 1
  const days = ALL_DATE_DAYS[allDateIdx.value] ?? 0
  const isLatest = days === 0
  const { startMs, endMs } = daysToRangeMs(days)
  allLoadingMore.value = true
  try {
    const r = await listFxbaogaoDbReports({ pageNum: next, pageSize: DB_PAGE_SIZE, startMs, endMs })
    const items = (r?.items || []).map(toAllItem)
    const seen = new Set(allItems.value.map((it) => it.reportId))
    const fresh = items.filter((it) => !seen.has(it.reportId))
    allItems.value = [...allItems.value, ...fresh]
    dbPage.value = next
    dbHasMore.value = items.length >= DB_PAGE_SIZE && (!isLatest || allItems.value.length < LATEST_CAP)
  } catch {
    // 单页失败不阻塞：保留 hasMore 以便再次触底重试
  } finally {
    allLoadingMore.value = false
  }
}

// H5：监听 .rs-body 滚动到底部附近时触发加载更多
function bindAllScrollListener() {
  // #ifdef H5
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const el = document.querySelector('.rs-body') as HTMLElement | null
  if (!el) return
  const onScroll = () => {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) {
      loadAllMoreDb()
    }
  }
  el.addEventListener('scroll', onScroll)
  // #endif
}

function onAllOnlyRecToggle() {
  allOnlyRecommended.value = !allOnlyRecommended.value
}
function onAllOnlyForeignToggle() {
  allOnlyForeign.value = !allOnlyForeign.value
}

// 海外/外资机构名单（中文名 + 英文关键词），用于「只看海外机构研报」
const FOREIGN_BROKER_RE = /高盛|摩根|瑞银|美银|花旗|巴克莱|德意志|瑞信|野村|大和|富瑞|法兴|麦格理|里昂|汇丰|渣打|伯恩斯坦|奥本海默|盛博|大摩|小摩|Jefferies|Morgan|Goldman|UBS|JPMorgan|Citibank|BofA|Barclays|Credit\s*Suisse|Deutsche|Nomura|Daiwa|CLSA|Macquarie|HSBC|Societe|Berenberg|Bernstein/i
function isForeignBroker(name: string): boolean {
  if (!name) return false
  return FOREIGN_BROKER_RE.test(name)
}

// 列表显示 = 选中的机构 + 只看推荐 + 只看海外机构
// （个股研报过滤与「外资→推荐→行业/宏观→纪要」排序均已由服务端完成）
const allDisplay = computed(() => {
  let arr = allItems.value
  if (allBroker.value) arr = arr.filter((r) => (r.broker || r.orgName) === allBroker.value)
  if (allOnlyRecommended.value) arr = arr.filter((r) => r.recommended)
  if (allOnlyForeign.value) arr = arr.filter((r) => isForeignBroker(r.broker || r.orgName || ''))
  return arr
})

// onAllClickRow: 直接查看研报（优先 PDF 直链，快速打开；失败则落到官网阅读页）
// H5 打开外部 URL：uni-app 的 tap 是合成事件，Safari 等浏览器可能静默拦截
// window.open（无报错、无新窗——即「点了没反应」）。
// 策略：同步先开 about:blank 拿句柄（必须在用户手势调用栈内），再填 location；
// 句柄为 null（被拦截）时降级为复制链接 + 提示。
function openReportUrl(url: string) {
  // #ifdef H5
  if (typeof window !== 'undefined') {
    const win = window.open('', '_blank')
    if (win) {
      try { win.opener = null } catch {}
      win.location.href = url
      return
    }
    // 被弹窗拦截器拦截：降级复制链接
    try { navigator.clipboard?.writeText(url).catch(() => {}) } catch {}
    uni.showToast({ title: '弹窗被浏览器拦截，链接已复制，请粘贴到新标签页打开', icon: 'none', duration: 3000 })
    return
  }
  // #endif
  // #ifdef MP-WEIXIN
  if (/\.pdf(\?|$)/i.test(url)) {
    uni.downloadFile({
      url,
      success: (d) => {
        if (d.tempFilePath) uni.openDocument({ filePath: d.tempFilePath, fileType: 'pdf', showMenu: true, success: () => uni.showToast({ title: '已打开 PDF', icon: 'success' }) })
      },
      fail: () => uni.showToast({ title: 'PDF 下载失败', icon: 'none' }),
    })
  } else {
    uni.setClipboardData({ data: url, success: () => uni.showToast({ title: '链接已复制（请在浏览器打开）', icon: 'none' }) })
  }
  // #endif
}

// ============= Tab 1：展开 + AI 精读（按需拉取，带缓存） =============
const allExpanded = ref<Set<number>>(new Set())
const aiMap = ref<Record<number, FxbaogaoAiResult>>({})
// 按 id 独立加锁（单值锁会在上一请求未返回时静默丢弃后续展开，导致"已精读却显示精读中"）
const aiLoadingIds = ref<Set<number>>(new Set())

// 展开/收起；首次展开按需拉 AI 精读结果（命中缓存不重复请求）
async function onAllClickRow(r: AllItemWithDate) {
  const s = new Set(allExpanded.value)
  if (s.has(r.reportId)) s.delete(r.reportId)
  else {
    s.add(r.reportId)
    if (!aiMap.value[r.reportId]) loadAi(r.reportId)
  }
  allExpanded.value = s
}

async function loadAi(reportId: number) {
  if (aiLoadingIds.value.has(reportId)) return
  const s = new Set(aiLoadingIds.value)
  s.add(reportId)
  aiLoadingIds.value = s
  try {
    const res = await getFxbaogaoAi(reportId)
    if (res?.ok && res.refined) {
      aiMap.value = { ...aiMap.value, [reportId]: res.refined }
      // 同步角标（避免整列表刷新）
      allItems.value = allItems.value.map((it) => (it.reportId === reportId ? { ...it, aiStatus: 2 } : it))
    } else if (res?.ok && !res.refined) {
      // 未精读：触发线上精读批次（fire-and-forget），不阻塞 UI
      triggerFxbaogaoRefine(5).catch(() => {})
    }
  } catch {
    // 失败不静默吞：卡片显示"读取失败，点击重试"（tap 精读区即可重试）
  } finally {
    const s2 = new Set(aiLoadingIds.value)
    s2.delete(reportId)
    aiLoadingIds.value = s2
  }
}

// 查看研报原文：命中缓存秒开；未命中先同步拿窗口句柄（防 await 后被弹窗拦截）
async function onAllViewOriginal(r: AllItemWithDate) {
  if (r.pdfUrl) {
    openReportUrl(r.pdfUrl)
    return
  }
  // #ifdef H5
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null
  // #endif
  uni.showLoading({ title: '获取原文…' })
  try {
    const pdfInfo = await getFxbaogaoPdfUrl(r.reportId)
    const url = pdfInfo?.url || `https://www.fxbaogao.com/view?id=${r.reportId}`
    uni.hideLoading()
    // #ifdef H5
    if (win) {
      try { win.opener = null } catch {}
      win.location.href = url
      return
    }
    // #endif
    openReportUrl(url)
  } catch (e: any) {
    // #ifdef H5
    if (win) { try { win.close() } catch {} }
    // #endif
    uni.hideLoading()
    uni.showToast({ title: e?.message || '查看失败', icon: 'none' })
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

const currentMineDateLabel = computed(() => {
  const m = ALL_DATE_RANGES.find((t) => t.value === mineTimeRange.value)
  return m?.label || '1月'
})

function openMineDateMenu() {
  const opts: MenuOption[] = ALL_DATE_RANGES.map((t) => ({ value: t.value, label: t.label }))
  openMenu({
    title: '选择日期范围',
    options: opts,
    value: mineTimeRange.value,
    onSelect: (opt) => {
      mineTimeRange.value = String(opt.value)
      loadMineList()
    },
  })
}

async function loadMineList(timeRange?: string) {
  if (mineLoading.value) return
  // 无持仓：合并线上已精读库也没有标的可查，直接结束 loading 态
  // （否则永远卡在「首次进入自动加载中…」）
  if (!holdings.value.length) {
    mineLoaded.value = true
    mineItems.value = []
    return
  }
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
    // 合并线上已精读库中提取到持仓标的的研报（自带精读结果，免重新精读）
    mergeExtractReports(
      holdings.value.map((h) => h.stock_code),
      holdings.value.map((h) => h.short_name || ''),
    )
  } catch (e: any) {
    mineError.value = e?.message || '拉取失败'
    mineItems.value = []
  } finally {
    mineLoading.value = false
  }
}

// 合并精读库按个股检索的结果：LLM 从研报提取的标的（代码/名称）命中的已精读研报
// 直接预填 mineIngestedMap（精读结果线上已有），展开即看、无需「一键 AI 精读」
// Turso 海外直连偶发慢查询：8 秒后自动补拉一次（按 reportId 去重，重复调用安全）
let extractRetryTimer: ReturnType<typeof setTimeout> | null = null
async function mergeExtractReports(codes: string[], names: string[]) {
  const validCodes = codes.map((c) => String(c || '').trim()).filter((c) => /^\d{6}$/.test(c))
  const validNames = names.map((n) => String(n || '').trim()).filter((n) => n.length >= 2)
  if (!validCodes.length && !validNames.length) return
  const merged = await doMergeExtract(validCodes, validNames)
  if (!merged) {
    if (extractRetryTimer) clearTimeout(extractRetryTimer)
    extractRetryTimer = setTimeout(() => {
      if (tab.value === 'mine') doMergeExtract(validCodes, validNames)
    }, 8000)
  }
}

async function doMergeExtract(validCodes: string[], validNames: string[]): Promise<boolean> {
  try {
    const r = await searchFxbaogaoExtract(validCodes, validNames)
    if (!r?.ok || !r.items?.length) return false
    const seen = new Set(mineItems.value.map((it) => it.reportId))
    const fresh: HoldingReportItem[] = []
    const ingestedPatch: Record<string, any> = {}
    for (const it of r.items) {
      if (seen.has(it.reportId)) continue
      seen.add(it.reportId)
      const det = clientDetect(it.title + ' ' + (it.orgName || ''))
      const key = `fx:${it.reportId}`
      fresh.push({
        source: 'fxbaogao',
        key,
        reportId: it.reportId,
        title: it.title,
        orgName: it.orgName || it.broker,
        pubDate: it.pubDate || '',
        pageNum: it.pageNum || 0,
        viewUrl: `https://www.fxbaogao.com/view?id=${it.reportId}`,
        recommended: it.recommended || det.recommended,
        categories: it.categories?.length ? it.categories : det.categories,
        holdingCode: '',
        holdingName: '',
        broker: it.orgName || it.broker,
      })
      // 预填精读结果（含结构化提取）
      ingestedPatch[key] = {
        title: it.title,
        broker: it.orgName || it.broker,
        industry: it.industryName || it.extract?.industry || '',
        tldr: it.tldr || '',
        key_points: it.key_points || [],
        opportunities: it.opportunities || [],
        risks: it.risks || [],
        status: it.status,
        extract: it.extract,
        llm_used: it.status === 'refined-llm',
      }
    }
    if (fresh.length) {
      mineItems.value = [...mineItems.value, ...fresh]
      mineIngestedMap.value = { ...mineIngestedMap.value, ...ingestedPatch }
      return true
    }
    return false
  } catch {
    // 精读库检索失败静默跳过（重试机制会补拉）
    return false
  }
}

function onMineLoad(force = false) {
  if (force || !mineLoaded.value) loadMineList()
}
function onMineSearch() {
  const code = mineSearchInput.value.trim()
  if (!code) {
    loadMineList()
    return
  }
  // 把搜索词当 holdings[0] 触发 by-holdings；代码格式则同时合并精读库提取结果
  const isCode = /^\d{6}$/.test(code)
  mineLoading.value = true
  listHoldingReports({
    holdings: [{ stock_code: code, short_name: code }],
    timeRange: mineTimeRange.value,
    maxPerHolding: 30,
  }).then((r) => {
    mineItems.value = r.items || []
    mineLoaded.value = true
    if (isCode) mergeExtractReports([code], [])
    else mergeExtractReports([], [code])
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
  // 走 PDF：先同步拿窗口句柄（await 后 window.open 会被弹窗拦截器静默拦截）
  // #ifdef H5
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null
  // #endif
  uni.showLoading({ title: '获取 PDF…' })
  try {
    const pdfInfo = await getFxbaogaoPdfUrl(r.reportId)
    if (pdfInfo?.url) {
      // #ifdef H5
      if (win) {
        try { win.opener = null } catch {}
        win.location.href = pdfInfo.url
      } else {
        // 句柄被拦：降级复制链接
        try { navigator.clipboard?.writeText(pdfInfo.url).catch(() => {}) } catch {}
        uni.showToast({ title: '弹窗被浏览器拦截，链接已复制', icon: 'none', duration: 3000 })
      }
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
      // PDF 拿不到 → 落官网阅读页兜底（至少能看到标题+摘要）；复用已开的窗口
      const viewUrl = pdfInfo?.viewUrl || `https://www.fxbaogao.com/view?id=${r.reportId}`
      // #ifdef H5
      if (win) {
        try { win.opener = null } catch {}
        win.location.href = viewUrl
      } else if (typeof window !== 'undefined') {
        window.open(viewUrl, '_blank')
      }
      // #endif
    }
  } catch (e: any) {
    // #ifdef H5
    if (win) { try { win.close() } catch {} }
    // #endif
    uni.showToast({ title: e?.message || '查看失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

// ============= 通用 =============

function onSwitchTab(t: 'all' | 'mine') {
  tab.value = t
  if (t === 'all' && allItems.value.length === 0 && !allLoading.value) {
    loadAllListFromDb()
  }
  if (t === 'mine' && !mineLoaded.value && !mineLoading.value) {
    loadMineList()
  }
}

// 「打开页面即拉当日研报」：触发当日分片同步 + 后台精读（fire-and-forget，服务端有互斥）
// 5 分钟内不重复触发；同步是异步的，稍后静默刷新列表把新研报带出来
let lastEnsureSyncAt = ref(0)
const syncingHint = computed(() =>
  Date.now() - lastEnsureSyncAt.value < 3 * 60_000
    ? '正在从线上同步当日研报，稍等片刻自动刷新…'
    : '线上每 15 分钟自动同步 + AI 精读，稍后再来看看')
async function ensureTodaySynced() {
  const now = Date.now()
  if (now - lastEnsureSyncAt.value < 5 * 60_000) return
  lastEnsureSyncAt.value = now
  syncFxbaogaoAll(1).then(() => triggerFxbaogaoRefine(10)).catch(() => {})
  setTimeout(() => { if (tab.value === 'all') loadAllListFromDb() }, 15_000)
  setTimeout(() => { if (tab.value === 'all' && !allDisplay.value.length) loadAllListFromDb() }, 45_000)
}

onMounted(() => {
  // 默认 Tab 1
  loadAllListFromDb()
  ensureTodaySynced()
  bindAllScrollListener()
  listHoldings().then((h) => {
    holdings.value = h || []
  })
})

// 首次 onShow 与 onMounted 重复，跳过一次
let firstShow = true
onShow(() => {
  if (firstShow) { firstShow = false; return }
  if (tab.value === 'all') {
    loadAllListFromDb()
    ensureTodaySynced()
  } else if (tab.value === 'mine' && !mineLoaded.value) {
    loadMineList()
  }
})
</script>

<style lang="scss" scoped>
// ---- design tokens (matching portfolio page palette) ----
$rf-amber: #ffb86b;
$rf-orange: #ff7a3d;
$color-bg: #0b0b0d;
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$app-bg: #0b0b0d;
$app-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$app-border: rgba(255, 184, 107, 0.24);
$app-text: #f5ecd9;
$app-text-muted: #a89a82;
$radius-md: 14rpx;
$radius-lg: 20rpx;
$spacing-base: 24rpx;

.rs-page { min-height: 100vh; background: $app-bg;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.032) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.032) 1px, transparent 1px);
  background-size: 48px 48px;
  padding: $spacing-base; padding-bottom: calc(160rpx + env(safe-area-inset-bottom, 0px)); }
.rs-page.h5-mode { position: fixed; left: 0; right: 0; top: 0; bottom: calc(110rpx + env(safe-area-inset-bottom)); display: flex; flex-direction: column; overflow: hidden; }
.rs-head { flex: 0 0 auto; padding: 16rpx 0 8rpx; background: $app-bg; }
.rs-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 0 $spacing-base calc(140rpx + env(safe-area-inset-bottom, 0px)); }
// Tab 2 打开时给滚动区预留底部搜索栏高度（fixed 布局，防最后一张卡片被遮）
.rs-body--with-bar { padding-bottom: calc(140rpx + env(safe-area-inset-bottom, 0px)); }
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
.rs-empty-hint { display: block; margin-top: 8rpx; font-size: 24rpx; color: $rf-amber; }
.rs-loadmore { padding: 24rpx 0 8rpx; text-align: center; color: $app-text-muted; font-size: 24rpx; }
.rs-loadmore--end { opacity: 0.7; }

.rs-report-card { position: relative; }
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

.rs-fx-row-meta { display: flex; gap: 12rpx; align-items: center; margin-top: 6rpx; flex-wrap: wrap; }
.rs-fx-org { font-size: 22rpx; color: $rf-amber; background: rgba(212, 175, 55, 0.12); padding: 2rpx 12rpx; border-radius: 6rpx; }
.rs-ai-badge { font-size: 20rpx; color: #7ef2c4; background: rgba(126, 242, 196, 0.12); padding: 2rpx 10rpx; border-radius: 6rpx; }
.rs-fx-date { font-size: 22rpx; color: $app-text-muted; }
.rs-fx-pages { font-size: 22rpx; color: $app-text-muted; }

.rs-report-title-row { display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap; }

// 推荐标记：古欧洲火漆封笺——不规则波浪蜡缘 + 铜章压出的内凹盘 + 烫金凹凸「推荐」
// 视觉参照：真实火漆印的边缘是蜡被挤压溢出的不规则圆、中心比外缘低一圈、
// 字被压进蜡里（上沿有阴影、下沿反光），左上有一块蜡面高光。
.rs-rec-seal {
  position: absolute;
  top: 8rpx;
  right: 40rpx;
  z-index: 2;
  width: 90rpx;
  height: 90rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  // 不规则波浪外缘：火漆受压溢出的形状
  border-radius: 48% 52% 50% 50% / 53% 47% 55% 45%;
  background:
    // 左上蜡面高光（光泽感）
    radial-gradient(90% 70% at 28% 20%, rgba(255, 160, 130, 0.5) 0%, rgba(255, 120, 90, 0) 38%),
    // 右下暗部（厚度感）
    radial-gradient(120% 120% at 76% 84%, rgba(96, 14, 10, 0.85) 0%, rgba(226, 72, 61, 0) 52%),
    // 蜡体基色
    linear-gradient(148deg, #cc4034 0%, #a52c23 52%, #7c1f17 100%);
  transform: rotate(-7deg);
  box-shadow:
    // 外缘受光（蜡的上缘亮线）
    inset 0 3rpx 5rpx rgba(255, 200, 180, 0.35),
    // 外缘背光（蜡的下缘暗线）
    inset 0 -6rpx 10rpx rgba(56, 8, 5, 0.65),
    // 落在纸面的投影
    0 6rpx 16rpx rgba(0, 0, 0, 0.5);
}
// 铜章压入蜡面形成的内凹盘（中心低一圈，边缘有一圈挤压隆起）
.rs-rec-seal::before {
  content: '';
  position: absolute;
  inset: 9rpx;
  border-radius: 50% 50% 50% 50% / 52% 48% 50% 50%;
  background:
    radial-gradient(80% 80% at 30% 22%, rgba(255, 150, 120, 0.22) 0%, rgba(255, 120, 90, 0) 40%),
    linear-gradient(152deg, #96241b 0%, #b63428 55%, #cc4034 100%);
  box-shadow:
    // 压痕：内凹盘上沿的阴影（深）
    inset 0 4rpx 7rpx rgba(56, 8, 5, 0.8),
    // 压痕：内凹盘下沿的反光（受挤压隆起反光）
    inset 0 -3rpx 5rpx rgba(255, 175, 145, 0.3);
}
// 火漆溢出的小蜡滴（右下角一滴，增加手工感）
.rs-rec-seal::after {
  content: '';
  position: absolute;
  right: -8rpx;
  bottom: 14rpx;
  width: 20rpx;
  height: 17rpx;
  border-radius: 52% 48% 45% 55% / 55% 50% 50% 45%;
  background: linear-gradient(148deg, #b63428 0%, #8a251d 60%, #6e1b14 100%);
  box-shadow:
    inset 0 2rpx 3rpx rgba(255, 190, 165, 0.28),
    inset 0 -3rpx 5rpx rgba(50, 7, 4, 0.6);
}
// 烫金字：压进蜡里的凹凸感——上沿阴影 + 下沿反光，金箔渐变
.rs-rec-seal-char {
  position: relative;
  z-index: 1;
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.1;
  text-align: center;
  font-family: "Xingkai SC", "STXingkai", "Kaiti SC", "KaiTi", "STKaiti", cursive, serif;
  background: linear-gradient(180deg, #f8e3a0 0%, #f4c542 40%, #d19a1e 72%, #f4c542 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  // 凹凸（clip:text 下 text-shadow 会重影，用链式 drop-shadow 代替）：
  // 上沿暗（凹进去的上侧吃不到光）→ 下沿亮（凹进去的下侧被照亮）→ 整字在凹盘里的投影
  filter:
    drop-shadow(0 -1rpx 1rpx rgba(52, 8, 5, 0.85))
    drop-shadow(0 2rpx 2rpx rgba(255, 232, 170, 0.45))
    drop-shadow(0 2rpx 3rpx rgba(52, 8, 5, 0.55));
}

// 地区 / 视角小标签（列表 meta 行）
.rs-tag { font-size: 20rpx; padding: 2rpx 10rpx; border-radius: 6rpx; }
.rs-tag--region { color: #a08ade; background: rgba(160, 138, 222, 0.14); }
.rs-tag--persp { color: $rf-amber; background: rgba(212, 175, 55, 0.12); }

// 筛选条（集成在 Head 区）—— 一行：日期 pill + 机构 pill + 只看推荐 + 只看海外机构研报（无边框）
.rs-filter-bar { margin: 0 0 12rpx; padding: 0 2rpx; background: transparent; border: none; }
.rs-filter-row { display: flex; align-items: center; gap: 12rpx; flex-wrap: nowrap; }
.rs-filter-item { display: flex; align-items: center; gap: 6rpx; flex: 0 0 auto; min-width: 0; }
.rs-filter-item--switch { flex: 0 0 auto; min-width: 0; justify-content: flex-end; align-items: center; gap: 8rpx; padding: 0; }
.rs-filter-item--switch .rs-filter-switch-label { flex: 0 0 auto; }
.rs-filter-label { font-size: 20rpx; color: $app-text-muted; flex: 0 0 auto; }
// 触发底部菜单的 pill 按钮：和现有 card 配色融合
.rs-filter-pill { display: inline-flex; align-items: center; gap: 4rpx; padding: 6rpx 10rpx; min-height: 44rpx; background: linear-gradient(180deg, rgba(255, 184, 107, 0.10), rgba(255, 184, 107, 0.04)); border: 1rpx solid rgba(255, 184, 107, 0.28); border-radius: 8rpx; box-sizing: border-box; box-shadow: inset 0 -1rpx 0 rgba(0, 0, 0, 0.18), 0 1rpx 2rpx rgba(0, 0, 0, 0.15); transition: all 0.15s; }
.rs-filter-pill:active { transform: translateY(1rpx); box-shadow: inset 0 1rpx 2rpx rgba(0, 0, 0, 0.22); }
.rs-filter-pill-text { font-size: 22rpx; color: $app-text; font-weight: 500; white-space: nowrap; }
.rs-filter-pill-caret { font-size: 16rpx; color: $rf-amber; }

// 复选框（替代 switch）：未选中时灰色阴影、选中时橙金渐变 + 立体感
.rs-checkbox { width: 36rpx; height: 36rpx; min-width: 36rpx; border-radius: 8rpx; background: linear-gradient(180deg, #2a3a4a, #1a2532); border: 1rpx solid rgba(255, 255, 255, 0.12); box-shadow: inset 0 1rpx 2rpx rgba(0, 0, 0, 0.5), 0 1rpx 2rpx rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; transition: all 0.2s; }
.rs-checkbox--on { background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%); border-color: transparent; box-shadow: 0 2rpx 8rpx rgba(255, 122, 61, 0.45), inset 0 1rpx 0 rgba(255, 255, 255, 0.35); }
.rs-checkbox-tick { color: $color-bg; font-size: 24rpx; font-weight: 800; line-height: 1; }
.rs-filter-switch-label { font-size: 22rpx; color: $app-text; flex: 0 0 auto; white-space: nowrap; }

// 折叠屏 (>= 600px) 强制单行
@media (min-width: 600px) {
  .rs-filter-row { flex-wrap: nowrap; }
  .rs-filter-item--switch { flex: 0 0 auto; margin-left: auto; justify-content: flex-start; }
}

// 底部搜索栏（Tab 2 持仓和自选个股研报）：fixed 贴在 tabBar 正上方，不被列表覆盖
// H5：bottom = tabBar 高度（110rpx + safe-area），与自定义 tabBar 精确衔接、点击不被拦截
.rs-mine-bottom-bar { display: flex; align-items: center; gap: 10rpx; padding: 14rpx 12rpx calc(14rpx + env(safe-area-inset-bottom, 0)); background: $app-bg; border-top: 1rpx solid $app-border; z-index: 20; }
/* #ifdef H5 */
.rs-mine-bottom-bar { position: fixed; left: 0; right: 0; bottom: calc(110rpx + env(safe-area-inset-bottom, 0)); }
/* #endif */
/* #ifndef H5 */
.rs-mine-bottom-bar { position: fixed; left: 0; right: 0; bottom: 0; }
/* #endif */
.rs-mine-search-input { flex: 1 1 0; min-width: 0; min-height: 60rpx; padding: 8rpx 12rpx; background: $color-bg; border: 1rpx solid $app-border; border-radius: $radius-md; color: $app-text; font-size: 24rpx; box-sizing: border-box; }
.rs-mine-date-btn { flex: 0 0 auto; }
.rs-mine-search-btn { flex: 0 0 110rpx; padding: 14rpx 8rpx; font-size: 26rpx; }

// AI 提取的结构化信息块（标的/行业/供应商/法规等）
.rs-extract { background: rgba(114, 247, 255, 0.04); border-radius: $radius-md; padding: 14rpx; }
.rs-extract-row { display: flex; gap: 10rpx; margin-bottom: 8rpx; align-items: flex-start; }
.rs-extract-row:last-child { margin-bottom: 0; }
.rs-extract-k { flex: 0 0 auto; font-size: 22rpx; color: #72f7ff; background: rgba(114, 247, 255, 0.10); padding: 2rpx 10rpx; border-radius: 6rpx; white-space: nowrap; }
.rs-extract-v { flex: 1; min-width: 0; font-size: 24rpx; line-height: 1.55; color: $app-text; word-break: break-word; }

// ============================================================
// 底部菜单 sheet（统一两个 tab 用）
// ============================================================
.rs-menu-mask { position: fixed; left: 0; right: 0; top: 0; bottom: 0; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(2px); z-index: 100; display: flex; align-items: flex-end; justify-content: center; animation: rsMenuFade 0.18s ease-out; }
@keyframes rsMenuFade { from { opacity: 0; } to { opacity: 1; } }
.rs-menu-sheet { width: 100%; max-width: 720rpx; max-height: 70vh; background: linear-gradient(180deg, #142233 0%, #0d1b2a 100%); border-top: 1rpx solid rgba(255, 184, 107, 0.3); border-radius: 24rpx 24rpx 0 0; box-shadow: 0 -8rpx 32rpx rgba(0, 0, 0, 0.55); padding: 0 0 env(safe-area-inset-bottom, 0); display: flex; flex-direction: column; animation: rsMenuSlide 0.22s cubic-bezier(0.2, 0.9, 0.3, 1); }
@keyframes rsMenuSlide { from { transform: translateY(40rpx); opacity: 0.5; } to { transform: translateY(0); opacity: 1; } }
.rs-menu-handle { width: 60rpx; height: 6rpx; background: rgba(255, 184, 107, 0.35); border-radius: 4rpx; margin: 12rpx auto 0; }
.rs-menu-header { display: flex; align-items: center; justify-content: space-between; padding: 18rpx 24rpx 12rpx; border-bottom: 1rpx dashed rgba(255, 184, 107, 0.18); }
.rs-menu-title { font-size: 28rpx; font-weight: 600; color: $app-text; letter-spacing: 1rpx; }
.rs-menu-close { width: 56rpx; height: 56rpx; min-width: 56rpx; border-radius: 50%; background: rgba(255, 184, 107, 0.08); border: 1rpx solid rgba(255, 184, 107, 0.25); display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
.rs-menu-close:active { transform: scale(0.92); background: rgba(255, 184, 107, 0.2); }
.rs-menu-close text { font-size: 36rpx; color: $rf-amber; line-height: 1; font-weight: 300; }
.rs-menu-scroll { flex: 1 1 auto; min-height: 0; padding: 8rpx 16rpx 16rpx; }
.rs-menu-item { display: flex; align-items: center; gap: 12rpx; padding: 20rpx 18rpx; min-height: 72rpx; border-radius: 12rpx; margin: 4rpx 0; background: transparent; border: 1rpx solid transparent; transition: all 0.15s; }
.rs-menu-item:active { background: rgba(255, 184, 107, 0.06); }
.rs-menu-item--active { background: linear-gradient(135deg, rgba(255, 184, 107, 0.18) 0%, rgba(255, 122, 61, 0.12) 100%); border-color: rgba(255, 184, 107, 0.45); box-shadow: 0 2rpx 8rpx rgba(255, 122, 61, 0.18); }
.rs-menu-item-label { flex: 1; min-width: 0; font-size: 26rpx; color: $app-text; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-menu-item--active .rs-menu-item-label { color: #fff4c0; font-weight: 600; }
.rs-menu-item-count { font-size: 22rpx; color: $app-text-muted; background: rgba(255, 184, 107, 0.08); padding: 4rpx 14rpx; border-radius: 999rpx; min-width: 56rpx; text-align: center; font-weight: 600; }
.rs-menu-item-count--active { background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%); color: $color-bg; }
.rs-menu-item-tick { font-size: 32rpx; color: $rf-amber; font-weight: 800; flex: 0 0 auto; }

// ─────────────────────────────────────────────────────────
// 折叠屏/平板专属（H5，宽 700~1400px）：整页左右双栏。
// 原理：rpx 按屏宽等比放大，折叠屏上字会变得过大；这里恢复直板机的
// 物理尺寸（px），并把 head 变成左侧竖导航栏、body 为右侧内容区。
// 直板机（< 700px）完全不命中，UI 不变。
// ─────────────────────────────────────────────────────────
@include fold-wide {
  .rs-page.h5-mode { flex-direction: row; }

  // 左栏 = head（标题 + 子tab + 筛选），竖排可滚
  .rs-head {
    flex: 0 0 250px;
    width: 250px;
    border-right: 1rpx solid $app-border;
    padding: 16rpx 14rpx 24rpx;
    overflow-y: auto;
  }
  .rs-title { font-size: 20px; letter-spacing: 1px; }
  .rs-meta { font-size: 11px; line-height: 1.5; }
  .rs-tabbar { flex-direction: column; gap: 8rpx; padding: 10rpx 0; }
  .rs-tab { padding: 10rpx 12rpx; font-size: 14px; border-radius: $radius-base; }
  .rs-filter-bar { margin: 4rpx 0 0; }
  .rs-filter-row { flex-direction: column; align-items: stretch; gap: 8rpx; flex-wrap: wrap; }
  .rs-filter-item { justify-content: space-between; }
  .rs-filter-item--switch { margin-left: 0; justify-content: space-between; }
  .rs-filter-item--switch .rs-filter-switch-label { flex: 0 0 auto; font-size: 12px; }
  .rs-filter-label { font-size: 11px; }
  .rs-filter-pill { padding: 4rpx 10rpx; }
  .rs-filter-pill-text { font-size: 13px; }
  .rs-checkbox { width: 18px; height: 18px; min-width: 18px; }
  .rs-checkbox-tick { font-size: 12px; }

  // 右栏 = 内容，恢复直板机字号
  .rs-body { flex: 1; min-width: 0; padding: 12px 14px 12px; }
  .rs-body--with-bar { padding-bottom: 12px; }
  .rs-report-title { font-size: 15px; line-height: 1.45; }
  .rs-report-chevron { font-size: 15px; }
  .rs-fx-org, .rs-fx-date, .rs-fx-pages { font-size: 11px; }
  .rs-ai-badge { font-size: 10px; }
  .rs-tag { font-size: 10px; padding: 1px 7px; }
  .rs-tldr-label, .rs-block-label { font-size: 12px; }
  .rs-tldr-body { font-size: 14px; line-height: 1.6; }
  .rs-li { font-size: 13.5px; }
  .rs-section-title { font-size: 15px; }
  .rs-note { font-size: 12px; }
  .rs-btn { font-size: 13px; min-height: 34px; padding: 8px 14px; }
  .rs-loadmore { font-size: 12px; }
  .rs-empty { font-size: 13px; }
  .rs-mine-search-input { min-height: 34px; font-size: 12px; }
  .rs-mine-search-btn { min-height: 34px; font-size: 13px; }
}
</style>
