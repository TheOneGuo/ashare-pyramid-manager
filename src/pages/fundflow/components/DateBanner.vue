<template>
  <view class="banner">
    <text class="banner__date">近 1 日 增仓比例（更新时间：{{ asOf || '—' }}）</text>
    <text class="banner__mock">数据为示意 · v1 mock</text>
  </view>
</template>

<script setup lang="ts">
defineProps<{ asOf: string }>()
</script>

<style lang="scss" scoped>
.banner {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
  padding: 8rpx 4rpx 12rpx;
  flex-wrap: wrap;
}
.banner__date {
  font-size: 24rpx;
  color: $app-text-muted;
  letter-spacing: 1rpx;
}
// 常驻「数据为示意」灰字（v1 mock 标注，非关闭动效）
.banner__mock {
  font-size: 20rpx;
  color: rgba(138, 138, 142, 0.7);
  letter-spacing: 1rpx;
}
</style>
