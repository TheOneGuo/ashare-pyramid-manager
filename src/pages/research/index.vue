<template>
  <view class="research-page">
    <view class="research-header">
      <text class="research-title">AI 研报解读</text>
      <text class="research-meta">每日定时抓取 · LLM 提炼</text>
    </view>

    <view v-if="loading" class="research-empty">
      <text>加载中…</text>
    </view>

    <view v-else-if="reports.length === 0" class="research-empty">
      <text>暂无研报</text>
    </view>

    <view v-else class="research-list">
      <view
        v-for="r in reports"
        :key="r.id"
        class="research-card"
      >
        <view class="research-card-head">
          <text class="research-card-title">{{ r.title }}</text>
          <text class="research-card-meta">{{ r.broker }} · {{ formatDate(r.date) }}</text>
        </view>

        <view v-if="r.highlight" class="research-section">
          <text class="research-section-label">📌 当日重点</text>
          <text class="research-section-body">{{ r.highlight }}</text>
        </view>

        <view v-if="r.risks && r.risks.length" class="research-section">
          <text class="research-section-label">⚠️ 风险点</text>
          <text
            v-for="(rk, i) in r.risks"
            :key="i"
            class="research-section-body research-bullet"
          >· {{ rk }}</text>
        </view>

        <view v-if="r.targetPrice" class="research-section">
          <text class="research-section-label">🎯 目标价</text>
          <text class="research-section-body">{{ r.targetPrice }}</text>
        </view>
      </view>
    </view>

    <view class="research-disclaimer">
      <text>AI 生成内容不构成投资建议</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface ResearchReport {
  id: string
  title: string
  broker: string
  date: number
  highlight?: string
  risks?: string[]
  targetPrice?: string
}

const reports = ref<ResearchReport[]>([])
const loading = ref(false)

async function fetchReports() {
  loading.value = true
  try {
    // TODO: 接后端 /api/research；先 mock
    await new Promise((r) => setTimeout(r, 200))
    reports.value = [
      {
        id: 'mock-1',
        title: '【骨架验证】研报解读卡片已通',
        broker: '示例券商',
        date: Date.now(),
        highlight: '后端 /api/research 接入见 docs/architecture.md',
        risks: ['本条为占位数据，不代表任何真实研报'],
        targetPrice: '—',
      },
    ]
  } finally {
    loading.value = false
  }
}

function formatDate(ts: number) {
  const d = new Date(ts)
  return d.toLocaleDateString('zh-CN')
}

onMounted(fetchReports)
</script>

<style lang="scss" scoped>
.research-page {
  min-height: 100vh;
  background: $app-bg;
  padding: $spacing-base;
}

.research-header {
  padding: $spacing-base 0;
  margin-bottom: $spacing-base;
}

.research-title {
  display: block;
  font-size: 44rpx;
  font-weight: 600;
  color: $app-text;
}

.research-meta {
  display: block;
  font-size: 24rpx;
  color: $app-text-muted;
  margin-top: 8rpx;
}

.research-empty {
  padding: 200rpx 0;
  text-align: center;
  color: $app-text-muted;
  font-size: 28rpx;
}

.research-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-base;
}

.research-card {
  background: $app-card-bg;
  border-radius: $radius-lg;
  padding: $spacing-base;
  border: 1rpx solid $app-border;
}

.research-card-head {
  padding-bottom: $spacing-base;
  border-bottom: 1rpx solid $app-border;
  margin-bottom: $spacing-base;
}

.research-card-title {
  display: block;
  font-size: 32rpx;
  line-height: 1.4;
  color: $app-text;
  font-weight: 600;
}

.research-card-meta {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $app-text-muted;
}

.research-section {
  margin-top: $spacing-base;
}

.research-section-label {
  display: block;
  font-size: 26rpx;
  color: $app-accent;
  margin-bottom: 8rpx;
  font-weight: 500;
}

.research-section-body {
  display: block;
  font-size: 28rpx;
  line-height: 1.6;
  color: $app-text;
}

.research-bullet {
  display: block;
  margin-top: 4rpx;
}

.research-disclaimer {
  margin-top: $spacing-lg;
  padding: $spacing-base;
  text-align: center;
  font-size: 22rpx;
  color: $app-text-muted;
  border-top: 1rpx solid $app-border;
}
</style>
