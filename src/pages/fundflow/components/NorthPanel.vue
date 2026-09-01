<template>
  <view class="north">
    <view class="north__head">
      <text class="north__title">北向成交热度 · 近 {{ series.length }} 日</text>
      <text v-if="north.latest" class="north__latest">
        最新 {{ north.latest.date }}：{{ north.latest.dealAmtYi.toFixed(2) }}亿<template v-if="north.latest.dealNum > 0"> · {{ fmtWan(north.latest.dealNum) }}笔</template>
      </text>
    </view>
    <view v-if="series.length" class="north__bars">
      <view v-for="d in series" :key="d.date" class="north__bar-row">
        <text class="north__date">{{ d.date.slice(5) }}</text>
        <view class="north__track"><view class="north__fill" :style="{ width: barW(d.dealAmtYi) + '%' }" /></view>
        <text class="north__amt">{{ d.dealAmtYi.toFixed(0) }}亿</text>
      </view>
    </view>
    <view v-else class="north__empty"><text>北向日度数据暂不可用</text></view>
    <view v-if="notice" class="north__notice"><text>{{ notice }}</text></view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { NorthData } from '@/api/fundflow'

const props = defineProps<{ north: NorthData; notice?: string }>()

const series = computed(() => props.north.series.slice(0, 10))
const maxAmt = computed(() => Math.max(1, ...series.value.map((d) => d.dealAmtYi)))
function barW(v: number): number {
  return Math.max(4, Math.round((v / maxAmt.value) * 100))
}
function fmtWan(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(0)}万` : String(n)
}
</script>

<style lang="scss" scoped>
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$rf-amber: #ffb86b;
$radius-lg: 20rpx;

.north {
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  border-radius: $radius-lg;
  padding: 20rpx 24rpx;
}
.north__head { display: flex; flex-direction: column; gap: 6rpx; margin-bottom: 14rpx; }
.north__title { font-size: 30rpx; font-weight: 600; color: $rf-amber; }
.north__latest { font-size: 22rpx; color: $color-text-secondary; }
.north__bars { display: flex; flex-direction: column; gap: 8rpx; }
.north__bar-row { display: flex; align-items: center; gap: 10rpx; }
.north__date { flex: 0 0 56rpx; font-size: 22rpx; color: $color-text-secondary; }
.north__track { flex: 1; height: 14rpx; border-radius: 7rpx; background: rgba(255, 184, 107, 0.1); overflow: hidden; }
.north__fill {
  height: 100%;
  border-radius: 7rpx;
  background: linear-gradient(90deg, #fff4c0, #f4c542);
}
.north__amt { flex: 0 0 72rpx; text-align: right; font-size: 22rpx; font-weight: 600; color: $color-text-primary; }
.north__empty { text-align: center; color: $color-text-secondary; font-size: 24rpx; padding: 20rpx 0; }
.north__notice { margin-top: 12rpx; }
.north__notice text { display: block; font-size: 20rpx; color: $color-text-secondary; line-height: 1.5; }
</style>
