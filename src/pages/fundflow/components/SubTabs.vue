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
</script>

<style lang="scss" scoped>
/* 与 market 页 mk-source-chip 同款胶囊切换（金色系，无新色） */
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$radius-full: 999rpx;

.subtabs {
  display: flex;
  align-items: stretch;
  gap: 12rpx;
  padding: 6rpx 2rpx 12rpx;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.subtabs::-webkit-scrollbar { display: none; }
.subtabs__item {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  padding: 12rpx 8rpx;
  border-radius: $radius-full;
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  color: $color-text-secondary;
  font-size: 24rpx;
  font-weight: 600;
  transition: all 0.18s ease;
  box-sizing: border-box;
}
.subtabs__item.is-active {
  background: linear-gradient(135deg, #ffb86b 0%, #ff7a3d 100%);
  color: #0b0b0d;
  border-color: transparent;
}
.subtabs__emoji { font-size: 26rpx; line-height: 1; }
.subtabs__label { font-size: 24rpx; white-space: nowrap; }
</style>
