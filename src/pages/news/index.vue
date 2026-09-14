<template>
  <view class="news-page" :class="{ 'h5-mode': isH5 }">
    <TabBarComp v-if="isH5" />
    <!-- 固定在顶部的 head 区：标题 + 两段筛选 -->
    <view class="news-head">
      <view class="news-header">
        <text class="news-title">财经快讯</text>
        <text class="news-hint">下拉刷新最新资讯</text>
      </view>

      <!-- 两段式：全部 / 持仓标的相关 -->
      <view class="news-source-strip">
      <view
        class="news-source-chip"
        :class="{ active: activeScope === 'all' }"
        @tap="switchScope('all')"
      >
        <text>全部 · {{ allCount }}</text>
      </view>
      <view
        class="news-source-chip"
        :class="{ active: activeScope === 'holding' }"
        @tap="switchScope('holding')"
      >
        <text>持仓标的相关 · {{ holdingCount }}</text>
      </view>
    </view>
    </view>

    <!-- 可滚动内容区（滚动条仅在此区域内） -->
    <view class="news-body">
    <!-- 持仓标的关键词（顶部，用于筛选新闻） -->
    <view v-if="activeScope === 'holding'" class="news-kw-card">
      <view class="news-kw-head" @tap="kwOpen = !kwOpen">
        <view class="news-kw-head-main">
          <text class="news-kw-title">持仓标的关键词</text>
          <text class="news-kw-sub">展开可调整每个持仓标的的关键词</text>
        </view>
        <text class="news-kw-toggle">{{ kwOpen ? '收起' : '展开' }}</text>
      </view>
      <view v-if="kwOpen">
      <view v-if="focusCode" class="news-kw-focus">
        正在聚焦：<text class="news-kw-focus-code">{{ focusName }}（{{ focusCode }}）</text>
        <text class="news-kw-focus-clear" @tap.stop="clearFocus">✕ 取消聚焦</text>
      </view>
      <view v-for="pr in kwProfiles" :key="pr.stock_code" class="news-kw-item">
        <view class="news-kw-row">
          <text class="news-kw-name">{{ pr.short_name || pr.stock_code }}</text>
          <text class="news-kw-code">{{ pr.stock_code }}</text>
        </view>
        <input class="news-kw-input" v-model="pr.keywords" placeholder="上游原材料, 产品, 客户, 政策域, 自定义…" />
      </view>
      <view class="news-kw-actions">
        <view class="news-kw-btn" hover-class="news-kw-btn--hover" @tap.stop="saveKeywords">保存关键词</view>
      </view>
      </view>
    </view>

    <view v-if="loading && items.length === 0" class="news-empty">
      <text>正在读取快讯…</text>
    </view>

    <view v-else-if="visibleItems.length === 0" class="news-empty">
      <text v-if="activeScope === 'holding'">
        {{ holdingCount === 0 ? '尚未添加持仓（持仓分析页可管理），目前没有"持仓标的相关"快讯。' : '最新信息正在拉取中，需要等 1–2 分钟…' }}
      </text>
      <text v-else>最新信息正在拉取中，需要等 1–2 分钟…</text>
    </view>

    <view class="news-list">
      <view
        v-for="item in visibleItems"
        :key="item.id"
        class="news-item"
        :class="{
          'is-matched': item.matchedHoldings.length > 0,
          'is-level-s': item.level === 'S',
          'is-level-a': item.level === 'A',
        }"
      >
        <view class="news-item-head">
          <view class="news-item-head-left">
            <text
              v-if="item.level === 'S' || item.level === 'A'"
              class="news-level"
              :class="item.level === 'S' ? 'news-level-s' : 'news-level-a'"
            >{{ item.levelLabel || (item.level === 'S' ? '重大' : '重要') }}</text>
            <text class="news-item-source">{{ item.sourceName || item.sourceChannel }}</text>
          </view>
          <text class="news-item-time">{{ formatTime(item.publishedAt) }}</text>
        </view>
        <view v-if="item.matchedHoldings.length > 0 || item.themeChips.length > 0" class="news-item-tags">
          <text v-if="item.matchedHoldings.length > 0" class="news-item-tag">持仓 {{ item.matchedHoldings.join(' · ') }}</text>
          <text v-for="chip in item.themeChips" :key="chip" class="news-theme-chip">{{ chip }}</text>
        </view>
        <text class="news-item-title">{{ item.title }}</text>
        <template v-if="item.summary">
          <text v-if="activeScope === 'holding' && (item.summary || '').length > 90 && !expandedIds.has(item.id)" class="news-item-summary news-item-summary--clamp">{{ item.summary.slice(0, 90) }}…</text>
          <text v-else class="news-item-summary">{{ item.summary }}</text>
          <text v-if="activeScope === 'holding' && (item.summary || '').length > 90" class="news-item-toggle" @tap="toggleExpand(item.id)">{{ expandedIds.has(item.id) ? '收起全文 ↑' : '展开全文 ↓' }}</text>
        </template>
        <view v-if="item.dupCount > 1 || item.alsoIn.length > 0" class="news-item-meta">
          <text v-if="item.dupCount > 1" class="news-dup-count">×{{ item.dupCount }}</text>
          <text v-if="item.alsoIn.length > 0" class="news-dup-sources">多源: {{ dupLabel(item) }}</text>
        </view>
      </view>
    </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { env } from '@/utils/env'
