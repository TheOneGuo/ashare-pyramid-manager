<template>
  <view class="pf-page" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
    <!-- Head + 下拉提示 -->
    <view class="pf-head">
      <text class="pf-title">持仓分析</text>
      <text class="pf-hint">下拉刷新最新 · AI 建议仅供参考</text>
    </view>

    <!-- Touch 下拉指示器 -->
    <view v-if="pullDistance > 0" class="pf-pull-indicator" :style="{ height: pullDistance + 'px', opacity: pullProgress }">
      <text class="pf-pull-text">{{ pullText }}</text>
    </view>

    <!-- ① 资金 + 费率 小卡 -->
    <view class="pf-card pf-capital">
      <view class="pf-row">
        <view class="pf-col">
          <text class="pf-label">总资金 (元)</text>
          <input class="pf-input" type="number" v-model.number="totalCapital" placeholder="200000" />
        </view>
        <view class="pf-col">
          <text class="pf-label">佣金 (万分之)</text>
          <input class="pf-input" type="number" v-model.number="feeWan" placeholder="2.5" />
        </view>
      </view>
      <view v-if="feeWarning" class="pf-fee-warn" :class="feeWarningClass">
        <text>⚠️ {{ feeWarning }}</text>
      </view>
    </view>

    <!-- ② 截图 / 手动输入 Import 折叠区 -->
    <view class="pf-card pf-import">
      <view class="pf-import-head" @tap="importOpen = !importOpen">
        <text class="pf-section-title">📥 导入持仓</text>
        <text class="pf-toggle">{{ importOpen ? '收起' : '展开' }}</text>
      </view>
      <view v-if="importOpen" class="pf-import-body">
        <view class="pf-import-actions">
          <view class="pf-btn pf-btn--secondary" hover-class="pf-btn--hover" @tap="onUpload">
            <text>📷 上传截图</text>
          </view>
          <view class="pf-btn pf-btn--secondary" hover-class="pf-btn--hover" @tap="onMockExtract">
            <text>🤖 智能识别（mock）</text>
          </view>
        </view>
        <textarea
          v-model="importText"
          class="pf-textarea"
          placeholder="粘贴持仓（每行：代码 成本 数量）例如：&#10;600519 1700 100&#10;000858 165 200"
          :auto-height="true"
        />
        <view class="pf-btn pf-btn--primary" hover-class="pf-btn--hover" @tap="onImport">
          <text>导入到持仓列表</text>
        </view>
        <view v-if="ocrNote" class="pf-note">{{ ocrNote }}</view>
      </view>
    </view>

    <!-- ③ 4 Role Tabs -->
    <view class="pf-role-tabs">
      <view
        v-for="r in ALL_ROLES"
        :key="r"
        class="pf-role-tab"
        :class="{ active: activeRole === r }"
        @tap="activeRole = r"
      >
        <text>{{ ROLE_LABELS[r] }}</text>
      </view>
    </view>

    <!-- ④ 当前 Role 内容 -->
    <view class="pf-role-content">
      <!-- 4a. 推荐编辑 -->
      <view class="pf-card">
        <text class="pf-section-title">📝 {{ ROLE_LABELS[activeRole] }} · 推荐持仓（手动录入）</text>

        <view v-if="recLoading" class="pf-empty"><text>加载中…</text></view>
        <view v-else-if="currentRecs.length === 0" class="pf-empty">
          <text>暂无推荐。下方添加（代码 名称 权重 %）</text>
        </view>
        <view v-else class="pf-rec-list">
          <view v-for="(r, i) in currentRecs" :key="r.stock_code" class="pf-rec-row">
            <text class="pf-rec-name">{{ r.stock_name || r.stock_code }} · {{ r.stock_code }}</text>
            <text class="pf-rec-weight">{{ fmtPct(r.weight, 1) }}</text>
            <text class="pf-rec-del" @tap="onDelRec(r)">✕</text>
          </view>
        </view>

        <!-- 添加行 -->
        <view class="pf-rec-add">
          <input class="pf-input pf-input--sm" v-model="addCode" placeholder="代码" />
          <input class="pf-input pf-input--md" v-model="addName" placeholder="名称" />
          <input class="pf-input pf-input--xs" type="number" v-model.number="addWeight" placeholder="权重" />
          <view class="pf-btn pf-btn--primary pf-btn--xs" @tap="onAddRec"><text>+</text></view>
        </view>

        <view v-if="addRecErr" class="pf-note pf-note--warn">{{ addRecErr }}</view>

        <view class="pf-btn pf-btn--primary pf-btn--block" hover-class="pf-btn--hover" @tap="onSaveRecs">
          <text>保存 {{ ROLE_LABELS[activeRole] }} 推荐（覆盖）</text>
        </view>
      </view>

      <!-- 4b. 对比 + 建议 -->
      <view class="pf-card pf-compare">
        <text class="pf-section-title">⚖️ 对比 · {{ ROLE_LABELS[activeRole] }} vs 现持仓</text>

        <view class="pf-compare-cols">
          <view class="pf-compare-col">
            <text class="pf-col-title">现持仓 ({{ holdings.length }})</text>
            <view v-if="holdings.length === 0" class="pf-empty"><text>未导入持仓</text></view>
            <view v-for="h in holdingsWithWeight" :key="h.code" class="pf-holding-row" :class="{ 'pf-overlap': overlapSet.has(h.code) }">
              <text class="pf-holding-name">{{ h.name || h.code }} · {{ h.code }}</text>
              <text class="pf-holding-weight">{{ fmtPct(h.weight, 1) }}</text>
            </view>
          </view>
          <view class="pf-compare-col">
            <text class="pf-col-title">{{ ROLE_LABELS[activeRole] }} ({{ currentRecs.length }})</text>
            <view v-if="currentRecs.length === 0" class="pf-empty"><text>未录入推荐</text></view>
            <view v-for="r in currentRecs" :key="r.stock_code" class="pf-holding-row" :class="{ 'pf-overlap': overlapSet.has(r.stock_code) }">
              <text class="pf-holding-name">{{ r.stock_name || r.stock_code }} · {{ r.stock_code }}</text>
              <text class="pf-holding-weight">{{ fmtPct(r.weight, 1) }}</text>
            </view>
          </view>
        </view>

        <!-- 建议 -->
        <text class="pf-sub-section-title">📊 调整建议</text>
        <view v-if="currentCompare && currentCompare.suggestions && currentCompare.suggestions.length > 0">
          <view v-for="s in currentCompare.suggestions" :key="s.stock_code + s.action" class="pf-suggestion" :class="`suggestion-${s.action}`">
            <text class="pf-suggestion-icon">{{ s.action === 'add' ? '↑' : '↓' }}</text>
            <text class="pf-suggestion-text">
              <text class="pf-suggestion-title">{{ s.action === 'add' ? '加仓' : '减仓' }} {{ s.stock_code }} {{ s.stock_name }}</text>
              <text class="pf-suggestion-reason">{{ s.reason }}</text>
            </text>
          </view>
        </view>
        <view v-else class="pf-empty">
          <text>暂无建议（点击下方"运行分析"生成）</text>
        </view>

        <view class="pf-btn pf-btn--primary pf-btn--block" hover-class="pf-btn--hover" @tap="onRunAnalyze" :class="{ 'pf-btn--loading': analyzeLoading }">
          <text>{{ analyzeLoading ? '分析中…' : '运行分析（OCR + 5 步校验 + 金字塔）' }}</text>
        </view>
      </view>

      <!-- 4c. 标的 plan 展开 -->
      <view v-if="analyzeReport" class="pf-card pf-report">
        <text class="pf-section-title">📐 标的方案</text>

        <!-- Notices / Fee / Confirms -->
        <view v-if="analyzeReport.notices && analyzeReport.notices.length" class="pf-notice-list">
          <view v-for="(n, i) in analyzeReport.notices" :key="i" class="pf-notice">
            <text>· {{ n }}</text>
          </view>
        </view>
        <view v-if="analyzeReport.fee_level === 'warn_low' || analyzeReport.fee_level === 'warn_high'" class="pf-fee-warn">
          <text>⚠️ 费率{{ analyzeReport.fee_level === 'warn_low' ? '偏低' : '偏高' }}：{{ analyzeReport.fee_msg }}</text>
        </view>

        <!-- 现有持仓处置 -->
        <view v-if="analyzeReport.existing_advice && analyzeReport.existing_advice.length" class="pf-existing">
          <text class="pf-sub-section-title">📋 现有持仓处置</text>
          <view v-for="ea in analyzeReport.existing_advice" :key="ea.code || ea.text" class="pf-existing-row">
            <view v-if="ea.type === 'global'" class="pf-existing-global">
              <text>{{ ea.text }}</text>
            </view>
            <view v-else-if="ea.type === 'invalid'" class="pf-existing-invalid">
              <text>{{ ea.text }}</text>
            </view>
            <view v-else class="pf-existing-item">
              <text class="pf-existing-code">{{ ea.code }} {{ ea.name }}</text>
              <text class="pf-existing-action" :class="actionClass(ea.action)">{{ ea.action }}</text>
              <view v-if="ea.plan && ea.plan.rows && ea.plan.rows.length" class="pf-plan-table">
                <view class="pf-plan-row pf-plan-row--head">
                  <text class="pf-plan-th">档</text>
                  <text class="pf-plan-th">价</text>
                  <text class="pf-plan-th">止损</text>
                  <text class="pf-plan-th">股</text>
                </view>
                <view v-for="(r, i) in ea.plan.rows" :key="i" class="pf-plan-row">
                  <text class="pf-plan-td">{{ tierLabel(r.tier) }}</text>
                  <text class="pf-plan-td">{{ fmtMoney(r.price, 2) }}</text>
                  <text class="pf-plan-td">{{ fmtMoney(r.stop, 2) }}</text>
                  <text class="pf-plan-td">{{ r.shares }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>

        <!-- 新标的方案 -->
        <view v-if="analyzeReport.stocks && analyzeReport.stocks.length">
          <text class="pf-sub-section-title">🎯 新标的方案</text>
          <view v-for="s in analyzeReport.stocks" :key="(s.code || '') + (s.name || '')" class="pf-stock">
            <view class="pf-stock-head">
              <text class="pf-stock-code">{{ s.code }} {{ s.name }}</text>
              <text class="pf-stock-budget">{{ fmtMoney(s.capital) }}元</text>
            </view>
            <view v-if="s.error" class="pf-stock-err">⚠️ {{ s.error }}</view>
            <view v-else-if="s.plan && s.plan.too_expensive" class="pf-stock-err">
              价格过高 · 当前 capital 无法开出 4 笔完整仓位，建议更换标的
            </view>
            <view v-else-if="s.plan && s.plan.rows && s.plan.rows.length" class="pf-plan-table">
              <view class="pf-plan-row pf-plan-row--head">
                <text class="pf-plan-th">档</text>
                <text class="pf-plan-th">价</text>
                <text class="pf-plan-th">止损</text>
                <text class="pf-plan-th">股</text>
              </view>
              <view v-for="(r, i) in s.plan.rows" :key="i" class="pf-plan-row">
                <text class="pf-plan-td">{{ tierLabel(r.tier) }}</text>
                <text class="pf-plan-td">{{ fmtMoney(r.price, 2) }}</text>
                <text class="pf-plan-td">{{ fmtMoney(r.stop, 2) }}</text>
                <text class="pf-plan-td">{{ r.shares }}</text>
              </view>
            </view>
            <view v-else class="pf-stock-err">无方案</view>
          </view>
        </view>
      </view>
    </view>

    <!-- ⑤ AI 研报解读（照搬原项目 ai-research-panel：结构化 mock 版） -->
    <view class="pf-card pf-research">
      <text class="pf-section-title">📑 AI 研报解读</text>
      <text class="pf-note pf-note--muted">AI 会按十二个研究模块整理公开资料生成研报（当前为演示模式，后续接入真实 LLM）。</text>

      <view class="pf-row pf-research-inputs">
        <input class="pf-input pf-input--sm" v-model="researchCode" placeholder="代码" />
        <input class="pf-input pf-input--md" v-model="researchName" placeholder="名称（可选）" />
      </view>
      <textarea
        v-model="researchQuery"
        class="pf-textarea"
        placeholder="用一句话说明你想验证的问题，例如：重点看产能扩张、海外客户与未来三年增长空间。"
        :auto-height="true"
      />
      <view class="pf-btn pf-btn--primary pf-btn--block" hover-class="pf-btn--hover" @tap="onResearch" :class="{ 'pf-btn--loading': researchLoading }">
        <text>{{ researchLoading ? '生成中…' : '生成 AI 研报' }}</text>
      </view>

      <view v-if="researchData" class="pf-report-box">
        <view class="pf-report-head">
          <text class="pf-report-title">{{ researchData.stock_name }} · {{ researchData.stock_code || '—' }}</text>
          <text class="pf-report-rating">综合评级：{{ researchData.rating }}</text>
        </view>
        <text class="pf-report-overall">{{ researchData.overall }}</text>

        <view v-for="(m, i) in researchData.modules" :key="i" class="pf-module">
          <view class="pf-module-head">
            <text class="pf-module-no">{{ i + 1 }}</text>
            <text class="pf-module-title">{{ m.title }}</text>
            <text v-if="m.verdict" class="pf-module-verdict">· {{ m.verdict }}</text>
          </view>
          <text class="pf-module-summary">{{ m.summary }}</text>
          <view v-if="m.points && m.points.length" class="pf-module-points">
            <view v-for="(p, j) in m.points" :key="j" class="pf-module-point">
              <text class="pf-dot">·</text><text>{{ p }}</text>
            </view>
          </view>
        </view>

        <text class="pf-report-disclaimer">{{ researchData.disclaimer }}</text>
      </view>
    </view>

    <view class="pf-disclaimer">
      <text>AI + 算法建议不构成投资建议 · 投资有风险，入市需谨慎</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  listHoldings, upsertHolding, deleteHolding,
  listRecommendations, bulkSetRecommendations, compareWithRole,
  extractFromImages, analyzePortfolio,
  researchReport,
  ALL_ROLES, ROLE_LABELS,
  type Role, type Holding, type Recommendation, type CompareResult, type AnalyzeReport, type ResearchReport,
} from '@/api/portfolio'
import { parseHoldingsText, fmtMoney, fmtPct, tierLabel, padCode } from '@/utils/portfolioFormat'

