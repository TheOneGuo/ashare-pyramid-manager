<template>
  <view class="board">
    <view class="board__head">
      <text class="board__title">{{ title }}</text>
      <text class="board__mock">示意数据</text>
    </view>

    <view
      v-for="f in funds"
      :key="f.type"
      class="board__group"
      :class="{ 'is-active': activeType === f.type }"
    >
      <view class="board__group-head">
        <text class="board__group-emoji">{{ f.emoji }}</text>
        <text class="board__group-name">{{ f.name }}</text>
        <text class="board__group-total" :class="pctClass(f.totalPct)">{{ pctText(f.totalPct) }}</text>
      </view>

      <view
        v-for="(it, i) in rows(f.type)"
        :key="it.code + '-' + i"
        class="board__row"
      >
        <text class="board__rank" :class="{ 'board__rank--top': it.rank <= 3 }">{{ it.rank }}</text>
        <view class="board__cell">
          <view class="board__cell-top">
            <text class="board__name">{{ it.name }}</text>
            <text class="board__pct" :class="pctClass(it.pct)">{{ pctText(it.pct) }}</text>
          </view>
          <view class="board__cell-sub">
            <text class="board__sub">{{ kind === 'sector' ? '近5日 ' + pctText((it as SectorNode).pct5d) : (it as StockItem).sector }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { FundFlowResp, FundType, SectorNode, StockItem } from '@/api/fundflow'

const props = defineProps<{
  kind: 'sector' | 'stock'
  title: string
  data: FundFlowResp
  activeType: FundType
}>()

// 4 类资金顺序与元数据（与后端 FUND_META 对应）
const funds = computed(() => props.data.funds)

function rows(type: FundType): (SectorNode | StockItem)[] {
  const key = props.kind === 'sector' ? 'sectors' : 'stocks'
  return props.data[key][type] || []
}

// A 股：红涨绿跌。pct >= 0 → 红（$app-up），< 0 → 绿（$app-down）
function pctClass(v: number): string {
  return v >= 0 ? 'is-up' : 'is-down'
}
function pctText(v: number): string {
  const s = (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
  return s
}
</script>

<style lang="scss" scoped>
.board {
  background: $app-card-bg;
  border: 1rpx solid $app-border;
  border-radius: $radius-lg;
  padding: $spacing-base;
  margin-bottom: $spacing-base;
}
.board__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.board__title {
  font-size: 30rpx;
  font-weight: 600;
  color: $app-text;
}
.board__mock {
  font-size: 20rpx;
  color: rgba(138, 138, 142, 0.7);
}
.board__group {
  padding: 14rpx 0;
  border-top: 1rpx dashed rgba(255, 255, 255, 0.06);
  opacity: 0.62;
  transition: opacity 0.22s ease;
}
.board__group:first-of-type { border-top: none; }
.board__group.is-active {
  opacity: 1;
}
.board__group-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 8rpx;
}
.board__group-emoji { font-size: 26rpx; }
.board__group-name { font-size: 26rpx; font-weight: 600; color: $app-text; }
.board__group-total { font-size: 24rpx; font-weight: 600; margin-left: auto; }
.board__row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 10rpx 4rpx;
}
.board__rank {
  flex: 0 0 auto;
  width: 36rpx;
  height: 36rpx;
  line-height: 36rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 22rpx;
  color: $app-text-muted;
  background: rgba(255, 255, 255, 0.04);
}
.board__rank--top {
  color: #0b0b0d;
  background: linear-gradient(135deg, #fff4c0, #d89c1c);
  font-weight: 700;
}
.board__cell { flex: 1; min-width: 0; }
.board__cell-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}
.board__name {
  font-size: 28rpx;
  color: $app-text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.board__pct { font-size: 28rpx; font-weight: 700; }
.board__cell-sub { margin-top: 2rpx; }
.board__sub { font-size: 22rpx; color: $app-text-muted; }
// 红涨绿跌
.is-up { color: $app-up; }
.is-down { color: $app-down; }
</style>
