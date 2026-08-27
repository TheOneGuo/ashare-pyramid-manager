<template>
  <view class="rs-page" :class="{ 'h5-mode': isH5 }">
    <TabBarComp v-if="isH5" />
    <!-- 固定在顶部的 head 区：标题 + 两个子 tab -->
    <view class="rs-head">
    <view class="rs-header">
      <text class="rs-title">AI 研报</text>
      <text class="rs-meta">引入外部研报 · AI 精读提炼 · 已持仓标的逐标分析</text>
    </view>

    <!-- 三个子 tab -->
    <view class="rs-tabbar">
      <view class="rs-tab" :class="{ 'rs-tab--active': tab === 'refine' }" @tap="tab = 'refine'">
        <text>研报 AI 精读提炼</text>
      </view>
      <view class="rs-tab" :class="{ 'rs-tab--active': tab === 'held' }" @tap="tab = 'held'">
        <text>持仓标的 AI 研报分析</text>
      </view>
      <view class="rs-tab" :class="{ 'rs-tab--active': tab === 'fxbaogao' }" @tap="onSwitchFxbaogao">
        <text>🔍 发现报告</text>
      </view>
    </view>
    </view>

    <!-- 可滚动内容区（滚动条仅在此区域内） -->
    <view class="rs-body">
    <!-- Tab 1：研报 AI 精读提炼（统一列表：fxbaogao 自动拉取 + 持仓相关） -->
    <view v-if="tab === 'refine'" class="rs-pane">
      <view class="rs-card">
        <text class="rs-section-title">📚 研报精读列表</text>
        <text class="rs-note rs-note--muted">为持仓自动拉取卖方研报（高盛/摩根/瑞银/华泰/中金 等 30+ 家）。点击展开看 AI 精读；点「查看原文」打开 PDF / Markdown 排版。涉及半导体/生物制药/新能源/航空航天/关键原材料的研报标⭐推荐。</text>

        <view class="rs-row">
          <view class="rs-fx-time">
            <view
              v-for="t in FX_TIME_RANGES"
              :key="t.value"
              class="rs-fx-time-pill"
              :class="{ active: listTimeRange === t.value }"
              @tap="listTimeRange = t.value"
            >
              <text>{{ t.label }}</text>
            </view>
          </view>
        </view>

        <view class="rs-actions">
          <view class="rs-btn rs-btn--primary" hover-class="rs-btn--hover" @tap="onLoadListReports" :class="{ 'rs-btn--loading': listLoading }">
            <text>{{ listLoading ? '拉取中…' : '📥 拉取持仓相关研报' }}</text>
          </view>
          <view class="rs-btn rs-btn--ghost" hover-class="rs-btn--hover" @tap="listRecommendedOnly = !listRecommendedOnly" :class="{ 'rs-btn--active': listRecommendedOnly }">
            <text>{{ listRecommendedOnly ? '⭐ 仅看推荐' : '显示全部' }}</text>
          </view>
        </view>
      </view>

      <view v-if="listError" class="rs-empty">
        <text>⚠️ {{ listError }}</text>
        <text class="rs-note rs-note--muted">请确认 server/.env 里的 FXBAOGAO_API_KEY 已配置。</text>
      </view>
      <view v-else-if="listLoading" class="rs-empty"><text>正在拉取持仓相关研报…</text></view>
      <view v-else-if="filteredListReports.length === 0 && listSearched" class="rs-empty"><text>该时间范围下未发现持仓相关研报</text></view>
      <view v-else-if="!listReportItems.length" class="rs-empty"><text>点上方「拉取持仓相关研报」开始</text></view>

      <!-- 列表：每条标准格式 -->
      <view v-for="r in filteredListReports" :key="r.key" class="rs-card rs-report-card">
        <view class="rs-report-head" @tap="toggleListExpand(r.key)">
          <view class="rs-report-head-main">
            <view class="rs-report-title-row">
              <text class="rs-report-title">{{ r.title }}</text>
              <text v-if="r.recommended" class="rs-rec-badge">⭐ 推荐</text>
            </view>
            <view class="rs-fx-row-meta">
              <text class="rs-fx-org">{{ r.broker || r.orgName }}</text>
              <text class="rs-fx-date">{{ r.pubDate }}</text>
              <text v-if="r.holdingCode" class="rs-fx-pages">· 关联 {{ r.holdingName || r.holdingCode }}</text>
            </view>
            <view v-if="r.categories && r.categories.length" class="rs-cat-pills">
              <text v-for="c in r.categories" :key="c" class="rs-cat-pill">{{ c }}</text>
            </view>
          </view>
          <text class="rs-report-chevron">{{ listExpanded.has(r.key) ? '▾' : '▸' }}</text>
        </view>

        <view v-if="listExpanded.has(r.key)" class="rs-report-body">
          <!-- AI 精读 -->
          <view v-if="listIngesting === r.key" class="rs-empty"><text>AI 精读中（PDF 下载 + LLM 提炼）…</text></view>
          <view v-else-if="listIngestedMap[r.key]" class="rs-tldr">
            <text class="rs-tldr-label">✦ 一句话精读</text>
            <text class="rs-tldr-body">{{ listIngestedMap[r.key].tldr }}</text>
          </view>
          <view v-else class="rs-tldr" style="opacity:0.7">
            <text class="rs-tldr-label">✦ AI 精读</text>
            <text class="rs-tldr-body">点下方「一键 AI 精读」下载 PDF + 提炼关键信息</text>
          </view>

          <view v-if="listIngestedMap[r.key]?.key_points?.length" class="rs-block">
            <text class="rs-block-label">📌 核心观点（关键信息）</text>
            <view v-for="(p, i) in listIngestedMap[r.key].key_points" :key="i" class="rs-li"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
          </view>

          <view v-if="listIngestedMap[r.key]?.opportunities?.length" class="rs-block">
            <text class="rs-block-label">💡 产生的影响 / 新机会</text>
            <view v-for="(p, i) in listIngestedMap[r.key].opportunities" :key="i" class="rs-li"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
          </view>

          <view v-if="listIngestedMap[r.key]?.risks?.length" class="rs-block">
            <text class="rs-block-label rs-block-label--risk">⚠️ 风险点</text>
            <view v-for="(p, i) in listIngestedMap[r.key].risks" :key="i" class="rs-li rs-li--risk"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
          </view>

          <view v-if="listIngestedMap[r.key] && !listIngestedMap[r.key].llm_used" class="rs-note rs-note--muted">本结果由本地 mock 兜底生成（未配 LLM 或 LLM 调用失败）。</view>
          <view v-else-if="listIngestedMap[r.key]?.llm_used" class="rs-note rs-note--muted">由 LLM (MiniMax-M3) 提炼生成</view>

          <!-- 操作区 -->
          <view class="rs-actions">
            <view
              class="rs-btn rs-btn--primary"
              hover-class="rs-btn--hover"
              :class="{ 'rs-btn--loading': listIngesting === r.key }"
              @tap="onListIngest(r)"
            >
              <text>{{ listIngesting === r.key ? 'AI 精读中…' : (listIngestedMap[r.key] ? '🔄 重读研报' : '✦ 一键 AI 精读') }}</text>
            </view>
            <view class="rs-btn rs-btn--ghost" hover-class="rs-btn--hover" @tap="onListViewOriginal(r)">
              <text>↗ 查看原文</text>
            </view>
          </view>

          <!-- 查看原文 modal（txt 格式化 / PDF 链接 + 下载） -->
          <view v-if="listOriginalOpen === r.key" class="rs-original-modal">
            <view class="rs-original-head">
              <text>原文 · {{ listIngestedMap[r.key] ? 'JSON 格式化' : 'PDF 链接' }}</text>
              <text class="rs-report-del" @tap="listOriginalOpen = ''">✕ 关闭</text>
            </view>
            <view v-if="listIngestedMap[r.key]" class="rs-original-md">
              <text class="rs-md-block">{{ listIngestedMap[r.key]._markdown || '加载中…' }}</text>
            </view>
            <view v-else class="rs-original-md">
              <text class="rs-md-block">点击下方「获取 PDF 直链」后用浏览器打开（fxbaogao 直链 24h 有效）。</text>
              <view v-if="listPdfMap[r.key]?.url" class="rs-original-link" @tap="onCopyText(listPdfMap[r.key].url)">
                <text class="rs-fx-download-url">{{ listPdfMap[r.key].url }}</text>
              </view>
              <view v-else class="rs-btn rs-btn--ghost" @tap="onListGetPdf(r)">
                <text>获取 PDF 直链</text>
              </view>
            </view>
            <!-- 底部中心下载按钮 -->
            <view class="rs-original-foot">
              <view class="rs-btn rs-btn--primary rs-btn--block" @tap="onListDownload(r)">
                <text>⬇ 下载到本地</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- Tab 2：持仓标的 AI 研报分析 -->
    <view v-else-if="tab === 'held'" class="rs-pane">
      <view class="rs-card">
        <text class="rs-section-title">📊 持仓标的 AI 研报分析</text>
        <text class="rs-note rs-note--muted">对当前持仓列表中的标的，逐一点击「生成 AI 研报」即可按十二个研究模块生成完整研报，生成后可按章节阅读（当前为演示模式，后续接入真实 LLM）。</text>

        <view v-if="focusCode" class="rs-held-focus">
          <text>来自持仓页聚焦：</text><text class="rs-held-focus-code">{{ focusName }}（{{ focusCode }}）</text>
          <text class="rs-held-focus-clear" @tap="clearFocus">✕ 取消</text>
        </view>

        <view v-if="holdings.length === 0" class="rs-empty"><text>暂无持仓。请先到「持仓」页面导入或手动输入持仓。</text></view>

        <view v-else class="rs-held-list">
          <view v-for="h in holdings" :key="h.stock_code" class="rs-held-row">
            <view class="rs-held-info">
              <text class="rs-held-name">{{ h.short_name || h.stock_code }}</text>
              <text class="rs-held-code">{{ h.stock_code }}</text>
            </view>
            <view class="rs-btn rs-btn--primary rs-held-gen" hover-class="rs-btn--hover" @tap="onGenStock(h.stock_code)" :class="{ 'rs-btn--loading': stockLoading === h.stock_code }">
              <text>{{ hasStockReport(h.stock_code) ? '重读研报' : '生成 AI 研报' }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-for="it in stockReports" :key="it.stock_code" class="rs-card rs-report-card">
        <view class="rs-report-head" @tap="toggleStockExpand(it.stock_code)">
          <view class="rs-report-head-main">
            <text class="rs-report-title">{{ it.report?.stock_name }} · {{ it.stock_code }}</text>
            <text class="rs-report-meta">综合评级：{{ it.report?.rating }}</text>
          </view>
          <text class="rs-report-chevron">{{ stockExpanded.has(it.stock_code) ? '▾' : '▸' }}</text>
        </view>

        <view v-if="stockExpanded.has(it.stock_code) && it.report" class="rs-report-body">
          <text class="rs-tldr-body">{{ it.report.overall }}</text>
          <view v-for="(m, i) in it.report.modules" :key="i" class="rs-module">
            <view class="rs-module-head">
              <text class="rs-module-no">{{ i + 1 }}</text>
              <text class="rs-module-title">{{ m.title }}</text>
              <text v-if="m.verdict" class="rs-module-verdict">· {{ m.verdict }}</text>
            </view>
            <text class="rs-module-summary">{{ m.summary }}</text>
            <view v-if="m.points && m.points.length" class="rs-module-points">
              <view v-for="(p, j) in m.points" :key="j" class="rs-li"><text class="rs-dot">·</text><text>{{ p }}</text></view>
            </view>
          </view>
          <text class="rs-disclaimer">{{ it.report.disclaimer }}</text>
        </view>
      </view>
    </view>

    <view class="rs-disclaimer-bar">
      <text>AI 生成内容不构成投资建议；研报数据来自发现报告（fxbaogao.com），仅供参考。</text>
    </view>
    </view>

    <!-- Tab 3：发现报告 (fxbaogao) 搜索 + AI 精读 + 下载 -->
    <view v-if="tab === 'fxbaogao'" class="rs-pane">
      <view class="rs-card">
        <text class="rs-section-title">🔍 发现报告（fxbaogao.com）</text>
        <text class="rs-note rs-note--muted">覆盖外资行（高盛 / 摩根 / 瑞银 / 美银 / 花旗 / 汇丰）、内资卖方（华泰 / 中金 / 招商 等）的行业研究、公司点评与宏观策略，每日更新。{{ fxbaogaoStatus ? '当前 API：' + fxbaogaoStatus : '' }}</text>

        <view class="rs-row">
          <input class="rs-input rs-input--sm" v-model="fxKeywords" placeholder="关键词（代码 / 名称 / 行业）" :disabled="fxLoading" />
          <view class="rs-fx-time">
            <view
              v-for="t in FX_TIME_RANGES"
              :key="t.value"
              class="rs-fx-time-pill"
              :class="{ active: fxTimeRange === t.value }"
              @tap="fxTimeRange = t.value"
            >
              <text>{{ t.label }}</text>
            </view>
          </view>
        </view>

        <view class="rs-actions">
          <view class="rs-btn rs-btn--primary" hover-class="rs-btn--hover" @tap="onFxSearch" :class="{ 'rs-btn--loading': fxLoading }">
            <text>{{ fxLoading ? '搜索中…' : '✦ 搜索' }}</text>
          </view>
          <view class="rs-btn rs-btn--ghost" hover-class="rs-btn--hover" @tap="onFxAutoSearch" :class="{ 'rs-btn--loading': fxAutoLoading }">
            <text>{{ fxAutoLoading ? '为持仓搜索中…' : '📊 为持仓搜卖方' }}</text>
          </view>
        </view>
      </view>

      <!-- 为持仓搜的结果 -->
      <view v-if="fxAutoResults.length" class="rs-card">
        <text class="rs-section-title">📊 持仓卖方研报速览</text>
        <view v-for="g in fxAutoResults" :key="g.code" class="rs-fx-group">
          <view class="rs-fx-group-head">
            <text class="rs-fx-group-name">{{ g.name || g.code }} · {{ g.code }}</text>
            <text class="rs-fx-group-count">找到 {{ g.count }} 篇</text>
          </view>
          <view v-if="g.error" class="rs-note rs-note--warn">⚠️ {{ g.error }}</view>
          <view v-else-if="g.count === 0" class="rs-empty"><text>最近 {{ fxTimeRange }} 未发现卖方研报</text></view>
          <view v-else class="rs-fx-group-list">
            <view v-for="it in g.items.slice(0, 3)" :key="it.reportId" class="rs-fx-row-mini" @tap="openFxDetail(it)">
              <text class="rs-fx-row-mini-title">{{ it.title }}</text>
              <view class="rs-fx-row-mini-meta">
                <text class="rs-fx-org">{{ it.orgName }}</text>
                <text class="rs-fx-date">{{ it.pubTimeStr }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 搜索结果 -->
      <view v-if="fxLoading" class="rs-empty"><text>正在搜索发现报告…</text></view>
      <view v-else-if="fxError" class="rs-empty">
        <text>⚠️ {{ fxError }}</text>
        <text class="rs-note rs-note--muted">请确认 server/.env 里的 FXBAOGAO_API_KEY 已配置且有高级 VIP 权限。</text>
      </view>
      <view v-else-if="fxItems.length === 0 && fxSearched" class="rs-empty"><text>没有匹配的研报，换个关键词试试</text></view>
      <view v-else-if="!fxItems.length" class="rs-empty"><text>在搜索框输入关键词，或点「为持仓搜卖方」</text></view>

      <view v-for="r in fxItems" :key="r.reportId" class="rs-card rs-report-card">
        <view class="rs-report-head" @tap="toggleFxExpand(r.reportId)">
          <view class="rs-report-head-main">
            <text class="rs-report-title">{{ r.title }}</text>
            <view class="rs-fx-row-meta">
              <text class="rs-fx-org">{{ r.orgName || '未知机构' }}</text>
              <text class="rs-fx-date">{{ r.pubTimeStr }}</text>
              <text class="rs-fx-pages">{{ r.pageNum }} 页</text>
            </view>
          </view>
          <text class="rs-report-chevron">{{ fxExpanded.has(r.reportId) ? '▾' : '▸' }}</text>
        </view>

        <view v-if="fxExpanded.has(r.reportId)" class="rs-report-body">
          <!-- 详情摘要 -->
          <view v-if="fxDetailLoading === r.reportId" class="rs-empty"><text>加载摘要…</text></view>
          <view v-else-if="fxDetailMap[r.reportId]?.summary" class="rs-tldr">
            <text class="rs-tldr-label">✦ 摘要（发现报告直供）</text>
            <text class="rs-tldr-body">{{ fxDetailMap[r.reportId].summary }}</text>
          </view>
          <view v-else class="rs-tldr">
            <text class="rs-tldr-label">✦ 摘要</text>
            <text class="rs-tldr-body" style="opacity:0.7">该报告未建立段落索引；点「AI 精读」下载 PDF 抽全文分析。</text>
          </view>

          <!-- 命中段 -->
          <view v-if="fxDetailMap[r.reportId]?.hits?.length" class="rs-block">
            <text class="rs-block-label">📌 命中段落</text>
            <view v-for="(h, i) in fxDetailMap[r.reportId].hits.slice(0, 3)" :key="i" class="rs-li">
              <text class="rs-dot">·</text>
              <text class="rs-li-text">{{ (h?.content || h?.text || JSON.stringify(h)).slice(0, 280) }}{{ (h?.content || h?.text || '').length > 280 ? '…' : '' }}</text>
            </view>
          </view>

          <!-- 操作按钮区 -->
          <view class="rs-actions">
            <view
              class="rs-btn rs-btn--primary"
              hover-class="rs-btn--hover"
              :class="{ 'rs-btn--loading': fxIngesting === r.reportId }"
              @tap="onFxIngest(r)"
            >
              <text>{{ fxIngesting === r.reportId ? 'AI 精读中…' : '✦ AI 精读入库' }}</text>
            </view>
            <view class="rs-btn rs-btn--ghost" hover-class="rs-btn--hover" @tap="onFxView(r)">
              <text>↗ 查看原文</text>
            </view>
          </view>

          <view class="rs-fx-download">
            <text class="rs-fx-download-label">📥 下载到本地</text>
            <view v-if="fxPdfMap[r.reportId]?.loading" class="rs-fx-download-loading"><text>正在生成直链…</text></view>
            <view v-else-if="fxPdfMap[r.reportId]?.url" class="rs-fx-download-link" @tap="onFxCopy(fxPdfMap[r.reportId].url)">
              <text class="rs-fx-download-url">{{ fxPdfMap[r.reportId].url.slice(0, 72) }}…</text>
              <text class="rs-fx-download-hint">点击复制 · 可粘贴到浏览器下载</text>
            </view>
            <view v-else class="rs-btn rs-btn--ghost" hover-class="rs-btn--hover" @tap="onFxGetPdf(r)">
              <text>获取 PDF 直链</text>
            </view>
          </view>

          <!-- 入库后的状态 -->
          <view v-if="fxIngestedMap[r.reportId]" class="rs-block">
            <text class="rs-block-label">✅ 已入库（status: {{ fxIngestedMap[r.reportId].status }}）</text>
            <text class="rs-tldr-body">{{ fxIngestedMap[r.reportId].tldr }}</text>
            <view v-if="fxIngestedMap[r.reportId].key_points?.length" class="rs-block">
              <text class="rs-block-label">核心观点</text>
              <view v-for="(p, i) in fxIngestedMap[r.reportId].key_points" :key="i" class="rs-li"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
            </view>
            <view v-if="fxIngestedMap[r.reportId].risks?.length" class="rs-block">
              <text class="rs-block-label rs-block-label--risk">⚠️ 风险</text>
              <view v-for="(p, i) in fxIngestedMap[r.reportId].risks" :key="i" class="rs-li rs-li--risk"><text class="rs-dot">·</text><text class="rs-li-text">{{ p }}</text></view>
            </view>
            <view v-if="!fxIngestedMap[r.reportId].llm_used" class="rs-note rs-note--muted">本结果由本地 mock 兜底生成（未配 LLM_API_KEY 或 LLM 调用失败）。配 LLM 后会自动切换 DeepSeek 精读。</view>
            <view v-else class="rs-note rs-note--muted">由 LLM (DeepSeek) 精读生成</view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
// H5 端手动挂载自定义 tabBar（WeChat 端由 custom:true 自动挂载，此处按条件跳过）
const isH5 = ref(typeof window !== 'undefined')
import TabBarComp from '@/custom-tab-bar/index.vue'
import {
  ingestReport, listReports, deleteReport,
  listHoldings, researchReport, saveStockReport, listStockReports, deleteStockReport,
  searchFxbaogao, getFxbaogaoParagraphs, getFxbaogaoPdfUrl, ingestFxbaogaoReport,
  autoSearchFxbaogaoForHoldings, getFxbaogaoStatus,
  listHoldingReports, deepSearchForHoldings,
  type RefinedReport, type Holding, type StockReportItem, type ResearchReport,
  type FxbaogaoReport, type FxbaogaoAutoSearchItem,
  type HoldingReportItem, type DeepSearchByTopic,
} from '@/api/portfolio'

const tab = ref<'refine' | 'held' | 'fxbaogao'>('refine')

// Tab1 输入（已弃用手填表单，保留 ingest 函数供 fxbaogao ingest 复用）
const inTitle = ref('')
const inBroker = ref('')
const inIndustry = ref('')
const inUrl = ref('')
const inRaw = ref('')
const ingesting = ref(false)
const reports = ref<RefinedReport[]>([])
const expanded = ref<Set<string>>(new Set())
const showRaw = ref<Set<string>>(new Set())
const fileInput = ref<any>(null)

// Tab1 统一列表（新）
const FX_TIME_RANGES = [
  { value: 'last7day', label: '7天' },
  { value: 'last1mon', label: '1月' },
  { value: 'last3mon', label: '3月' },
  { value: 'last1year', label: '1年' },
]
const listTimeRange = ref('last1mon')
const listLoading = ref(false)
const listSearched = ref(false)
// 统一列表数据（避免和 api.listReports 同名）
const listReportItems = ref<HoldingReportItem[]>([])
const listExpanded = ref<Set<string>>(new Set())
const listIngestedMap = ref<Record<string, any>>({})
const listIngesting = ref<string>('')
const listPdfMap = ref<Record<string, { url: string; loading?: boolean }>>({})
const listOriginalOpen = ref<string>('')
const listError = ref('')
const listRecommendedOnly = ref(false)

const filteredListReports = computed(() => {
  if (!listRecommendedOnly.value) return listReportItems.value
  return listReportItems.value.filter((r) => r.recommended)
})

// Tab2
const holdings = ref<Holding[]>([])
const stockLoading = ref<string>('')
const stockReports = ref<StockReportItem[]>([])
const stockExpanded = ref<Set<string>>(new Set())
const focusCode = ref<string>('')
const focusName = ref<string>('')

function toggleExpand(id: string) {
  const s = new Set(expanded.value); if (s.has(id)) s.delete(id); else s.add(id); expanded.value = s
}
function toggleRaw(id: string) {
  const s = new Set(showRaw.value); if (s.has(id)) s.delete(id); else s.add(id); showRaw.value = s
}
function toggleStockExpand(code: string) {
  const s = new Set(stockExpanded.value); if (s.has(code)) s.delete(code); else s.add(code); stockExpanded.value = s
}

function applyFocusFromStorage() {
  const code = uni.getStorageSync('portfolio_focus_code')
  const name = uni.getStorageSync('portfolio_focus_name')
  if (code) {
    focusCode.value = String(code).padStart(6, '0').slice(-6)
    focusName.value = name || code
  } else { focusCode.value = ''; focusName.value = '' }
}
function clearFocus() { focusCode.value = ''; focusName.value = ''; uni.removeStorageSync('portfolio_focus_code') }
function hasStockReport(code: string) {
  return stockReports.value.some((r) => r.stock_code === code)
}

function formatDate(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function onIngest() {
  const raw = inRaw.value.trim()
  if (!raw) { uni.showToast({ title: '请先粘贴或上传研报原文', icon: 'none' }); return }
  ingesting.value = true
  try {
    const r = await ingestReport({
      title: inTitle.value.trim(),
      broker: inBroker.value.trim(),
      industry: inIndustry.value.trim(),
      source_url: inUrl.value.trim(),
      raw_text: raw,
    })
    reports.value = [r, ...reports.value.filter((x) => x.id !== r.id)]
    inRaw.value = ''
    inTitle.value = ''; inBroker.value = ''; inIndustry.value = ''; inUrl.value = ''
    uni.showToast({ title: '精读完成', icon: 'success' })
  } catch (e: any) {
    uni.showToast({ title: e?.message || '精读失败', icon: 'none' })
  } finally {
    ingesting.value = false
  }
}

function readFileText(file: any) {
  const reader = new FileReader()
  reader.onload = () => { inRaw.value = String(reader.result || '') }
  reader.readAsText(file)
}
function onPickFile() {
  // H5：原生 file input
  if (fileInput.value && fileInput.value.click) { fileInput.value.click(); return }
  // 微信小程序：从聊天会话选择文件
  if (typeof (uni as any).chooseMessageFile === 'function') {
    (uni as any).chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['txt', 'md', 'text'],
      success: (res: any) => { const f = res?.tempFiles?.[0]; if (f) readFileText(f) },
      fail: () => { uni.showToast({ title: '请直接粘贴原文', icon: 'none' }) },
    })
    return
  }
  uni.showToast({ title: '请直接粘贴原文', icon: 'none' })
}
function onFileChange(e: any) {
  const f = e?.target?.files?.[0]
  if (!f) return
  readFileText(f)
}

async function onDeleteReport(id: string) {
  try {
    await deleteReport(id)
    reports.value = reports.value.filter((r) => r.id !== id)
  } catch (e: any) { uni.showToast({ title: e?.message || '删除失败', icon: 'none' }) }
}

async function onGenStock(code: string) {
  const h = holdings.value.find((x) => x.stock_code === code)
  if (!h) return
  stockLoading.value = code
  try {
    const r: ResearchReport = await researchReport({ stock_code: code, stock_name: h.short_name || '' })
    await saveStockReport(code, h.short_name || '', r)
    const arr = stockReports.value.filter((x) => x.stock_code !== code)
    arr.unshift({ stock_code: code, stock_name: h.short_name || '', report: r, created_at: Date.now(), updated_at: Date.now() })
    stockReports.value = arr
    stockExpanded.value = new Set([code]) // 生成后自动展开
    uni.showToast({ title: '研报已生成', icon: 'success' })
  } catch (e: any) {
    uni.showToast({ title: e?.message || '生成失败', icon: 'none' })
  } finally {
    stockLoading.value = ''
  }
}

async function loadReports() {
  try { const r = await listReports(); reports.value = r.items || [] } catch (e) { /* ignore */ }
}
async function loadHoldings() {
  try { holdings.value = await listHoldings() } catch (e) { /* ignore */ }
}
async function loadStockReports() {
  try { const r = await listStockReports(); stockReports.value = r.items || [] } catch (e) { /* ignore */ }
}

// ── Tab 1：统一列表（fxbaogao 拉取 + AI 精读 + 查看原文 + 下载） ──
async function onLoadListReports() {
  if (listLoading.value) return
  if (!holdings.value.length) {
    uni.showToast({ title: '暂无持仓，请先到持仓页导入', icon: 'none' }); return
  }
  listLoading.value = true
  listError.value = ''
  listSearched.value = true
  try {
    const r = await listHoldingReports({
      holdings: holdings.value.map((h) => ({ stock_code: h.stock_code, short_name: h.short_name })),
      timeRange: listTimeRange.value,
      maxPerHolding: 3,
    })
    listReportItems.value = r.items || []
  } catch (e: any) {
    listError.value = e?.message || '拉取失败'
    listReportItems.value = []
  } finally {
    listLoading.value = false
  }
}

function toggleListExpand(key: string) {
  const s = new Set(listExpanded.value)
  if (s.has(key)) { s.delete(key) } else {
    s.add(key)
    // 第一次展开时如果没有精读过，自动拿 PDF 直链
    if (!listPdfMap.value[key]) void loadListPdf(key)
  }
  listExpanded.value = s
}

async function loadListPdf(key: string) {
  // key = "fx:reportId"
  const id = Number(key.split(':')[1])
  listPdfMap.value = { ...listPdfMap.value, [key]: { url: '', loading: true } }
  try {
    const r = await getFxbaogaoPdfUrl(id)
    if (r?.url) listPdfMap.value = { ...listPdfMap.value, [key]: { url: r.url, loading: false } }
  } catch {
    listPdfMap.value = { ...listPdfMap.value, [key]: { url: '', loading: false } }
  }
}

async function onListGetPdf(r: HoldingReportItem) {
  if (listPdfMap.value[r.key]?.url) return
  await loadListPdf(r.key)
}

async function onListIngest(r: HoldingReportItem) {
  if (listIngesting.value) return
  listIngesting.value = r.key
  uni.showLoading({ title: '下载 PDF + AI 精读' })
  try {
    const res = await ingestFxbaogaoReport({ reportId: r.reportId, industry: r.broker || '' })
    if (res?.ok && res.report) {
      const rep = res.report
      // 用后端 refinedToMarkdown 生成 Markdown（如果后端没生成，前端组装一份）
      const md = [
        `# ${rep.title || r.title}`,
        `**来源**：${rep.broker || r.broker}  ·  **行业**：${rep.industry || ''}  ·  **时间**：${r.pubDate}`,
        '',
        '## 一句话精读',
        rep.tldr || '',
        '',
        '## 核心观点',
        ...(rep.key_points || []).map((p: string, i: number) => `${i + 1}. ${p}`),
        '',
        '## 新机会',
        ...(rep.opportunities || []).map((p: string) => `- ${p}`),
        '',
        '## 风险点',
        ...(rep.risks || []).map((p: string) => `- ${p}`),
        '',
        '---',
        '*本内容由 AI 自动提炼，仅供参考，不构成投资建议。*',
      ].join('\n')
      listIngestedMap.value = { ...listIngestedMap.value, [r.key]: { ...rep, _markdown: md, llm_used: !!res.llm_used } }
      uni.showToast({ title: res.llm_used ? '已精读（LLM）' : '已精读（mock 兜底）', icon: 'success' })
    } else {
      uni.showToast({ title: res?.error || '精读失败', icon: 'none' })
    }
  } catch (e: any) {
    uni.showToast({ title: e?.message || '精读失败', icon: 'none' })
  } finally {
    listIngesting.value = ''
    uni.hideLoading()
  }
}

function onListViewOriginal(r: HoldingReportItem) {
  // H5: 优先 PDF 链接（如果已拿到），否则用 viewUrl
  const url = listPdfMap.value[r.key]?.url || r.viewUrl
  // #ifdef H5
  if (typeof window !== 'undefined') window.open(url, '_blank')
  // #endif
  // 同时打开 modal
  listOriginalOpen.value = r.key
}

function onCopyText(text: string) {
  uni.setClipboardData({ data: text, success: () => uni.showToast({ title: '链接已复制', icon: 'success' }) })
}

async function onListDownload(r: HoldingReportItem) {
  // 已有 PDF 直链 → 复制到剪贴板（H5 浏览器直接下载）
  // 已有精读 → 触发 Markdown 下载
  const ingested = listIngestedMap.value[r.key]
  if (ingested && ingested._markdown) {
    // 下载为 Markdown
    // #ifdef H5
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([ingested._markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(ingested.title || r.title || ('report-' + r.reportId)).replace(/[\\/:*?"<>|]/g, '_')}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      uni.showToast({ title: '已下载 Markdown', icon: 'success' })
      return
    }
    // #endif
    // #ifdef MP-WEIXIN
    uni.setClipboardData({ data: ingested._markdown, success: () => uni.showToast({ title: 'Markdown 已复制', icon: 'success' }) })
    return
    // #endif
  }
  // 否则：复制 PDF 直链（H5 浏览器可下载）
  const url = listPdfMap.value[r.key]?.url
  if (url) {
    onCopyText(url)
  } else {
    await loadListPdf(r.key)
    onCopyText(listPdfMap.value[r.key]?.url || r.viewUrl)
  }
}

// 旧的 fxbaogao ingest openFxDetail（被列表项复用）—— 保留供 fxbaogao tab 使用

// ── Tab 3：发现报告 fxbaogao ──
const fxKeywords = ref('')
const fxTimeRange = ref('last1mon')
const fxLoading = ref(false)
const fxSearched = ref(false)
const fxItems = ref<FxbaogaoReport[]>([])
const fxError = ref('')
const fxExpanded = ref<Set<number>>(new Set())
const fxDetailMap = ref<Record<number, { summary: string; hits: any[]; toc: any[]; raw: string }>>({})
const fxDetailLoading = ref<number>(0)
const fxPdfMap = ref<Record<number, { url: string; loading?: boolean }>>({})
const fxIngesting = ref<number>(0)
const fxIngestedMap = ref<Record<number, any>>({})
const fxAutoLoading = ref(false)
const fxAutoResults = ref<FxbaogaoAutoSearchItem[]>([])
const fxbaogaoStatus = ref('')

async function onSwitchFxbaogao() {
  tab.value = 'fxbaogao'
  if (!fxbaogaoStatus.value) {
    try {
      const s = await getFxbaogaoStatus()
      fxbaogaoStatus.value = s?.fxbaogao?.available ? `在线 (key: ${s.fxbaogao.keyTail})` : '未配置 API key'
    } catch (e: any) { fxbaogaoStatus.value = '探针失败' }
  }
}

async function onFxSearch() {
  if (fxLoading.value) return
  fxLoading.value = true
  fxError.value = ''
  fxSearched.value = true
  try {
    const r = await searchFxbaogao({ keywords: fxKeywords.value.trim(), startTime: fxTimeRange.value, pageNum: 1 })
    fxItems.value = r.items || []
  } catch (e: any) {
    fxError.value = e?.message || '搜索失败'
    fxItems.value = []
  } finally { fxLoading.value = false }
}

async function onFxAutoSearch() {
  if (fxAutoLoading.value) return
  if (!holdings.value.length) {
    uni.showToast({ title: '暂无持仓，请先到持仓页导入', icon: 'none' }); return
  }
  fxAutoLoading.value = true
  try {
    // 4 维度深度搜索：行业 / 供应商 / 购买方 / 法律法规
    const r = await deepSearchForHoldings({
      holdings: holdings.value.map((h) => ({ stock_code: h.stock_code, short_name: h.short_name })),
      topics: ['industry', 'supplier', 'buyer', 'regulation'],
      timeRange: fxTimeRange.value,
    })
    // 把 byTopic 拍平为 fxAutoResults（保持旧 UI 兼容）
    const flat: FxbaogaoAutoSearchItem[] = []
    for (const g of (r.results || [])) {
      const merged: HoldingReportItem[] = []
      for (const t of Object.keys(g.byTopic || {})) {
        for (const it of g.byTopic[t]) {
          if (!merged.find((x) => x.reportId === it.reportId)) merged.push(it)
        }
      }
      flat.push({ code: g.code, name: g.name, count: merged.length, items: merged as any })
    }
    fxAutoResults.value = flat
  } catch (e: any) {
    uni.showToast({ title: e?.message || '搜索失败', icon: 'none' })
  } finally { fxAutoLoading.value = false }
}

function toggleFxExpand(id: number) {
  const s = new Set(fxExpanded.value)
  if (s.has(id)) { s.delete(id) } else {
    s.add(id)
    // 第一次展开时拉详情 + PDF 直链
    if (!fxDetailMap.value[id] && fxDetailLoading.value !== id) {
      void loadFxDetail(id)
    }
    if (!fxPdfMap.value[id]) {
      void loadFxPdf(id)
    }
  }
  fxExpanded.value = s
}

async function loadFxDetail(id: number) {
  fxDetailLoading.value = id
  try {
    const r = await getFxbaogaoParagraphs({ reportId: id })
    fxDetailMap.value = { ...fxDetailMap.value, [id]: { summary: r.summary, hits: r.hits, toc: r.toc, raw: r.raw } }
  } catch (e) {
    fxDetailMap.value = { ...fxDetailMap.value, [id]: { summary: '（摘要获取失败）', hits: [], toc: [], raw: '' } }
  } finally { fxDetailLoading.value = 0 }
}

async function loadFxPdf(id: number) {
  fxPdfMap.value = { ...fxPdfMap.value, [id]: { url: '', loading: true } }
  try {
    const r = await getFxbaogaoPdfUrl(id)
    if (r?.url) fxPdfMap.value = { ...fxPdfMap.value, [id]: { url: r.url, loading: false } }
  } catch {
    fxPdfMap.value = { ...fxPdfMap.value, [id]: { url: '', loading: false } }
  }
}

async function onFxGetPdf(r: FxbaogaoReport) {
  if (fxPdfMap.value[r.reportId]?.url) return
  await loadFxPdf(r.reportId)
}

function onFxView(r: FxbaogaoReport) {
  // #ifdef H5
  if (typeof window !== 'undefined') window.open(r.viewUrl, '_blank')
  // #endif
  // #ifdef MP-WEIXIN
  uni.setClipboardData({ data: r.viewUrl, success: () => uni.showToast({ title: '链接已复制', icon: 'none' }) })
  // #endif
  // 兜底：复制链接
  uni.setClipboardData({ data: r.viewUrl, success: () => uni.showToast({ title: '原文链接已复制', icon: 'none' }) })
}

function onFxCopy(text: string) {
  uni.setClipboardData({ data: text, success: () => uni.showToast({ title: 'PDF 直链已复制', icon: 'success' }) })
}

function openFxDetail(r: FxbaogaoReport) {
  // 从「为持仓搜」列表点进来：填入搜索框 + 切到 search tab + 展开
  fxKeywords.value = r.title.split(/[：:]/)[0] || ''
  onFxSearch().then(() => {
    setTimeout(() => {
      const s = new Set(fxExpanded.value)
      s.add(r.reportId)
      fxExpanded.value = s
      if (!fxDetailMap.value[r.reportId]) void loadFxDetail(r.reportId)
      if (!fxPdfMap.value[r.reportId]) void loadFxPdf(r.reportId)
    }, 400)
  })
}

async function onFxIngest(r: FxbaogaoReport) {
  if (fxIngesting.value) return
  fxIngesting.value = r.reportId
  uni.showLoading({ title: '下载 PDF + AI 精读' })
  try {
    const res = await ingestFxbaogaoReport({ reportId: r.reportId, industry: r.orgName || '' })
    if (res?.ok && res.report) {
      fxIngestedMap.value = { ...fxIngestedMap.value, [r.reportId]: res.report }
      uni.showToast({ title: res.llm_used ? '已精读入库（LLM）' : '已入库（mock 兜底）', icon: 'success' })
    } else {
      uni.showToast({ title: res?.error || '精读失败', icon: 'none' })
    }
  } catch (e: any) {
    uni.showToast({ title: e?.message || '精读失败', icon: 'none' })
  } finally {
    fxIngesting.value = 0
    uni.hideLoading()
  }
}

onMounted(() => { loadReports(); loadHoldings(); loadStockReports() })
onShow(() => {
  loadHoldings(); loadStockReports()
  applyFocusFromStorage()
  if (focusCode.value) {
    const h = holdings.value.find((x) => (x.stock_code || '').padStart(6, '0').slice(-6) === focusCode.value)
    if (h && !hasStockReport(focusCode.value)) onGenStock(h.stock_code)
    else if (h) { const s = new Set(stockExpanded.value); s.add(focusCode.value); stockExpanded.value = s }
  }
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

.rs-page {
  min-height: 100vh;
  background: $app-bg;
  padding: $spacing-base;
  padding-bottom: 120rpx;
}

/* H5：页面作为包含 head(固定) + body(滚动) 的容器，止于 tab 上沿 */
.rs-page.h5-mode {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: calc(110rpx + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* head 区固定，不参与滚动 */
.rs-head {
  flex: 0 0 auto;
  padding: 16rpx 0 8rpx;
  background: $app-bg;
}
/* body 区滚动，右侧美化金色滚动条只在此处 */
.rs-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 $spacing-base $spacing-base;
}
.rs-body::-webkit-scrollbar { width: 5rpx; }
.rs-body::-webkit-scrollbar-track { background: transparent; }
.rs-body::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #fff4c0 0%, #f4c542 50%, #d89c1c 100%);
  border-radius: 6rpx;
}
.rs-body { scrollbar-width: thin; scrollbar-color: #d89c1c transparent; }
.rs-header { display: flex; flex-direction: column; padding: 16rpx 0 8rpx; margin-bottom: 8rpx; }
.rs-title { display: block; font-size: 44rpx; font-weight: 700; color: $color-text-primary; letter-spacing: 1rpx; }
.rs-meta { display: block; font-size: 22rpx; color: $color-text-secondary; margin-top: 8rpx; letter-spacing: 1rpx; }

.rs-tabbar { display: flex; gap: 12rpx; margin-bottom: $spacing-base; }
.rs-tab {
  flex: 1;
  text-align: center;
  padding: 20rpx 12rpx;
  border-radius: $radius-md;
  background: $app-card-bg;
  border: 1rpx solid $app-border;
  color: $app-text-muted;
  font-size: 26rpx;
  box-sizing: border-box;
}
.rs-tab--active {
  background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%);
  color: $color-bg;
  border-color: transparent;
  font-weight: 600;
}

.rs-card {
  background: $app-card-bg;
  border-radius: $radius-lg;
  padding: $spacing-base;
  border: 1rpx solid $app-border;
  margin-bottom: $spacing-base;
}
.rs-section-title { display: block; font-size: 32rpx; font-weight: 600; color: $app-text; margin-bottom: 10rpx; }
.rs-note { display: block; font-size: 24rpx; line-height: 1.6; margin-bottom: 16rpx; }
.rs-note--muted { color: $app-text-muted; }

.rs-row { display: flex; gap: 12rpx; margin-bottom: 12rpx; }
.rs-input {
  flex: 1;
  min-height: 72rpx;
  padding: 12rpx 18rpx;
  background: $color-bg;
  border: 1rpx solid $app-border;
  border-radius: $radius-md;
  color: $app-text;
  font-size: 26rpx;
  box-sizing: border-box;
}
.rs-input--sm { flex: 1; }
.rs-textarea {
  width: 100%;
  min-height: 240rpx;
  padding: 16rpx 18rpx;
  background: $color-bg;
  border: 1rpx solid $app-border;
  border-radius: $radius-md;
  color: $app-text;
  font-size: 26rpx;
  line-height: 1.6;
  box-sizing: border-box;
  margin-bottom: 16rpx;
}
.rs-actions { display: flex; gap: 12rpx; }
.rs-btn {
  flex: 1;
  text-align: center;
  padding: 20rpx 12rpx;
  border-radius: $radius-md;
  font-size: 28rpx;
  box-sizing: border-box;
}
.rs-btn--ghost { background: $app-card-bg; border: 1rpx solid $app-border; color: $app-text; }
.rs-btn--primary { background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%); color: $color-bg; font-weight: 600; }
.rs-btn--hover { opacity: 0.85; }
.rs-btn--loading { opacity: 0.6; }

.rs-empty { padding: 80rpx 20rpx; text-align: center; color: $app-text-muted; font-size: 26rpx; line-height: 1.7; }

.rs-report-card { }
.rs-report-head { display: flex; justify-content: space-between; align-items: center; gap: 12rpx; }
.rs-report-head-main { min-width: 0; flex: 1; }
.rs-report-title { display: block; font-size: 30rpx; font-weight: 600; color: $app-text; }
.rs-report-meta { display: block; font-size: 22rpx; color: $app-text-muted; margin-top: 4rpx; }
.rs-report-chevron { font-size: 32rpx; color: $rf-amber; }
.rs-report-body { margin-top: 16rpx; border-top: 1rpx dashed $app-border; padding-top: 16rpx; }

.rs-tldr { background: rgba(212, 175, 55, 0.08); border-radius: $radius-md; padding: 16rpx; margin-bottom: 16rpx; }
.rs-tldr-label { display: block; font-size: 24rpx; color: $rf-amber; margin-bottom: 6rpx; font-weight: 500; }
.rs-tldr-body { display: block; font-size: 28rpx; line-height: 1.6; color: $app-text; }

.rs-block { margin-top: 16rpx; }
.rs-block-label { display: block; font-size: 26rpx; color: $rf-amber; margin-bottom: 8rpx; font-weight: 500; }
.rs-block-label--link { color: $app-text-muted; font-size: 24rpx; }
.rs-li { display: flex; gap: 8rpx; font-size: 27rpx; line-height: 1.6; color: $app-text; margin-bottom: 4rpx; }
.rs-li--risk { color: #ff9a8a; }
.rs-dot { color: $rf-amber; }
.rs-raw { display: block; font-size: 24rpx; line-height: 1.6; color: $app-text-muted; white-space: pre-wrap; margin-top: 8rpx; max-height: 600rpx; overflow: auto; }

.rs-report-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 16rpx; }
.rs-report-time { font-size: 22rpx; color: $app-text-muted; }
.rs-report-del { font-size: 24rpx; color: #ff7a6b; }

.rs-held-list { display: flex; flex-direction: column; gap: 10rpx; margin-top: 12rpx; }
.rs-held-row { display: flex; justify-content: space-between; align-items: center; gap: 12rpx; padding: 14rpx 18rpx; background: rgba(255, 184, 107, 0.03); border: 1rpx solid rgba(255, 184, 107, 0.1); border-radius: 12rpx; }
.rs-held-focus { display: flex; flex-wrap: wrap; align-items: center; gap: 8rpx; font-size: 22rpx; color: $rf-amber; padding: 10rpx 4rpx; }
.rs-held-focus-code { font-weight: 700; }
.rs-held-focus-clear { color: $color-text-secondary; padding: 4rpx 8rpx; }
.rs-held-info { display: flex; flex-direction: column; min-width: 0; }
.rs-held-name { font-size: 26rpx; color: $app-text; font-weight: 600; }
.rs-held-code { font-size: 21rpx; color: $app-text-muted; margin-top: 2rpx; }
.rs-held-gen { flex: 0 0 200rpx; }

.rs-module { margin-top: 14rpx; padding-top: 14rpx; border-top: 1rpx solid rgba(255, 184, 107, 0.12); }
.rs-module-head { display: flex; align-items: center; gap: 8rpx; margin-bottom: 6rpx; }
.rs-module-no { width: 36rpx; height: 36rpx; border-radius: 50%; background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%); color: $color-bg; font-size: 22rpx; font-weight: 700; text-align: center; line-height: 36rpx; flex: 0 0 36rpx; }
.rs-module-title { font-size: 27rpx; font-weight: 600; color: $app-text; }
.rs-module-verdict { font-size: 23rpx; color: $rf-amber; }
.rs-module-summary { display: block; font-size: 26rpx; line-height: 1.6; color: $app-text; }
.rs-module-points { margin-top: 4rpx; }

.rs-disclaimer { display: block; font-size: 22rpx; color: $app-text-muted; margin-top: 16rpx; line-height: 1.5; }
.rs-disclaimer-bar { margin-top: $spacing-base; padding: $spacing-base; text-align: center; font-size: 22rpx; color: $app-text-muted; border-top: 1rpx solid $app-border; }

// ---- Tab 3: fxbaogao ----
.rs-fx-time { display: flex; gap: 8rpx; flex-wrap: wrap; }
.rs-fx-time-pill {
  padding: 10rpx 16rpx;
  border-radius: 999rpx;
  background: rgba(255, 184, 107, 0.06);
  border: 1rpx solid rgba(255, 184, 107, 0.18);
  color: $app-text-muted;
  font-size: 22rpx;
}
.rs-fx-time-pill.active {
  background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%);
  color: $color-bg;
  border-color: transparent;
  font-weight: 600;
}

.rs-fx-row-meta { display: flex; gap: 12rpx; align-items: center; margin-top: 6rpx; flex-wrap: wrap; }
.rs-fx-org {
  font-size: 22rpx;
  color: $rf-amber;
  background: rgba(212, 175, 55, 0.12);
  padding: 2rpx 12rpx;
  border-radius: 6rpx;
}
.rs-fx-date { font-size: 22rpx; color: $app-text-muted; }
.rs-fx-pages { font-size: 22rpx; color: $app-text-muted; }

.rs-fx-group { margin-top: 16rpx; }
.rs-fx-group-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8rpx; }
.rs-fx-group-name { font-size: 28rpx; font-weight: 600; color: $app-text; }
.rs-fx-group-count { font-size: 22rpx; color: $rf-amber; }
.rs-fx-group-list { display: flex; flex-direction: column; gap: 6rpx; }
.rs-fx-row-mini {
  padding: 12rpx 16rpx;
  background: rgba(255, 184, 107, 0.04);
  border: 1rpx solid rgba(255, 184, 107, 0.1);
  border-radius: 10rpx;
}
.rs-fx-row-mini-title { display: block; font-size: 26rpx; line-height: 1.5; color: $app-text; }
.rs-fx-row-mini-meta { display: flex; gap: 10rpx; align-items: center; margin-top: 4rpx; }

.rs-note--warn { color: #ff9a8a; }
.rs-li-text { flex: 1; min-width: 0; word-break: break-word; }
.rs-block-label--risk { color: #ff9a8a; }

.rs-fx-download { margin-top: 14rpx; padding: 14rpx; background: rgba(114, 247, 255, 0.05); border: 1rpx solid rgba(114, 247, 255, 0.2); border-radius: 10rpx; }
.rs-fx-download-label { display: block; font-size: 24rpx; color: #72f7ff; margin-bottom: 6rpx; font-weight: 500; }
.rs-fx-download-link { padding: 8rpx 0; }
.rs-fx-download-url { display: block; font-size: 22rpx; color: $app-text; font-family: monospace; word-break: break-all; line-height: 1.4; }
.rs-fx-download-hint { display: block; font-size: 20rpx; color: $app-text-muted; margin-top: 4rpx; }
.rs-fx-download-loading { padding: 8rpx 0; color: $app-text-muted; font-size: 24rpx; }

// ---- Tab 1 统一列表（推荐评级 + 类别 pill） ----
.rs-report-title-row { display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap; }
.rs-rec-badge {
  font-size: 22rpx;
  font-weight: 600;
  color: #0d1b2a;
  background: linear-gradient(135deg, #ffb86b 0%, #ff7a3d 100%);
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  flex: 0 0 auto;
}
.rs-cat-pills { display: flex; gap: 6rpx; flex-wrap: wrap; margin-top: 6rpx; }
.rs-cat-pill {
  font-size: 20rpx;
  color: #72f7ff;
  background: rgba(114, 247, 255, 0.1);
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
  border: 1rpx solid rgba(114, 247, 255, 0.2);
}
.rs-btn--active {
  background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%);
  color: $color-bg;
  border-color: transparent;
  font-weight: 600;
}

// ---- 查看原文 modal ----
.rs-original-modal {
  margin-top: 14rpx;
  padding: 16rpx;
  background: rgba(255, 255, 255, 0.03);
  border: 1rpx dashed rgba(255, 184, 107, 0.3);
  border-radius: 10rpx;
}
.rs-original-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10rpx;
  font-size: 24rpx; color: $rf-amber; font-weight: 600;
}
.rs-original-link { padding: 8rpx 0; }
.rs-original-md {
  max-height: 500rpx;
  overflow-y: auto;
  padding: 12rpx;
  background: $color-bg;
  border-radius: 8rpx;
  margin-bottom: 12rpx;
}
.rs-md-block {
  display: block;
  font-size: 24rpx;
  line-height: 1.6;
  color: $app-text;
  white-space: pre-wrap;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.rs-original-foot { display: flex; justify-content: center; margin-top: 10rpx; }
.rs-original-foot .rs-btn { flex: 0 0 auto; padding: 16rpx 60rpx; }
</style>