// ── 状态 ──
const totalCapital = ref<number>(200000)
const feeWan = ref<number>(2.5)
const feeWarning = computed(() => {
  const f = feeWan.value
  if (!f || f <= 0) return '请输入佣金费率'
  if (f < 0.1 || f > 10) return '费率需在万分之 0.1 ~ 10 之间'
  if (f < 0.5) return '您输入的费率偏低（万分之 0.5 以下），请核对'
  if (f > 3) return '您输入的费率偏高（万分之 3 以上），请核对'
  return ''
})
const feeWarningClass = computed(() => {
  const f = feeWan.value
  if (!f || f <= 0 || f < 0.1 || f > 10) return 'pf-fee-warn--hard'
  if (f < 0.5 || f > 3) return 'pf-fee-warn--warn'
  return ''
})

const importOpen = ref(true)
const importText = ref('')
const ocrNote = ref('')

const activeRole = ref<Role>('institution')

const holdings = ref<Holding[]>([])
const recByRole = ref<Record<string, Recommendation[]>>({})
const compareByRole = ref<Record<string, CompareResult | null>>({})
const recLoading = ref(false)
const analyzeLoading = ref(false)
const analyzeReport = ref<AnalyzeReport | null>(null)

// ── AI 研报解读 ──
const researchCode = ref('')
const researchName = ref('')
const researchQuery = ref('')
const researchLoading = ref(false)
const researchData = ref<ResearchReport | null>(null)

