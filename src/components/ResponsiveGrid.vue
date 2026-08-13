<!--
  ResponsiveGrid — 自适应栅格容器
  - 直板机（< 600rpx）: 1 列
  - 折叠屏 / 平板 (>= 600rpx): 2 列
  - 桌面 / 横屏 (>= 900rpx): 3 列

  使用：
    <ResponsiveGrid :columns="{ base: 1, md: 2, lg: 3 }" :gap="16">
      <view v-for="item in items" :key="item.id">...</view>
    </ResponsiveGrid>
-->
<template>
  <view class="rg" :class="rootClass" :style="rootStyle">
    <slot />
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBreakpoint } from '@/utils/useBreakpoint'

interface Props {
  /** 各断点列数。base / sm / md / lg / xl。 */
  columns?: { base?: number; sm?: number; md?: number; lg?: number; xl?: number }
  /** 子项间距（rpx） */
  gap?: number
}

const props = withDefaults(defineProps<Props>(), {
  columns: () => ({ base: 1, md: 2, lg: 3 }),
  gap: 16,
})

const { current } = useBreakpoint()

const activeColumns = computed(() => {
  const cols = props.columns
  const order = ['xl', 'lg', 'md', 'sm', 'base'] as const
  for (const key of order) {
    const v = cols[key]
    if (v && current.value === key) return v
  }
  return cols.base ?? 1
})

const rootClass = computed(() => `rg--cols-${activeColumns.value}`)
const rootStyle = computed(() => ({
  gap: `${props.gap}rpx`,
}))
</script>

<style lang="scss" scoped>
.rg {
  display: grid;
  grid-template-columns: 1fr;
}

.rg--cols-1 { grid-template-columns: 1fr; }
.rg--cols-2 { grid-template-columns: repeat(2, 1fr); }
.rg--cols-3 { grid-template-columns: repeat(3, 1fr); }
.rg--cols-4 { grid-template-columns: repeat(4, 1fr); }
.rg--cols-5 { grid-template-columns: repeat(5, 1fr); }
</style>
