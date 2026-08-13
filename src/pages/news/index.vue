<template>
  <view class="news-page">
    <view class="news-header">
      <text class="news-title">财经快讯</text>
      <text class="news-meta">{{ lastUpdated }} · 30s 自动刷新</text>
    </view>

    <view v-if="loading && items.length === 0" class="news-empty">
      <text>加载中…</text>
    </view>

    <view v-else-if="items.length === 0" class="news-empty">
      <text>暂无快讯</text>
    </view>

    <view v-else class="news-list">
      <view
        v-for="item in items"
        :key="item.id"
        class="news-card"
        @tap="onTapItem(item)"
      >
        <view class="news-card-head">
          <text class="news-card-time">{{ formatTime(item.time) }}</text>
          <text class="news-card-source">{{ item.source }}</text>
        </view>
        <text class="news-card-title">{{ item.title }}</text>
        <text v-if="item.summary" class="news-card-summary">{{ item.summary }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { env } from '@/utils/env'

const API_BASE = env.API_BASE_URL || 'http://localhost:9999'

interface NewsItem {
  id: string
  title: string
  summary?: string
  source: string
  time: number
  url?: string
}

const items = ref<NewsItem[]>([])
const loading = ref(false)
const lastUpdated = ref('未刷新')
let pollTimer: ReturnType<typeof setInterval> | null = null

const POLL_INTERVAL_MS = 30 * 1000

async function fetchNews() {
  loading.value = true
  try {
    // 接后端 /api/news（uni.request 跨端统一）
    const res = await uni.request({
      url: API_BASE + '/api/news?limit=30',
      method: 'GET',
      timeout: 8000,
    })
    // #ifdef H5
    const data = res && (res.data || res)
    // #endif
    // #ifndef H5
    const data = res && res.data
    // #endif
    if (data && data.ok && Array.isArray(data.items)) {
      items.value = data.items.map((it: any) => ({
        id: it.id,
        title: it.title,
        summary: it.summary,
        source: it.source,
        url: it.url,
        time: it.published_at,
      }))
      lastUpdated.value = new Date(data.server_time || Date.now()).toLocaleTimeString('zh-CN')
    } else {
      // 兜底：保持前值，显示提示
      if (items.value.length === 0) {
        items.value = [
          {
            id: 'fallback-' + Date.now(),
            title: '暂未拉到数据，请检查后端',
            summary: '后端地址：' + API_BASE,
            source: '系统',
            time: Date.now(),
          },
        ]
      }
    }
  } catch (e: any) {
    console.error('[news] fetch failed', e)
    if (items.value.length === 0) {
      items.value = [
        {
          id: 'err-' + Date.now(),
          title: '后端请求失败: ' + (e?.errMsg || e?.message || 'unknown'),
          summary: '请确认 express 服务在 ' + API_BASE + ' 运行',
          source: '系统',
          time: Date.now(),
        },
      ]
    }
  } finally {
    loading.value = false
  }
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(fetchNews, POLL_INTERVAL_MS)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function onTapItem(item: NewsItem) {
  if (item.url) {
    // #ifdef H5
    window.open(item.url, '_blank')
    // #endif
  }
}

onMounted(() => {
  fetchNews()
  startPolling()
})

onShow(() => {
  // 30 秒 tabbar 切回 / 回到前台时立即拉一次
  fetchNews()
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<style lang="scss" scoped>
.news-page {
  min-height: 100vh;
  background: $app-bg;
  padding: $spacing-base;
}

.news-header {
  display: flex;
  flex-direction: column;
  padding: $spacing-base 0;
  margin-bottom: $spacing-base;
}

.news-title {
  font-size: 44rpx;
  font-weight: 600;
  color: $app-text;
}

.news-meta {
  font-size: 24rpx;
  color: $app-text-muted;
  margin-top: 8rpx;
}

.news-empty {
  padding: 200rpx 0;
  text-align: center;
  color: $app-text-muted;
  font-size: 28rpx;
}

.news-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-base;
}

.news-card {
  background: $app-card-bg;
  border-radius: $radius-lg;
  padding: $spacing-base;
  border: 1rpx solid $app-border;
  transition: transform 0.15s ease;
}

.news-card:active {
  transform: scale(0.98);
}

.news-card-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12rpx;
  font-size: 24rpx;
  color: $app-text-muted;
}

.news-card-title {
  display: block;
  font-size: 32rpx;
  line-height: 1.5;
  color: $app-text;
  font-weight: 500;
}

.news-card-summary {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.5;
  color: $app-text-muted;
}
</style>