// ── 添加行 ──
const addCode = ref('')
const addName = ref('')
const addWeight = ref<number>(10)
const addRecErr = ref('')

// ── Touch 下拉刷新 ──
const pullDistance = ref(0)
const pullProgress = ref(0)
const pullText = ref('')
const pullRefreshing = ref(false)
let touchStartY = 0
let isPulling = false
const PULL_THRESHOLD = 80
const PULL_MAX = 140

function refreshHint() {
  if (pullRefreshing.value) { pullText.value = '刷新中…'; return }
  if (pullDistance.value >= PULL_THRESHOLD) { pullText.value = '释放刷新'; return }
  if (pullDistance.value > 10) { pullText.value = '下拉刷新中…'; return }
  pullText.value = ''
}

function onTouchStart(e: any) {
  // 只在页面顶部时启用下拉
  const scrollTop = (e?.target?.scrollTop ?? 0)
  // #ifdef H5 || APP-PLUS
  touchStartY = (e?.touches?.[0]?.clientY) || 0
  isPulling = scrollTop <= 0
  // #endif
}
function onTouchMove(e: any) {
  if (!isPulling) return
  const y = (e?.touches?.[0]?.clientY) || 0
  const dy = y - touchStartY
  if (dy > 10) {
    const dist = Math.min(PULL_MAX, dy * 0.55)
    pullDistance.value = dist
    pullProgress.value = Math.min(1, dist / PULL_THRESHOLD)
    refreshHint()
    // 阻止默认行为（H5 需要 preventDefault，否则会滚动）
    if (e?.preventDefault) e.preventDefault()
  }
}
async function onTouchEnd() {
  if (!isPulling) return
  isPulling = false
  if (pullDistance.value >= PULL_THRESHOLD) {
    // 触发刷新
    pullDistance.value = PULL_THRESHOLD
    pullRefreshing.value = true
    refreshHint()
    await refreshAll()
    pullRefreshing.value = false
  } else {
    // 收回
    pullDistance.value = 0
    pullProgress.value = 0
    refreshHint()
  }
  setTimeout(() => {
    if (pullDistance.value <= PULL_THRESHOLD) {
      pullDistance.value = 0
      pullProgress.value = 0
      refreshHint()
    }
  }, 600)
}