import { listHoldingProfiles, upsertHoldingProfile } from '@/api/portfolio'
// H5 端 uni-app 不会自动挂载 custom-tab-bar，需手动引入；WeChat 端走 custom:true 自动挂载，此处按条件跳过避免重复
const isH5 = ref(typeof window !== 'undefined')
import TabBarComp from '@/custom-tab-bar/index.vue'

// dev 阶段 vite proxy 把 /api 转到 9999；生产环境用 API_BASE_URL（uniCloud / Express）
const API_BASE = (env.API_BASE_URL && env.API_BASE_URL.length > 0) ? env.API_BASE_URL : ''

interface RawNews {
  id: string
  title: string
  summary?: string
  content?: string
  source_channel?: string
  source_name?: string
  link?: string
  url?: string
  published_at?: number
  // ── 由 server/src/news-relevance.js 产出的打分层字段（后端可能滞后，全部可选） ──
  score?: number
  level?: string
  level_label?: string
  reasons?: string[]
  tags?: string[]
  also_in?: string[]
  dup_count?: number
  pinned?: boolean
}

type NewsLevel = 'S' | 'A' | 'B'

interface NewsItem {
  id: string
  title: string
  summary: string
  sourceChannel: string
  sourceName: string
  publishedAt: number
  url: string
  matchedHoldings: string[]   // 命中的持仓股票代码（仅 holding=1 时计算）
  tags: string[]
  themeChips: string[]        // 由 tags 映射出的展示用小标签（A股/美股/政策/美股政策）
  alsoIn: string[]            // 同源报道的其他来源名
  dupCount: number
  score: number
  level: NewsLevel
  levelLabel: string
  reasons: string[]
  pinned: boolean             // 服务端判定为「重要度置顶」，应在列表最前
}

const items = ref<NewsItem[]>([])
const loading = ref(false)
const activeScope = ref<'all' | 'holding'>('all')
const expandedIds = ref<Set<string>>(new Set())
function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  expandedIds.value = next
}
const holdings = ref<Array<{ stock_code: string; short_name?: string }>>([])
const kwProfiles = ref<Array<{ stock_code: string; short_name?: string; keywords: string }>>([])
const kwOpen = ref(false)
const focusCode = ref<string>('')
const focusName = ref<string>('')

function normalizeCode(c: string) {
  return String(c || '').padStart(6, '0').slice(-6)
}

