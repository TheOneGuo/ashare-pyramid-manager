<template>
  <view class="news-page">
    <view class="news-header">
      <view class="news-header-row">
        <text class="news-title">财经快讯</text>
        <text class="news-refresh-btn" @tap="onManualRefresh">刷新</text>
      </view>
      <text class="news-meta">{{ lastUpdated }} · {{ refreshLabel }}自动刷新</text>
    </view>

    <!-- 源筛选条（原项目 news-source-strip 风格） -->
    <scroll-view class="news-source-strip" scroll-x enable-flex>
      <view
        v-for="src in sources"
        :key="src.channel"
        class="news-source-chip"
        :class="{ active: src.channel === activeSource }"
        @tap="activeSource = src.channel"
      >
        <text>{{ src.name }} · {{ src.count }}</text>
      </view>
    </scroll-view>

    <view v-if="loading && items.length === 0" class="news-empty">
      <text>正在读取快讯…</text>
    </view>

    <view v-else-if="visibleItems.length === 0" class="news-empty">
      <text>{{ activeSource === 'all' ? '最近 24 小时暂时没有可展示的重要快讯。' : '该来源暂无快讯' }}</text>
    </view>

    <view v-else class="news-list">
      <view
        v-for="item in visibleItems"
        :key="item.id"
        class="news-item"
        @tap="onTapItem(item)"
      >
        <view class="news-item-head">
          <text class="news-item-source">{{ item.sourceName || item.sourceChannel }}</text>
          <text class="news-item-time">{{ formatTime(item.publishedAt) }}</text>
        </view>
        <text class="news-item-title">{{ item.title }}</text>
        <text v-if="item.summary" class="news-item-summary">{{ item.summary }}</text>
        <text v-if="item.url" class="news-item-link">查看原文 ›</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { env } from '@/utils/env'

const API_BASE = env.API_BASE_URL || 'http://localhost:9999'

interface RawNews {
  id: string
  title: string
  summary?: string
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
}

const items = ref<NewsItem[]>([])
const loading = ref(false)
const lastUpdated = ref('未刷新')
const refreshLabel = ref('30秒')
const activeSource = ref<string>('all')

let pollTimer: ReturnType<typeof setInterval> | null = null

const POLL_INTERVAL_MS = 30 * 1000

const sources = computed(() => {
  const map = new Map<string, { channel: string; name: string; count: number }>()
  for (const it of items.value) {
    const key = it.sourceChannel || 'unknown'
    if (!map.has(key)) {
      map.set(key, { channel: key, name: it.sourceName || key, count: 0 })
    }
    map.get(key)!.count++
  }
  const list = [{ channel: 'all', name: '全部', count: items.value.length }]
  for (const v of map.values()) list.push(v)
  return list
})

const visibleItems = computed(() => {
  if (activeSource.value === 'all') return items.value
  return items.value.filter(it => (it.sourceChannel || 'unknown') === activeSource.value)
})

function mapItem(raw: RawNews): NewsItem {
  return {
    id: raw.id,
    title: raw.title || '(无标题)',
    summary: raw.summary || '',
    sourceChannel: raw.source_channel || 'unknown',
    sourceName: raw.source_name || raw.source_channel || '来源',
    publishedAt: raw.published_at || Date.now(),
    url: raw.link || raw.url || '',
  }
}

async function fetchNews(showLoading = true) {
  if (showLoading) loading.value = true
  try {
    const url = `${API_BASE}/api/news?limit=80`
    // #ifdef H5
    console.log('[news] GET', url)
    // #endif
    const res = await uni.request({
      url,
      method: 'GET',
      timeout: 8000,
    })
    const data: any = (res as any).data
    if (data && data.ok && Array.isArray(data.items)) {
      items.value = data.items.map((it: RawNews) => mapItem(it))
      lastUpdated.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    } else {
      // 兜底：保留旧值，不覆盖
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
        },
      ]
    }
  } finally {
    loading.value = false
  }
}

function onManualRefresh() {
  fetchNews(true)
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(() => fetchNews(false), POLL_INTERVAL_MS)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
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

function onTapItem(item: NewsItem) {
  if (!item.url) return
  // #ifdef H5
  window.open(item.url, '_blank', 'noopener')
  // #endif
  // #ifndef H5
  uni.setClipboardData({ data: item.url })
  // #endif
}

onMounted(() => {
  fetchNews(true)
  startPolling()
})

onShow(() => {
  // 30 秒 tabbar 切回 / 回到前台时立即拉一次
  fetchNews(false)
})

onPullDownRefresh(() => {
  fetchNews(true).finally(() => uni.stopPullDownRefresh())
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<style lang="scss" scoped>
// 原项目色板（heatmap_app tokens.css）
$rf-cyan: #72f7ff;
$rf-orange: rgba(255, 184, 107, 1);
$rf-cream: #f5ecd9;
$rf-muted: #a89a82;
$color-bg: #0d1b2a;
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$color-text-warm: #d3c3ad;
$radius-md: 14px;
$radius-lg: 18px;
$radius-full: 999px;

.news-page {
  min-height: 100vh;
  background: $color-bg;
  padding: 24rpx 24rpx 48rpx;
}

.news-header {
  display: flex;
  flex-direction: column;
  padding: 16rpx 0 20rpx;
}

.news-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.news-title {
  font-size: 44rpx;
  font-weight: 700;
  color: $color-text-primary;
  letter-spacing: 1rpx;
}

.news-refresh-btn {
  font-size: 24rpx;
  color: $rf-cyan;
  padding: 8rpx 18rpx;
  border: 1rpx solid rgba(114, 247, 255, 0.48);
  border-radius: $radius-full;
}

.news-meta {
  font-size: 22rpx;
  color: $color-text-secondary;
  margin-top: 8rpx;
}

/* 源筛选条 */
.news-source-strip {
  white-space: nowrap;
  display: flex;
  gap: 12rpx;
  padding: 8rpx 0 20rpx;
}

.news-source-chip {
  display: inline-block;
  padding: 8rpx 18rpx;
  font-size: 22rpx;
  color: $color-text-secondary;
  background: rgba(255, 184, 107, 0.05);
  border: 1rpx solid rgba(255, 184, 107, 0.18);
  border-radius: $radius-full;
  flex-shrink: 0;

  &.active {
    color: $color-bg;
    background: $rf-cyan;
    border-color: $rf-cyan;
    font-weight: 600;
  }
}

.news-empty {
  padding: 200rpx 0;
  text-align: center;
  color: $color-text-secondary;
  font-size: 28rpx;
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
  line-height: 1.65;
  color: $color-text-warm;
  white-space: pre-wrap;
}

.news-item-link {
  display: inline-block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: $rf-cyan;
}
</style>