async function refreshAll() {
  await Promise.all([loadHoldings(), loadAllRecs()])
  setTimeout(() => {
    pullDistance.value = 0
    pullProgress.value = 0
  }, 400)
}

// ── 持仓 ──
async function loadHoldings() {
  try {
    holdings.value = await listHoldings()
  } catch (e) {
    console.warn('[portfolio] loadHoldings failed', e)
  }
}

const totalWeight = computed(() => {
  // 用 holdings 的市值算权重（没有现价时退化为 0）
  const total = holdings.value.reduce((s, h) => s + (h.cost_basis * h.shares), 0)
  return total || 1
})

const holdingsWithWeight = computed(() =>
  holdings.value.map((h) => ({
    code: h.stock_code,
    name: h.short_name || '',
    shares: h.shares,
    cost: h.cost_basis,
    weight: (h.cost_basis * h.shares) / totalWeight.value,
  }))
)

const currentRecs = computed(() => recByRole.value[activeRole.value] || [])

const overlapSet = computed(() => {
  const set = new Set<string>()
  const comp = compareByRole.value[activeRole.value]
  if (comp && comp.overlap) for (const c of comp.overlap) set.add(c)
  return set
})

const currentCompare = computed(() => compareByRole.value[activeRole.value] || null)

// ── Role 推荐 ──
async function loadAllRecs() {
  recLoading.value = true
  try {
    const all = await listRecommendations()
    const map: Record<string, Recommendation[]> = {}
    for (const r of all) {
      if (!map[r.role]) map[r.role] = []
      map[r.role].push(r)
    }
    for (const role of ALL_ROLES) {
      if (!map[role]) map[role] = []
    }
    recByRole.value = map
  } catch (e) {
    console.warn('[portfolio] loadAllRecs failed', e)
  } finally {
    recLoading.value = false
  }
}

function onAddRec() {
  addRecErr.value = ''
  const code = padCode(addCode.value)
  if (!/^\d{6}$/.test(code)) {
    addRecErr.value = '请输入有效 6 位股票代码'
    return
  }
  const w = Number(addWeight.value)
  if (!w || w <= 0 || w > 100) {
    addRecErr.value = '权重需在 0~100 之间'
    return
  }
  const list = [...currentRecs.value]
  // 同 code 覆盖
  const idx = list.findIndex((r) => r.stock_code === code)
  const newRec: Recommendation = {
    role: activeRole.value,
    stock_code: code,
    stock_name: addName.value.trim(),
    weight: w / 100,
  }
  if (idx >= 0) list[idx] = newRec
  else list.push(newRec)
  recByRole.value = { ...recByRole.value, [activeRole.value]: list }
  addCode.value = ''
  addName.value = ''
  addWeight.value = 10
}

function onDelRec(r: Recommendation) {
  const list = currentRecs.value.filter((x) => x.stock_code !== r.stock_code)
  recByRole.value = { ...recByRole.value, [activeRole.value]: list }
}

async function onSaveRecs() {
  try {
    const items = currentRecs.value.map((r) => ({
      stock_code: r.stock_code,
      stock_name: r.stock_name,
      weight: r.weight,
    }))
    await bulkSetRecommendations(activeRole.value, items)
    uni.showToast({ title: '已保存', icon: 'success' })
    await loadAllRecs()
    await loadCompare()
  } catch (e: any) {
    uni.showToast({ title: e?.message || '保存失败', icon: 'none' })
  }
}

async function loadCompare() {
  try {
    const c = await compareWithRole(activeRole.value)
    compareByRole.value = { ...compareByRole.value, [activeRole.value]: c }
  } catch (e) {
    console.warn('[portfolio] loadCompare failed', e)
  }
}