async function loadHoldings() {
  try {
    // #ifdef H5
    console.log('[news] GET', `${API_BASE}/api/holdings`)
    // #endif
    const res = await uni.request({ url: `${API_BASE}/api/holdings`, method: 'GET', timeout: 12000 })
    const data: any = (res as any).data
    if (data && data.ok && Array.isArray(data.items)) {
      holdings.value = data.items.map((h: any) => ({
        stock_code: normalizeCode(h.stock_code),
        short_name: h.short_name || '',
      }))
      // #ifdef H5
      console.log('[news] holdings loaded:', JSON.stringify(holdings.value))
      // #endif
    } else {
      console.warn('[news] holdings payload bad', data)
    }
  } catch (e: any) {
    console.warn('[news] loadHoldings failed', e?.errMsg || e?.message)
    holdings.value = []
  }
  // 同步持仓关键词画像
  await loadProfiles()
}

// 持仓标的关键词画像（顶部卡片可编辑，库表 holding_profiles）
async function loadProfiles() {
  let stored: any[] = []
  try {
    const r: any = await listHoldingProfiles()
    stored = r.profiles || []
  } catch (e) { console.warn('[news] loadProfiles failed', e) }
  // 只保留当前持仓的标的（移除已清仓/不再持有的旧画像），确保与最新持仓同步
  const list = holdings.value.map((h) => {
    const code = normalizeCode(h.stock_code)
    const sp = stored.find((p: any) => normalizeCode(p.stock_code) === code)
    const keywords = sp ? [
      ...(sp.raw_materials || []),
      ...(sp.products || []),
      ...(sp.customers || []),
      ...(sp.overseas_peers || []),
      ...(sp.policy_domains || []),
      ...(sp.transport || []),
      ...(sp.extra_keywords || []),
    ].join(',') : ''
    return { stock_code: code, short_name: h.short_name || sp?.short_name || '', keywords }
  })
  kwProfiles.value = list
}
async function saveKeywords() {
  uni.showLoading({ title: '保存中…' })
  try {
    for (const pr of kwProfiles.value) {
      const arr = String(pr.keywords || '').split(/[,，\n]/).map((s: string) => s.trim()).filter(Boolean)
      await upsertHoldingProfile({ stock_code: pr.stock_code, extra_keywords: arr })
    }
    uni.hideLoading()
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e: any) { uni.hideLoading(); uni.showToast({ title: e?.message || '保存失败', icon: 'none' }) }
}
// 跨页联动：持仓页点击某标的跳过来聚焦
function applyFocusFromStorage() {
  const code = uni.getStorageSync('portfolio_focus_code')
  const name = uni.getStorageSync('portfolio_focus_name')
  if (code) { focusCode.value = normalizeCode(code); focusName.value = name || code }
  else { focusCode.value = ''; focusName.value = '' }
}
function clearFocus() { focusCode.value = ''; focusName.value = ''; uni.removeStorageSync('portfolio_focus_code') }

// 用持仓代码/简称在标题/摘要里做一次轻量关键词匹配；命中后给卡片打 tag。
function detectMatchedHoldings(item: NewsItem): string[] {
  if (holdings.value.length === 0) return []
  const text = `${item.title} ${item.summary}`
  const hits: string[] = []
  for (const h of holdings.value) {
    const code = h.stock_code
    const name = h.short_name || ''
    const codeOk = code && /\d{6}/.test(code) && text.includes(code)
    const nameOk = name && name.length >= 2 && text.includes(name)
    if (codeOk || nameOk) hits.push(code)
  }
  return Array.from(new Set(hits))
}

// ── 链路韧性：Turso 海外直连偶发卡顿，后端可能返回空列表(warming)或前端超时。
// 处理原则：不把内部错误当快讯卡片展示，而是保持"拉取中"提示并自动重试。 ──
const RETRY_MS = 12000
let retryTimer: any = null
function clearRetry() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null } }
function scheduleRetry(scope: 'all' | 'holding') {
  if (retryTimer) return
  retryTimer = setTimeout(() => { retryTimer = null; fetchNews(false, scope) }, RETRY_MS)
}

