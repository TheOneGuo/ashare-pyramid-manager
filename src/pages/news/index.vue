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
        @tap="activeScope = 'all'"
      >
        <text>全部 · {{ allCount }}</text>
      </view>
      <view
        class="news-source-chip"
        :class="{ active: activeScope === 'holding' }"
        @tap="activeScope = 'holding'"
      >
        <text>持仓标的相关 · {{ holdingCount }}</text>
      </view>
    </view>
    </view>

    <!-- 可滚动内容区（滚动条仅在此区域内） -->
    <view class="news-body">
    <view v-if="loading && items.length === 0" class="news-empty">
      <text>正在读取快讯…</text>
    </view>

    <view v-else-if="visibleItems.length === 0" class="news-empty">
      <text v-if="activeScope === 'holding'">
        {{ holdingCount === 0 ? '尚未添加持仓（持仓分析页可管理），目前没有"持仓标的相关"快讯。' : '当前持仓标的相关暂无 24 小时内的快讯，可下拉刷新试试。' }}
      </text>
      <text v-else>最近 24 小时暂时没有可展示的重要快讯，下拉试试。</text>
    </view>

    <view class="news-list">
      <view
        v-for="item in visibleItems"
        :key="item.id"
        class="news-item"
        :class="{ 'is-matched': item.matchedHoldings.length > 0 }"
      >
        <view class="news-item-head">
          <text class="news-item-source">{{ item.sourceName || item.sourceChannel }}</text>
          <text class="news-item-time">{{ formatTime(item.publishedAt) }}</text>
        </view>
        <view v-if="item.matchedHoldings.length > 0" class="news-item-tags">
          <text class="news-item-tag">持仓 {{ item.matchedHoldings.join(' · ') }}</text>
        </view>
        <text class="news-item-title">{{ item.title }}</text>
        <text v-if="item.summary" class="news-item-summary">{{ item.summary }}</text>
      </view>
    </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { env } from '@/utils/env'
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
}

interface NewsItem {
  id: string
  title: string
  summary: string
  sourceChannel: string
  sourceName: string
  publishedAt: number
  url: string
  matchedHoldings: string[]   // 命中的持仓股票代码（仅 holding=1 时计算）
}

const items = ref<NewsItem[]>([])
const loading = ref(false)
const activeScope = ref<'all' | 'holding'>('all')
const holdings = ref<Array<{ stock_code: string; short_name?: string }>>([])

function normalizeCode(c: string) {
  return String(c || '').padStart(6, '0').slice(-6)
}

async function loadHoldings() {
  try {
    // #ifdef H5
    console.log('[news] GET', `${API_BASE}/api/holdings`)
    // #endif
    const res = await uni.request({ url: `${API_BASE}/api/holdings`, method: 'GET', timeout: 5000 })
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
}

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

async function fetchNews(showLoading = true) {
  if (showLoading) loading.value = true
  try {
    const url = `${API_BASE}/api/news?limit=100`
    // #ifdef H5
    console.log('[news] GET', url)
    // #endif
    const res = await uni.request({ url, method: 'GET', timeout: 8000 })
    const data: any = (res as any).data
    if (data && data.ok && Array.isArray(data.items)) {
      items.value = data.items.map((it: RawNews) => mapItem(it))
    } else {
      console.warn('[news] bad payload', data)
    }
  } catch (e: any) {
    console.error('[news] fetch failed', e?.errMsg || e?.message || e)
    if (items.value.length === 0) {
      items.value = [
        {
          id: 'err-' + Date.now(),
          title: '后端请求失败：' + (e?.errMsg || e?.message || 'unknown'),
          summary: '请确认 express 服务在 ' + API_BASE + ' 运行（cd server && node src/index.js）',
          sourceChannel: 'system',
          sourceName: '系统',
          publishedAt: Date.now(),
          url: '',
          matchedHoldings: [],
        },
      ]
    }
  } finally {
    loading.value = false
  }
}

function mapItem(raw: RawNews): NewsItem {
  const base: NewsItem = {
    id: raw.id,
    title: raw.title || '(无标题)',
    summary: raw.content || raw.summary || '',
    sourceChannel: raw.source_channel || 'unknown',
    sourceName: raw.source_name || raw.source_channel || '来源',
    publishedAt: raw.published_at || Date.now(),
    url: raw.link || raw.url || '',
    matchedHoldings: [],
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
const holdingCount = computed(() => items.value.filter((i) => i.matchedHoldings.length > 0).length)

const visibleItems = computed(() => {
  if (activeScope.value === 'all') return items.value
  return items.value.filter((i) => i.matchedHoldings.length > 0)
})

onMounted(async () => {
  await loadHoldings()
  await fetchNews(true)
})

onShow(async () => {
  // 切回前台：如果 holdings 变了，重新匹配一次
  await loadHoldings()
  if (items.value.length > 0) {
    items.value = items.value.map((it) => ({ ...it, matchedHoldings: detectMatchedHoldings(it) }))
  }
})

onPullDownRefresh(async () => {
  await loadHoldings()
  await fetchNews(true)
  uni.stopPullDownRefresh()
})

onBeforeUnmount(() => {})
</script>

<style lang="scss" scoped>
// 原项目色板（heatmap_app tokens.css）
$rf-cyan: #72f7ff;
$rf-amber: #ffb86b;
$rf-orange: rgba(255, 184, 107, 1);
$rf-cream: #f5ecd9;
$rf-muted: #a89a82;
$color-bg: #0d1b2a;
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$color-text-warm: #d3c3ad;
$color-match-bg: rgba(114, 247, 255, 0.12);
$color-match-border: rgba(114, 247, 255, 0.5);
$radius-md: 14px;
$radius-lg: 18px;
$radius-full: 999px;

.news-page {
  min-height: 100vh;
  background: $color-bg;
  padding: 24rpx 24rpx 150rpx;
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
  padding: 16rpx 24rpx 0;
  background: $color-bg;
}
/* body 区滚动，右侧美化金色滚动条只在此处 */
.news-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 24rpx 24rpx;
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
  padding: 16rpx 0 8rpx;
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

.news-item-source {
  font-size: 22rpx;
  color: $rf-cyan;
  font-weight: 600;
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

</style>