// ── 截图 / 手动导入 ──
function onUpload() {
  uni.chooseImage({
    count: 1,
    success: async (res) => {
      const fp = res.tempFilePaths?.[0]
      if (!fp) return
      uni.showLoading({ title: '识别中…' })
      try {
        // H5 端 uni.getFileSystemManager / FileSystemManager 不直接支持；走 base64 path
        // 简单方案：提示用户"截图先在 OCR 平台识别为 JSON，再粘贴到 textarea"
        // 或者用 uni.request 上传文件
        uni.hideLoading()
        uni.showToast({ title: '已选图，请用下方「智能识别」跑 mock，或手动输入', icon: 'none', duration: 3000 })
        ocrNote.value = `已选图（${fp}）。注：浏览器端跨域文件读取受限；用「智能识别」跑 mock 数据演示。`
      } catch (e: any) {
        uni.hideLoading()
        uni.showToast({ title: e?.message || '上传失败', icon: 'none' })
      }
    },
  })
}

async function onMockExtract() {
  uni.showLoading({ title: '识别中…' })
  try {
    const r = await extractFromImages(['data:image/png;base64,iVBORw0KGgo='])
    uni.hideLoading()
    if (r.ok && r.positions && r.positions.length) {
      // 自动填到 textarea
      const lines = r.positions.map((p) => `${p.code} ${p.cost} ${p.qty}`).join('\n')
      importText.value = lines
      ocrNote.value = r.mock
        ? `（mock 数据：${r.note || 'LLM 未配置'}）— 点击下方"导入到持仓列表"入库`
        : `识别成功 ${r.positions.length} 条 — 点击下方"导入到持仓列表"入库`
    } else {
      ocrNote.value = r.error || '识别失败'
    }
  } catch (e: any) {
    uni.hideLoading()
    ocrNote.value = e?.message || '识别失败'
  }
}

async function onImport() {
  const list = parseHoldingsText(importText.value)
  if (list.length === 0) {
    uni.showToast({ title: '没解析到有效持仓（每行：代码 成本 数量）', icon: 'none' })
    return
  }
  uni.showLoading({ title: '导入中…' })
  let ok = 0
  for (const p of list) {
    try {
      await upsertHolding({ stock_code: p.code, short_name: '', shares: p.qty, cost_basis: p.cost })
      ok++
    } catch (e) {
      console.warn('[import] upsert failed', p, e)
    }
  }
  uni.hideLoading()
  uni.showToast({ title: `导入 ${ok}/${list.length} 条`, icon: 'success' })
  importText.value = ''
  await loadHoldings()
  await loadCompare()
}

// ── 运行分析 ──
async function onRunAnalyze() {
  if (!totalCapital.value || totalCapital.value <= 0) {
    uni.showToast({ title: '请输入总资金', icon: 'none' })
    return
  }
  analyzeLoading.value = true
  try {
    const r = await analyzePortfolio({
      total_capital: totalCapital.value,
      fee_wan: feeWan.value,
      stocks: holdings.value.map((h) => ({
        code: h.stock_code,
        name: h.short_name,
        price: h.cost_basis,
        capital: totalCapital.value / Math.max(holdings.value.length, 1),
      })),
      existing: holdings.value.map((h) => ({
        code: h.stock_code,
        name: h.short_name,
        cost: h.cost_basis,
        qty: h.shares,
        cur: h.cost_basis,
      })),
      fee_confirmed: true,
    })
    if (r.fee_confirm) {
      uni.showModal({
        title: '费率确认',
        content: r.fee_msg || '',
        success: async (m) => {
          if (m.confirm) {
            // 重新跑
            const r2 = await analyzePortfolio({
              total_capital: totalCapital.value,
              fee_wan: feeWan.value,
              stocks: holdings.value.map((h) => ({ code: h.stock_code, name: h.short_name, price: h.cost_basis, capital: totalCapital.value / Math.max(holdings.value.length, 1) })),
              existing: holdings.value.map((h) => ({ code: h.stock_code, name: h.short_name, cost: h.cost_basis, qty: h.shares, cur: h.cost_basis })),
              fee_confirmed: true,
            })
            analyzeReport.value = r2
          }
        },
      })
    } else {
      analyzeReport.value = r
    }
  } catch (e: any) {
    uni.showToast({ title: e?.message || '分析失败', icon: 'none' })
  } finally {
    analyzeLoading.value = false
  }
}

function actionClass(action?: string) {
  if (!action) return ''
  if (action.includes('平仓')) return 'pf-action--reduce'
  if (action.includes('减仓')) return 'pf-action--reduce'
  if (action.includes('加仓')) return 'pf-action--add'
  return 'pf-action--hold'
}

// ── AI 研报解读 ──
async function onResearch() {
  const code = (researchCode.value || '').trim()
  const name = (researchName.value || '').trim()
  if (!code && !name) {
    uni.showToast({ title: '请输入代码或名称', icon: 'none' })
    return
  }
  researchLoading.value = true
  try {
    const r = await researchReport({
      stock_code: code,
      stock_name: name,
      query: researchQuery.value.trim(),
    })
    researchData.value = r
  } catch (e: any) {
    uni.showToast({ title: e?.message || '生成失败', icon: 'none' })
  } finally {
    researchLoading.value = false
  }
}

// ── Life cycle ──
onMounted(() => {
  // #ifdef H5 || APP-PLUS
  // touch events bound at page level
  // #endif
  refreshAll()
  loadCompare()
})