async function fetchNews(showLoading = true, scope: 'all' | 'holding' | null = null) {
  const useScope = scope || activeScope.value
  if (showLoading) loading.value = true
  try {
    const q = useScope === 'holding' ? 'limit=100&holding=1' : 'limit=100'
    const url = `${API_BASE}/api/news?${q}`
    if (useScope === 'holding') holdingTotal.value = 0
    // #ifdef H5
    console.log('[news] GET', url)
    // #endif
    // 超时放宽到 20s：后端读 Turso 偶发变慢，8s 会在数据返回前先超时报错
    const res = await uni.request({ url, method: 'GET', timeout: 20000 })
    const data: any = (res as any).data
    if (data && data.ok && Array.isArray(data.items)) {
      items.value = data.items.map((it: RawNews) => mapItem(it))
      if (useScope === 'holding') holdingTotal.value = data.count ?? data.items.length
      // 后端在做预热(warming)或暂时还没数据 → 稍后自动再拉，直到有内容
      if (data.warming || items.value.length === 0) scheduleRetry(useScope)
      else clearRetry()
    } else {
      console.warn('[news] bad payload', data)
      scheduleRetry(useScope)
    }
  } catch (e: any) {
    console.error('[news] fetch failed', e?.errMsg || e?.message || e)
    // 不再插入「后端请求失败」卡片：抖动期展示"拉取中"并自动重试即可
    scheduleRetry(useScope)
  } finally {
    loading.value = false
  }
}

// 只用 4 个最有信息量的主题标签，避免 chip 刷屏；其余 tag（macro/industry/code…）不展示
const THEME_TAG_LABELS: Record<string, string> = {
  a_stock: 'A股',
  us_stock: '美股',
  cn_policy: '政策',
  us_policy: '美股政策',
}
function themeChipsFrom(tags: string[]): string[] {
  const out: string[] = []
  for (const t of tags || []) {
    const label = THEME_TAG_LABELS[t]
    if (label && !out.includes(label)) out.push(label)
  }
  return out
}

function dupLabel(item: NewsItem): string {
  const names = (item.alsoIn || []).slice(0, 2).join('·')
  return item.alsoIn.length > 2 ? `${names}等` : names
}

function mapItem(raw: RawNews): NewsItem {
  const level: NewsLevel = raw.level === 'S' || raw.level === 'A' ? raw.level : 'B'
  const tags = Array.isArray(raw.tags) ? raw.tags : []
  const alsoIn = Array.isArray(raw.also_in) ? raw.also_in : []
  const dupRaw = Number(raw.dup_count)
  const base: NewsItem = {
    id: raw.id,
    title: raw.title || '(无标题)',
    summary: raw.content || raw.summary || '',
    sourceChannel: raw.source_channel || 'unknown',
    sourceName: raw.source_name || raw.source_channel || '来源',
    publishedAt: raw.published_at || Date.now(),
    url: raw.link || raw.url || '',
    matchedHoldings: [],
    tags,
    themeChips: themeChipsFrom(tags),
    alsoIn,
    dupCount: Number.isFinite(dupRaw) && dupRaw > 0 ? dupRaw : 1,
    score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : 0,
    level,
    levelLabel: raw.level_label || '',
    reasons: Array.isArray(raw.reasons) ? raw.reasons : [],
    pinned: raw.pinned === true,
  }
  base.matchedHoldings = detectMatchedHoldings(base)
  return base
}



function formatTime(ts: number) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 计数（依赖 items 重算）
const allCount = computed(() => items.value.length)
// 持仓相关数：由持仓 feed 实际返回量决定（服务端已按持仓+宏观过滤）
const holdingTotal = ref(0)
const holdingCount = computed(() => (activeScope.value === 'holding' ? items.value.length : holdingTotal.value))

// 重要度置顶：
// 服务端已按「分数置顶 + 时间保序」排好序并下发 pinned 标记，前端不再二次重排
// （否则服务端的置顶区会被本地的 S 级置顶逻辑打乱）。仅当服务端未下发 pinned
// （旧版本后端 / 缓存响应）时，回退到「S 级稳定置顶」以保持观感。
function pinLevelS(list: NewsItem[]): NewsItem[] {
  if (list.some((it) => it.pinned)) return list
  if (!list.some((it) => it.level === 'S')) return list
  const top: NewsItem[] = []
  const rest: NewsItem[] = []
  for (const it of list) (it.level === 'S' ? top : rest).push(it)
  return top.concat(rest)
}

