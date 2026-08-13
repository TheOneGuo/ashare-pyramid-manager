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
    // TODO: 接后端 /api/news，这里先 mock 数据验证骨架
    await new Promise((r) => setTimeout(r, 200))
    items.value = [
      {
        id: String(Date.now()),
        title: '【骨架验证】新闻快讯列表已通',
        summary: '后端接入见 docs/architecture.md；本条为占位。',
        source: '财联社',
        time: Date.now(),
      },
    ]
    lastUpdated.value = new Date().toLocaleTimeString('zh-CN')
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