onShow(() => {
  loadHoldings()
  loadCompare()
})

onBeforeUnmount(() => {
  // 清理 timer（如果有）
})
</script>

<style lang="scss" scoped>
/* ── A股景气捕手 色板（与全局一致） ── */
$rf-cyan: #72f7ff;
$rf-amber: #ffb86b;
$rf-orange: #ff7a3d;
$rf-cream: #f5ecd9;
$rf-muted: #a89a82;
$rf-green: #6bffad;
$rf-red:   #ff4d4d;
$color-bg: #0d1b2a;
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: $rf-cream;
$color-text-secondary: $rf-muted;
$color-text-warm: #d3c3ad;
$radius-md: 14rpx;
$radius-lg: 20rpx;
$radius-full: 999rpx;
$spacing-sm: 8rpx;
$spacing-base: 16rpx;
$spacing-md: 24rpx;
$spacing-lg: 32rpx;

/* ── 容器 ── */
.pf-page {
  min-height: 100vh;
  background: $color-bg;
  padding: 24rpx 24rpx 48rpx;
  // 移动端：防止 overscroll 行为干扰 touch
  // #ifdef H5
  overscroll-behavior-y: contain;
  // #endif
}

.pf-head {
  padding: 16rpx 0 8rpx;
  margin-bottom: 12rpx;
}
.pf-title {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
  color: $color-text-primary;
  letter-spacing: 1rpx;
}
.pf-hint {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $color-text-secondary;
  letter-spacing: 1rpx;
}

/* ── Touch 下拉指示器 ── */
.pf-pull-indicator {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 184, 107, 0.08);
  border-bottom: 1rpx solid $color-border;
  transition: height 0.15s ease, opacity 0.15s ease;
  overflow: hidden;
}
.pf-pull-text {
  font-size: 24rpx;
  color: $rf-amber;
  font-weight: 600;
}

/* ── 通用 card ── */
.pf-card {
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  border-radius: $radius-lg;
  padding: 20rpx 24rpx;
  margin-bottom: 20rpx;
}
.pf-section-title {
  display: block;
  font-size: 30rpx;
  color: $rf-amber;
  font-weight: 600;
  margin-bottom: 16rpx;
}
.pf-sub-section-title {
  display: block;
  font-size: 26rpx;
  color: $rf-amber;
  font-weight: 600;
  margin: 16rpx 0 12rpx;
}
.pf-empty {
  text-align: center;
  color: $color-text-secondary;
  font-size: 24rpx;
  padding: 20rpx 0;
}
.pf-label {
  display: block;
  font-size: 22rpx;
  color: $color-text-secondary;
  margin-bottom: 8rpx;
}
.pf-row {
  display: flex;
  gap: 16rpx;
}
.pf-col {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.pf-input {
  width: 100%;
  padding: 16rpx 20rpx;
  font-size: 28rpx;
  background: rgba(12, 10, 12, 0.6);
  color: $color-text-primary;
  border: 1rpx solid rgba(255, 184, 107, 0.3);
  border-radius: 12rpx;
  box-sizing: border-box;
}
.pf-input--xs { width: 80rpx; padding: 12rpx 16rpx; }
.pf-input--sm { flex: 0 0 200rpx; padding: 12rpx 16rpx; }
.pf-input--md { flex: 1; padding: 12rpx 16rpx; }

/* ── Fee 警告 ── */
.pf-fee-warn {
  margin-top: 12rpx;
  padding: 12rpx 16rpx;
  font-size: 22rpx;
  border-radius: 10rpx;
  border: 1rpx solid;
  color: $rf-amber;
  background: rgba(255, 184, 107, 0.08);
  border-color: rgba(255, 184, 107, 0.3);
}
.pf-fee-warn--warn {
  color: $rf-amber;
  background: rgba(255, 184, 107, 0.08);
  border-color: rgba(255, 184, 107, 0.3);
}
.pf-fee-warn--hard {
  color: $rf-red;
  background: rgba(255, 77, 77, 0.08);
  border-color: rgba(255, 77, 77, 0.3);
}

/* ── Import 区 ── */
.pf-import-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pf-toggle {
  font-size: 24rpx;
  color: $rf-cyan;
}
.pf-import-body {
  margin-top: 16rpx;
}
.pf-import-actions {
  display: flex;
  gap: 12rpx;
  margin-bottom: 12rpx;
}
.pf-textarea {
  width: 100%;
  padding: 16rpx;
  font-size: 24rpx;
  background: rgba(12, 10, 12, 0.7);
  color: $color-text-primary;
  border: 1rpx solid rgba(255, 184, 107, 0.2);
  border-radius: 12rpx;
  margin-bottom: 12rpx;
  min-height: 100rpx;
  box-sizing: border-box;
}
.pf-note {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: $color-text-secondary;
  line-height: 1.5;
}
.pf-note--warn {
  color: $rf-amber;
}

/* ── 通用 button ── */
.pf-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 16rpx 28rpx;
  font-size: 26rpx;
  border-radius: 14rpx;
  border: 1rpx solid transparent;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.pf-btn--xs { padding: 8rpx 18rpx; font-size: 28rpx; min-width: 60rpx; }
.pf-btn--secondary {
  background: rgba(255, 184, 107, 0.05);
  border-color: rgba(255, 184, 107, 0.3);
  color: $color-text-primary;
}
.pf-btn--primary {
  background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%);
  color: $color-bg;
  font-weight: 600;
  border-color: $rf-amber;
}
.pf-btn--block {
  display: flex;
  width: 100%;
  margin-top: 16rpx;
}
.pf-btn--loading {
  opacity: 0.7;
}
.pf-btn--hover {
  opacity: 0.85;
  transform: scale(0.98);
}