const visibleItems = computed(() => {
  if (activeScope.value === 'all') return pinLevelS(items.value)
  // 持仓相关：服务端已返回关联内容，这里直接展示（matchedHoldings 仅用于标签）
  let list = items.value
  // 若从持仓页聚焦某标的，则只显示该标的代码命中或画像关键词命中的新闻
  if (focusCode.value) {
    const code = focusCode.value
    const kwArr = (kwProfiles.value.find((p) => p.stock_code === code)?.keywords || '').split(/[,，\n]/).map((s: string) => s.trim()).filter(Boolean)
    list = list.filter((it: any) => {
      const text = `${it.title} ${it.summary}`
      if (text.includes(code)) return true
      return kwArr.some((k: string) => k && text.includes(k))
    })
  }
  return pinLevelS(list)
})

onMounted(async () => {
  await loadHoldings()
  await fetchNews(true)
})

onShow(async () => {
  applyFocusFromStorage()
  // 切回前台：如果 holdings 变了，按当前 tab 重新拉取
  await loadHoldings()
  await fetchNews(false)
})

onPullDownRefresh(async () => {
  await loadHoldings()
  await fetchNews(true)
  uni.stopPullDownRefresh()
})

function switchScope(scope: 'all' | 'holding') {
  // 先切换 scope 再拉取，避免拿到上一个 scope 的内容
  activeScope.value = scope
  if (scope === 'holding') applyFocusFromStorage()
  fetchNews(false, scope)
}

// 持仓标的相关/财经快讯 自动刷新（页面在前台时每 30s 拉一次，切走即停）
const NEWS_POLL_MS = 30000
let pollTimer: any = null
function startNewsPoll() {
  stopNewsPoll()
  pollTimer = setInterval(() => { fetchNews(false) }, NEWS_POLL_MS)
}
function stopNewsPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
// H5 端切到别的 tab 时暂停轮询，避免后台空转
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopNewsPoll()
    else startNewsPoll()
  })
}
onMounted(() => startNewsPoll())
onBeforeUnmount(() => { stopNewsPoll(); clearRetry() })
</script>

<style lang="scss" scoped>
// 原项目色板（heatmap_app tokens.css）
$rf-cyan: #72f7ff;
$rf-amber: #ffb86b;
$rf-orange: rgba(255, 184, 107, 1);
$rf-cream: #f5ecd9;
$rf-muted: #a89a82;
$color-bg: #0b0b0d;
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$color-text-warm: #d3c3ad;
$color-match-bg: rgba(114, 247, 255, 0.12);
$color-match-border: rgba(114, 247, 255, 0.5);
// 重要度色板（A股习惯：红 = 重大/上涨，琥珀 = 重要）
$rf-red: #ff4d4f;
$color-level-s: $rf-red;
$color-level-s-bg: rgba(255, 77, 79, 0.1);
$color-level-s-border: rgba(255, 77, 79, 0.5);
$color-level-a: $rf-amber;
$color-level-a-bg: rgba(255, 184, 107, 0.08);
$color-level-a-border: rgba(255, 184, 107, 0.5);
$radius-md: 14px;
$radius-lg: 18px;
$radius-full: 999px;

.news-page {
  min-height: 100vh;
  background: $color-bg;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.032) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.032) 1px, transparent 1px);
  background-size: 48px 48px;
  padding: 24rpx 24rpx calc(160rpx + env(safe-area-inset-bottom, 0px));
}

