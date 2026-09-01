<template>
  <view class="sankey-cta">
    <text class="sankey-cta__hint">以上板块 / 股票资金面有明显加仓的</text>
    <text class="sankey-cta__link" @tap="onView" hover-class="sankey-cta__link--hover">查看完整名单 ›</text>
  </view>
</template>

<script setup lang="ts">
// 无按钮：纯文案 + 文字链接（tap → toast 占位）
function onView() {
  uni.showToast({ title: '完整名单开发中', icon: 'none' })
}
</script>

<style lang="scss" scoped>
.sankey-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 10rpx 6rpx 16rpx;
}
.sankey-cta__hint {
  font-size: 24rpx;
  color: $app-text-muted;
  letter-spacing: 1rpx;
}
.sankey-cta__link {
  font-size: 24rpx;
  color: $app-accent;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.sankey-cta__link--hover { opacity: 0.7; }
</style>