/* ── Role Tabs ── */
.pf-role-tabs {
  display: flex;
  gap: 8rpx;
  margin-bottom: 16rpx;
  border-bottom: 1rpx solid rgba(255, 184, 107, 0.16);
  padding-bottom: 6rpx;
}
.pf-role-tab {
  flex: 1;
  padding: 16rpx 0;
  text-align: center;
  font-size: 26rpx;
  font-weight: 600;
  color: $color-text-secondary;
  background: transparent;
  border: 1rpx solid transparent;
  border-radius: 12rpx;
  transition: color 0.2s, background 0.2s, border-color 0.2s;
}
.pf-role-tab.active {
  color: $rf-amber;
  background: rgba(255, 184, 107, 0.1);
  border-color: rgba(255, 184, 107, 0.3);
}

/* ── Role Content ── */
.pf-role-content {
  // 直板机：单列
  // 折叠屏：grid 双列
}

.pf-rec-list {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  margin-bottom: 12rpx;
}
.pf-rec-row {
  display: grid;
  grid-template-columns: 1fr 80rpx 60rpx;
  align-items: center;
  padding: 10rpx 14rpx;
  background: rgba(255, 184, 107, 0.03);
  border: 1rpx solid rgba(255, 184, 107, 0.1);
  border-radius: 10rpx;
}
.pf-rec-name { font-size: 26rpx; color: $color-text-primary; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-rec-weight { text-align: right; font-size: 26rpx; color: $rf-amber; font-weight: 600; font-variant-numeric: tabular-nums; }
.pf-rec-del { text-align: center; font-size: 28rpx; color: $rf-red; }

.pf-rec-add {
  display: flex;
  gap: 8rpx;
  align-items: center;
  margin-bottom: 12rpx;
}

/* ── Compare grid ── */
.pf-compare-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12rpx;
  margin-bottom: 12rpx;
}
.pf-compare-col {
  padding: 12rpx;
  background: rgba(255, 184, 107, 0.03);
  border: 1rpx solid rgba(255, 184, 107, 0.1);
  border-radius: 12rpx;
  min-height: 100rpx;
}
.pf-col-title {
  font-size: 24rpx;
  font-weight: 600;
  color: $color-text-primary;
  margin-bottom: 8rpx;
  padding-bottom: 6rpx;
  border-bottom: 1rpx solid rgba(255, 184, 107, 0.14);
  text-align: center;
}
.pf-holding-row {
  display: grid;
  grid-template-columns: 1fr 80rpx;
  align-items: center;
  padding: 8rpx 10rpx;
  font-size: 24rpx;
  color: $color-text-primary;
  border-radius: 6rpx;
  margin-bottom: 4rpx;
  border: 1rpx solid transparent;
}
.pf-holding-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-holding-weight { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: $rf-amber; }
.pf-overlap {
  border-color: rgba(255, 184, 107, 0.4) !important;
  background: rgba(255, 184, 107, 0.08) !important;
}

/* ── Suggestions ── */
.pf-suggestion {
  display: flex;
  gap: 10rpx;
  padding: 14rpx 16rpx;
  margin-bottom: 8rpx;
  font-size: 24rpx;
  border-radius: 12rpx;
  border: 1rpx solid;
  line-height: 1.4;
}
.suggestion-add { color: $rf-green; border-color: rgba(107, 255, 173, 0.3); background: rgba(107, 255, 173, 0.05); }
.suggestion-reduce { color: $rf-red; border-color: rgba(255, 77, 77, 0.3); background: rgba(255, 77, 77, 0.05); }
.pf-suggestion-icon { flex: 0 0 32rpx; font-size: 32rpx; text-align: center; }
.pf-suggestion-text { flex: 1; }
.pf-suggestion-title { display: block; font-weight: 600; }
.pf-suggestion-reason { display: block; font-size: 22rpx; opacity: 0.85; margin-top: 2rpx; }

/* ── Notices / Fee / Confirms ── */
.pf-notice-list { margin-bottom: 12rpx; }
.pf-notice {
  padding: 10rpx 14rpx;
  font-size: 24rpx;
  color: $color-text-warm;
  background: rgba(114, 247, 255, 0.05);
  border-left: 4rpx solid $rf-cyan;
  border-radius: 0 8rpx 8rpx 0;
  margin-bottom: 6rpx;
  line-height: 1.5;
}

/* ── Existing advice ── */
.pf-existing-row { margin-bottom: 12rpx; }
.pf-existing-global {
  padding: 12rpx 14rpx;
  font-size: 24rpx;
  color: $rf-amber;
  background: rgba(255, 184, 107, 0.08);
  border: 1rpx solid rgba(255, 184, 107, 0.3);
  border-radius: 10rpx;
  margin-bottom: 10rpx;
  line-height: 1.5;
}
.pf-existing-invalid {
  padding: 10rpx 14rpx;
  font-size: 24rpx;
  color: $rf-red;
  background: rgba(255, 77, 77, 0.05);
  border: 1rpx solid rgba(255, 77, 77, 0.3);
  border-radius: 8rpx;
  margin-bottom: 6rpx;
}
.pf-existing-item {
  padding: 10rpx 14rpx;
  background: rgba(255, 184, 107, 0.03);
  border: 1rpx solid rgba(255, 184, 107, 0.1);
  border-radius: 10rpx;
  margin-bottom: 8rpx;
}
.pf-existing-code {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: $color-text-primary;
  margin-bottom: 4rpx;
}
.pf-existing-action {
  display: block;
  font-size: 24rpx;
  color: $color-text-warm;
  margin-bottom: 8rpx;
  line-height: 1.5;
}
.pf-action--add { color: $rf-green; }
.pf-action--reduce { color: $rf-red; }
.pf-action--hold { color: $rf-amber; }