/* H5：页面作为包含 head(固定) + body(滚动) 的容器，止于 tab 上沿 */
.news-page.h5-mode {
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
.news-head {
  flex: 0 0 auto;
  padding: 16rpx 0 8rpx;
  margin-bottom: 12rpx;
  background: $color-bg;
}
/* body 区滚动，右侧美化金色滚动条只在此处 */
.news-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 24rpx calc(140rpx + env(safe-area-inset-bottom, 0px));
}
.news-body::-webkit-scrollbar { width: 5rpx; }
.news-body::-webkit-scrollbar-track { background: transparent; }
.news-body::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #fff4c0 0%, #f4c542 50%, #d89c1c 100%);
  border-radius: 6rpx;
}
.news-body { scrollbar-width: thin; scrollbar-color: #d89c1c transparent; }

.news-header {
  display: flex;
  flex-direction: column;
  padding: 0;
}

.news-title {
  font-size: 44rpx;
  font-weight: 700;
  color: $color-text-primary;
  letter-spacing: 1rpx;
}

.news-hint {
  font-size: 22rpx;
  color: $color-text-secondary;
  margin-top: 8rpx;
  letter-spacing: 1rpx;
}

/* 源筛选条 */
.news-source-strip {
  display: flex;
  gap: 12rpx;
  padding: 16rpx 0 20rpx;
}

.news-source-chip {
  flex: 1;
  box-sizing: border-box;
  text-align: center;
  padding: 20rpx 12rpx;
  font-size: 26rpx;
  color: $color-text-secondary;
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  border-radius: 14rpx;

  &.active {
    color: $color-bg;
    background: linear-gradient(135deg, $rf-amber 0%, #ff7a3d 100%);
    border-color: transparent;
    font-weight: 600;
  }
}

.news-empty {
  padding: 200rpx 40rpx;
  text-align: center;
  color: $color-text-secondary;
  font-size: 28rpx;
  line-height: 1.6;
}

/* 持仓标的关键词卡 */
.news-kw-card {
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  border-radius: $radius-lg;
  padding: 20rpx 20rpx 16rpx;
  margin-bottom: 16rpx;
}
.news-kw-head { display: flex; flex-direction: row; align-items: center; justify-content: space-between; cursor: pointer; }
.news-kw-head-main { display: flex; flex-direction: column; }
.news-kw-title { font-size: 28rpx; font-weight: 700; color: $color-text-primary; }
.news-kw-sub { font-size: 22rpx; color: $color-text-secondary; margin-top: 4rpx; }
.news-kw-toggle { font-size: 22rpx; color: $rf-amber; padding: 8rpx 12rpx; }
.news-kw-focus {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 22rpx; color: $rf-amber; padding: 10rpx 0;
}
.news-kw-focus-code { color: $rf-amber; font-weight: 600; }
.news-kw-focus-clear { color: $color-text-secondary; padding: 4rpx 8rpx; }
.news-kw-item { border-top: 1rpx solid $color-border; padding: 12rpx 0 4rpx; }
.news-kw-row { display: flex; align-items: baseline; gap: 10rpx; }
.news-kw-name { font-size: 24rpx; color: $color-text-primary; font-weight: 600; }
.news-kw-code { font-size: 20rpx; color: $color-text-secondary; }
.news-kw-input {
  width: 100%; box-sizing: border-box;
  margin-top: 6rpx; padding: 16rpx 16rpx;
  min-height: 72rpx;
  font-size: 24rpx; line-height: 1.4; color: $color-text-primary;
  background: rgba(0,0,0,0.25); border: 1rpx solid $color-border; border-radius: $radius-md;
}
.news-kw-actions { display: flex; justify-content: flex-end; margin-top: 12rpx; }
.news-kw-btn {
  font-size: 22rpx; color: #0d1b2a; font-weight: 600;
  background: linear-gradient(135deg, #ffb86b 0%, #ff7a3d 100%);
  padding: 12rpx 28rpx; border-radius: $radius-md;
}
.news-kw-btn--hover { opacity: 0.85; }

/* 列表 */
.news-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.news-item {
  padding: 24rpx 24rpx 20rpx;
  border-radius: $radius-lg;
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  transition: transform 0.15s ease;

  &.is-matched {
    border-color: $color-match-border;
    background: linear-gradient(180deg, rgba(114, 247, 255, 0.07), rgba(255, 184, 107, 0.03));
  }

  // 重要度：左侧色条 + 淡色底，红=重大(S)、琥珀=重要(A)
  &.is-level-s {
    border-color: $color-level-s-border;
    border-left: 3px solid $color-level-s;
    background: linear-gradient(180deg, $color-level-s-bg, rgba(255, 184, 107, 0.025));
  }

  &.is-level-a {
    border-color: $color-level-a-border;
    border-left: 3px solid $color-level-a;
    background: linear-gradient(180deg, $color-level-a-bg, rgba(114, 247, 255, 0.02));
  }
}

.news-item:active {
  transform: scale(0.98);
}

.news-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 12rpx;
}

.news-item-head-left {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex: 1 1 auto;
  min-width: 0;
}

.news-level {
  display: inline-block;
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  font-weight: 700;
  border-radius: $radius-full;
  white-space: nowrap;
}
.news-level-s {
  color: #fff;
  background: $color-level-s;
  border: 1rpx solid $color-level-s;
}
.news-level-a {
  color: $color-bg;
  background: $color-level-a;
  border: 1rpx solid $color-level-a;
}

.news-item-source {
  font-size: 22rpx;
  color: $rf-cyan;
  font-weight: 600;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.news-item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-bottom: 12rpx;
}

.news-item-tag {
  display: inline-block;
  padding: 4rpx 12rpx;
  font-size: 20rpx;
  color: $rf-cyan;
  background: $color-match-bg;
  border: 1rpx solid $color-match-border;
  border-radius: $radius-full;
}

.news-theme-chip {
  display: inline-block;
  padding: 4rpx 12rpx;
  font-size: 20rpx;
  color: $color-text-warm;
  background: rgba(255, 184, 107, 0.08);
  border: 1rpx solid $color-border;
  border-radius: $radius-full;
}

/* 多源 / 重复报道 */
.news-item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
  margin-top: 12rpx;
}
.news-dup-count {
  font-size: 20rpx;
  font-weight: 700;
  color: $rf-amber;
  padding: 2rpx 10rpx;
  background: rgba(255, 184, 107, 0.1);
  border-radius: $radius-full;
}
.news-dup-sources {
  font-size: 20rpx;
  color: $color-text-secondary;
}

.news-item-time {
  font-size: 22rpx;
  color: $color-text-secondary;
  white-space: nowrap;
}

.news-item-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: $color-text-primary;
  line-height: 1.5;
}

