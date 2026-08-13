<template>
  <view class="portfolio-page">
    <view class="portfolio-header">
      <text class="portfolio-title">持仓分析</text>
      <text class="portfolio-meta">正金字塔算法 · ATR 自适应</text>
    </view>

    <view class="portfolio-card">
      <text class="portfolio-card-label">📷 持仓截图识别</text>
      <text class="portfolio-card-desc">截图后由 OCR + 大模型提取 股票代码/成本/数量</text>
      <view class="portfolio-card-btn" hover-class="portfolio-card-btn--hover" @tap="onUpload">
        <text>上传截图</text>
      </view>
    </view>

    <view class="portfolio-section">
      <text class="portfolio-section-title">正金字塔档位（占位）</text>
      <text class="portfolio-section-meta">算法在 src/utils/pyramid.js，目前为骨架占位</text>

      <view class="portfolio-pyramid">
        <view
          v-for="(tier, idx) in tiers"
          :key="idx"
          class="portfolio-tier"
          :style="{ width: tier.width }"
        >
          <text class="portfolio-tier-label">T{{ idx + 1 }}</text>
          <text class="portfolio-tier-price">{{ tier.price }}</text>
        </view>
      </view>
    </view>

    <view class="portfolio-disclaimer">
      <text>AI + 算法建议不构成投资建议 · 投资有风险，入市需谨慎</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Tier {
  price: string
  width: string
}

const tiers = ref<Tier[]>([
  { price: '基准 - 3×ATR', width: '30%' },
  { price: 'T1 +10~12%', width: '50%' },
  { price: 'T2 +10~12%', width: '70%' },
  { price: 'T3 止盈 1.58~1.88×', width: '90%' },
])

function onUpload() {
  uni.chooseImage({
    count: 1,
    success: (res) => {
      uni.showToast({ title: '骨架阶段未接 OCR', icon: 'none' })
      console.warn('chosen image', res)
    },
  })
}
</script>

<style lang="scss" scoped>
.portfolio-page {
  min-height: 100vh;
  background: $app-bg;
  padding: $spacing-base;
}

.portfolio-header {
  padding: $spacing-base 0;
  margin-bottom: $spacing-base;
}

.portfolio-title {
  display: block;
  font-size: 44rpx;
  font-weight: 600;
  color: $app-text;
}

.portfolio-meta {
  display: block;
  font-size: 24rpx;
  color: $app-text-muted;
  margin-top: 8rpx;
}

.portfolio-card {
  background: $app-card-bg;
  border-radius: $radius-lg;
  padding: $spacing-base;
  border: 1rpx solid $app-border;
  margin-bottom: $spacing-base;
}

.portfolio-card-label {
  display: block;
  font-size: 30rpx;
  color: $app-text;
  font-weight: 500;
}

.portfolio-card-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: $app-text-muted;
  line-height: 1.5;
}

.portfolio-card-btn {
  display: inline-block;
  margin-top: $spacing-base;
  padding: 16rpx 32rpx;
  background: $app-accent;
  color: $app-text-inverse;
  border-radius: $radius-base;
  font-size: 28rpx;
}

.portfolio-card-btn--hover {
  opacity: 0.85;
}

.portfolio-section {
  background: $app-card-bg;
  border-radius: $radius-lg;
  padding: $spacing-base;
  border: 1rpx solid $app-border;
}

.portfolio-section-title {
  display: block;
  font-size: 30rpx;
  color: $app-text;
  font-weight: 500;
}

.portfolio-section-meta {
  display: block;
  font-size: 22rpx;
  color: $app-text-muted;
  margin-top: 4rpx;
  margin-bottom: $spacing-base;
}

.portfolio-pyramid {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.portfolio-tier {
  height: 72rpx;
  background: linear-gradient(90deg, $app-accent-soft 0%, $app-accent 100%);
  border-radius: $radius-base;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 $spacing-base;
  color: $app-text-inverse;
}

.portfolio-tier-label {
  font-size: 24rpx;
  font-weight: 600;
}

.portfolio-tier-price {
  font-size: 22rpx;
}

.portfolio-disclaimer {
  margin-top: $spacing-lg;
  padding: $spacing-base;
  text-align: center;
  font-size: 22rpx;
  color: $app-text-muted;
  line-height: 1.6;
}
</style>