/* ── Plan Table ── */
.pf-plan-table {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 80rpx;
  gap: 2rpx;
  background: rgba(12, 10, 12, 0.5);
  border-radius: 8rpx;
  overflow: hidden;
  margin-top: 8rpx;
}
.pf-plan-row {
  display: contents;
}
.pf-plan-row > text {
  padding: 8rpx 10rpx;
  font-size: 22rpx;
  color: $color-text-primary;
  text-align: center;
  background: rgba(12, 10, 12, 0.3);
}
.pf-plan-row--head > text {
  background: rgba(255, 184, 107, 0.12);
  color: $rf-amber;
  font-weight: 600;
  font-size: 20rpx;
}

/* ── Stock（新标的方案） ── */
.pf-stock {
  padding: 12rpx 14rpx;
  background: rgba(114, 247, 255, 0.03);
  border: 1rpx solid rgba(114, 247, 255, 0.15);
  border-radius: 10rpx;
  margin-bottom: 10rpx;
}
.pf-stock-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6rpx;
}
.pf-stock-code { font-size: 26rpx; font-weight: 600; color: $color-text-primary; }
.pf-stock-budget { font-size: 22rpx; color: $color-text-secondary; font-variant-numeric: tabular-nums; }
.pf-stock-err { font-size: 24rpx; color: $rf-amber; padding: 8rpx 0; line-height: 1.5; }

/* ── Disclaimer ── */
.pf-disclaimer {
  margin-top: 32rpx;
  padding: 20rpx;
  text-align: center;
  font-size: 22rpx;
  color: $color-text-secondary;
  line-height: 1.6;
}

/* ═══════════════════════════════════════════
   响应式
   - 默认：直板机（≤390 单列紧凑；391~760 单列标准）
   - 折叠屏内屏 / 平板（761~980）：右栏变宽，建议区放右侧
   - 桌面 / 横屏（≥981）：双列 grid，左编辑/右对比
   ═══════════════════════════════════════════ */
@media (max-width: 390px) {
  .pf-holding-row { grid-template-columns: 1fr 60rpx; font-size: 22rpx; }
  .pf-role-tab { font-size: 24rpx; padding: 14rpx 0; }
}

@media (min-width: 761px) {
  .pf-page { max-width: 1080rpx; margin: 0 auto; padding: 32rpx 32rpx 64rpx; }
  .pf-capital .pf-input { font-size: 30rpx; }
  .pf-holding-row { font-size: 26rpx; padding: 12rpx 14rpx; }
  .pf-rec-row { font-size: 28rpx; }
}

@media (min-width: 981px) {
  .pf-role-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-areas:
      "edit compare"
      "report report";
    gap: 20rpx;
  }
  .pf-role-content > view:nth-child(1) { grid-area: edit; }
  .pf-role-content > view:nth-child(2) { grid-area: compare; }
  .pf-role-content > view:nth-child(3) { grid-area: report; }
}

@media (orientation: landscape) and (max-height: 500px) {
  // 横屏小高度：紧凑
  .pf-page { padding: 16rpx 24rpx 32rpx; }
  .pf-title { font-size: 36rpx; }
}

/* ── AI 研报解读 ── */
.pf-research-inputs {
  gap: 16rpx;
  margin-bottom: 16rpx;
}
.pf-report-box {
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid $color-border;
}
.pf-report-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.pf-report-title {
  font-size: 28rpx;
  font-weight: 700;
  color: $rf-cream;
}
.pf-report-rating {
  font-size: 24rpx;
  color: $rf-amber;
  font-weight: 600;
}
.pf-report-overall {
  display: block;
  font-size: 24rpx;
  color: $rf-green;
  line-height: 1.5;
  margin-bottom: 16rpx;
}
.pf-module {
  padding: 16rpx 0;
  border-bottom: 1rpx dashed rgba(255, 184, 107, 0.14);
}
.pf-module-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 8rpx;
}
.pf-module-no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34rpx;
  height: 34rpx;
  border-radius: 50%;
  background: rgba(114, 247, 255, 0.14);
  color: $rf-cyan;
  font-size: 22rpx;
  font-weight: 700;
}
.pf-module-title {
  font-size: 26rpx;
  font-weight: 600;
  color: $rf-cream;
}
.pf-module-verdict {
  font-size: 22rpx;
  color: $rf-amber;
}
.pf-module-summary {
  display: block;
  font-size: 23rpx;
  color: $rf-cream;
  line-height: 1.5;
  margin-bottom: 8rpx;
}
.pf-module-points {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.pf-module-point {
  display: flex;
  font-size: 22rpx;
  color: $rf-muted;
  line-height: 1.45;
}
.pf-dot {
  margin-right: 8rpx;
  color: $rf-cyan;
}
.pf-report-disclaimer {
  display: block;
  margin-top: 20rpx;
  font-size: 20rpx;
  color: $rf-muted;
  line-height: 1.5;
}
.pf-note--muted {
  color: $rf-muted;
  font-size: 21rpx;
  margin-bottom: 16rpx;
}
</style>