.news-item-summary {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 1.65;
  color: $color-text-warm;
  white-space: pre-wrap;
}
.news-item-summary--clamp {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
}
.news-item-toggle {
  display: inline-block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $rf-amber;
  font-weight: 600;
}

// ─────────────────────────────────────────────────────────
// 折叠屏/平板专属（H5，宽 700~1400px）：整页左右双栏。
// 左栏 = head（全部/持仓 切换），右栏 = 快讯流。恢复直板机物理尺寸（px）。
// 直板机（< 700px）不受影响。
// ─────────────────────────────────────────────────────────
@include fold-wide {
  .news-page.h5-mode { flex-direction: row; }

  .news-head {
    flex: 0 0 240px;
    width: 240px;
    border-right: 1rpx solid $color-border;
    padding: 16rpx 14rpx 24rpx;
    overflow-y: auto;
  }
  .news-title { font-size: 20px; }
  .news-hint { font-size: 11px; }
  .news-source-strip { flex-direction: column; gap: 8rpx; padding: 10rpx 0; }
  .news-source-chip { padding: 8rpx 12rpx; font-size: 14px; border-radius: $radius-md; width: 100%; box-sizing: border-box; justify-content: center; }

  .news-body { flex: 1; min-width: 0; padding: 12px 14px 12px; }
  .news-kw-title { font-size: 14px; }
  .news-kw-sub { font-size: 11px; }
  .news-kw-name { font-size: 13px; }
  .news-kw-code { font-size: 11px; }
  .news-item-title { font-size: 14px; }
  .news-item-time { font-size: 11px; }
  .news-item-source { font-size: 11px; }
  .news-level { font-size: 11px; padding: 1px 6px; }
  .news-theme-chip { font-size: 11px; padding: 1px 6px; }
  .news-dup-count { font-size: 11px; padding: 1px 6px; }
  .news-dup-sources { font-size: 11px; }
}
</style>