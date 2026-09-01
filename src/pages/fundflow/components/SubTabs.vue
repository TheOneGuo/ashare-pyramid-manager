<template>
  <view class="subtabs">
    <view
      v-for="t in tabs"
      :key="t.type"
      class="subtabs__item"
      :class="{ 'is-active': activeType === t.type }"
      @tap="onTap(t.type)"
    >
      <text class="subtabs__emoji">{{ t.emoji }}</text>
      <text class="subtabs__label">{{ t.name }}</text>
      <view class="subtabs__underline" />
    </view>
    <view class="subtabs__item subtabs__item--more" @tap="onMore">
      <text class="subtabs__label">更多</text>
      <text class="subtabs__caret">▾</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import type { FundType } from '@/api/fundflow'

const props = defineProps<{ activeType: FundType }>()
const emit = defineEmits<{ (e: 'change', type: FundType): void }>()

const tabs: { type: FundType; name: string; emoji: string }[] = [
  { type: 'joint', name: '共同增仓', emoji: '🔀' },
  { type: 'public_fund', name: '公募基金', emoji: '💧' },
  { type: 'stabilization', name: '超级平准', emoji: '🌊' },
  { type: 'foreign', name: '超级外资', emoji: '🔥' },
]

function onTap(type: FundType) {
  if (type === props.activeType) return
  emit('change', type)
}
function onMore() {
  uni.showToast({ title: '更多资金类型开发中', icon: 'none' })
}
</script>

<style lang="scss" scoped>
.subtabs {
  display: flex;
  align-items: stretch;
  gap: 8rpx;
  padding: 6rpx 2rpx 10rpx;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.subtabs::-webkit-scrollbar { display: none; }
.subtabs__item {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  padding: 16rpx 8rpx;
  border-radius: $radius-base;
  background: $app-card-bg;
  border: 1rpx solid $app-border;
  color: $app-text-muted;
  transition: color 0.2s, background 0.2s, border-color 0.2s;
  box-sizing: border-box;
}
.subtabs__item.is-active {
  color: $app-text;
  border-color: rgba(212, 175, 55, 0.55);
  background: linear-gradient(180deg, rgba(212, 175, 55, 0.16), rgba(212, 175, 55, 0.05));
}
.subtabs__emoji { font-size: 26rpx; line-height: 1; }
.subtabs__label { font-size: 24rpx; font-weight: 500; white-space: nowrap; }
.subtabs__item--more { flex: 0 0 auto; padding: 16rpx 18rpx; }
.subtabs__caret { font-size: 20rpx; color: $app-text-muted; }
// 金色下划线指示（动效 <300ms）
.subtabs__underline {
  position: absolute;
  left: 50%;
  bottom: 4rpx;
  width: 40rpx;
  height: 4rpx;
  border-radius: 4rpx;
  background: linear-gradient(90deg, #fff4c0, #d89c1c);
  opacity: 0;
  transform: translateX(-50%) scaleX(0.3);
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.subtabs__item.is-active .subtabs__underline {
  opacity: 1;
  transform: translateX(-50%) scaleX(1);
}
</style>
