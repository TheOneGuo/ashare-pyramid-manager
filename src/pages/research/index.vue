<template>
  <view class="rs-page" :class="{ 'h5-mode': isH5 }">
    <TabBarComp v-if="isH5" />
    <!-- 固定在顶部的 head 区：标题 + 两个子 tab -->
    <view class="rs-head">
    <view class="rs-header">
      <text class="rs-title">AI 研报</text>
      <text class="rs-meta">引入外部研报 · AI 精读提炼 · 已持仓标的逐标分析</text>
    </view>

    <!-- 两个子 tab -->
    <view class="rs-tabbar">
      <view class="rs-tab" :class="{ 'rs-tab--active': tab === 'refine' }" @tap="tab = 'refine'">
        <text>研报 AI 精读提炼</text>
      </view>
      <view class="rs-tab" :class="{ 'rs-tab--active': tab === 'held' }" @tap="tab = 'held'">
        <text>持仓标的 AI 研报分析</text>
      </view>
    </view>
    </view>

    <!-- 可滚动内容区（滚动条仅在此区域内） -->
    <view class="rs-body">
    <!-- Tab 1：研报 AI 精读提炼 -->
    <view v-if="tab === 'refine'" class="rs-pane">
      <view class="rs-card rs-input-card">
        <text class="rs-section-title">📥 引入外部研报（整篇原文）</text>
        <text class="rs-note rs-note--muted">支持外资机构、国内券商、行业研究等完整报告。粘贴全文或上传 .txt/.md，AI 自动提炼核心观点、新机会与风险。无需填写代码或名称。</text>

        <view class="rs-row">
          <input class="rs-input rs-input--sm" v-model="inTitle" placeholder="标题（可选）" />
          <input class="rs-input rs-input--sm" v-model="inBroker" placeholder="来源机构（可选）" />
        </view>
        <view class="rs-row">
          <input class="rs-input rs-input--sm" v-model="inIndustry" placeholder="行业 / 主题（可选）" />
          <input class="rs-input rs-input--sm" v-model="inUrl" placeholder="原文链接（可选）" />
        </view>

        <textarea
          v-model="inRaw"
          class="rs-textarea"
          placeholder="在此粘贴研报全文（或上传文件）。例如外资投行对某一行业的深度报告、国内券商个股研报等。"
          :auto-height="true"
        />

        <view class="rs-actions">
          <view class="rs-btn rs-btn--ghost" hover-class="rs-btn--hover" @tap="onPickFile">
            <text>📎 上传文件</text>
          </view>
          <view class="rs-btn rs-btn--primary" hover-class="rs-btn--hover" @tap="onIngest" :class="{ 'rs-btn--loading': ingesting }">
            <text>{{ ingesting ? 'AI 精读中…' : '✦ AI 精读' }}</text>
          </view>
        </view>
        <!-- #ifdef H5 -->
        <input ref="fileInput" type="file" accept=".txt,.md,.text" style="display:none" @change="onFileChange" />
        <!-- #endif -->
      </view>

      <view v-if="reports.length === 0" class="rs-empty">
        <text>还没有引入研报。粘贴或上传一篇报告，让 AI 帮你精读。</text>
      </view>

      <view v-for="r in reports" :key="r.id" class="rs-card rs-report-card">
        <view class="rs-report-head" @tap="toggleExpand(r.id)">
          <view class="rs-report-head-main">
            <text class="rs-report-title">{{ r.title }}</text>
            <text class="rs-report-meta">{{ [r.broker, r.industry].filter(Boolean).join(' · ') || '外部研报' }}</text>
          </view>
          <text class="rs-report-chevron">{{ expanded.has(r.id) ? '▾' : '▸' }}</text>
        </view>

        <view v-if="expanded.has(r.id)" class="rs-report-body">
          <view class="rs-tldr">
            <text class="rs-tldr-label">✦ 一句话精读</text>
            <text class="rs-tldr-body">{{ r.tldr }}</text>
          </view>

          <view v-if="r.key_points.length" class="rs-block">
            <text class="rs-block-label">📌 核心观点提炼</text>
            <view v-for="(p, i) in r.key_points" :key="i" class="rs-li"><text class="rs-dot">·</text><text>{{ p }}</text></view>
          </view>

          <view v-if="r.opportunities.length" class="rs-block">
            <text class="rs-block-label">💡 发现的新机会</text>
            <view v-for="(p, i) in r.opportunities" :key="i" class="rs-li"><text class="rs-dot">·</text><text>{{ p }}</text></view>
          </view>

          <view v-if="r.risks.length" class="rs-block">
            <text class="rs-block-label">⚠️ 风险点</text>
            <view v-for="(p, i) in r.risks" :key="i" class="rs-li rs-li--risk"><text class="rs-dot">·</text><text>{{ p }}</text></view>
          </view>

          <view class="rs-block">
            <text class="rs-block-label rs-block-label--link" @tap="toggleRaw(r.id)">{{ showRaw.has(r.id) ? '隐藏原文 ▲' : '查看原文 ▼' }}</text>
            <text v-if="showRaw.has(r.id)" class="rs-raw">{{ r.raw_text }}</text>
          </view>

          <view class="rs-report-foot">
            <text class="rs-report-time">{{ formatDate(r.created_at) }}</text>
            <text class="rs-report-del" @tap="onDeleteReport(r.id)">删除</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Tab 2：持仓标的 AI 研报分析 -->
    <view v-else class="rs-pane">
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
      <text>AI 生成内容不构成投资建议；当前为演示模式，研报数据未接入真实 LLM。</text>
    </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
// H5 端手动挂载自定义 tabBar（WeChat 端由 custom:true 自动挂载，此处按条件跳过）
const isH5 = ref(typeof window !== 'undefined')
import TabBarComp from '@/custom-tab-bar/index.vue'
import {
  ingestReport, listReports, deleteReport,
  listHoldings, researchReport, saveStockReport, listStockReports, deleteStockReport,
  type RefinedReport, type Holding, type StockReportItem, type ResearchReport,
} from '@/api/portfolio'

const tab = ref<'refine' | 'held'>('refine')

// Tab1 输入
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
</style>
