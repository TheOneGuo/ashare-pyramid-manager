<template>
  <view class="banner">
    <text class="banner__date">{{ metric ? metric.label : '' }} · 更新 {{ asOf || '—' }}</text>
    <text v-if="metric && metric.notice" class="banner__notice">{{ metric.notice }}</text>
  </view>
</template>

<script setup lang="ts">
import type { MetricInfo } from '@/api/fundflow'

defineProps<{ metric?: MetricInfo; asOf: string }>()
</script>

<style lang="scss" scoped>
$color-text-secondary: #a89a82;
$color-text-warm: #d3c3ad;

.banner {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding: 4rpx 4rpx 12rpx;
}
.banner__date {
  font-size: 24rpx;
  color: $color-text-warm;
  letter-spacing: 1rpx;
}
.banner__notice {
  font-size: 20rpx;
  color: $color-text-secondary;
  line-height: 1.5;
}
</style>
