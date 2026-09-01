<template>
  <view class="board" :class="`board--${node.colorKey}`">
    <view class="board__head">
      <view class="board__title-wrap">
        <text class="board__emoji">{{ node.emoji }}</text>
        <text class="board__title">{{ node.name }}</text>
        <text v-if="metric" class="board__chip">{{ metric.label }}</text>
      </view>
      <text class="board__total" :class="totalClass">{{ fmtFlow(node.totalPct) }}</text>
    </view>

    <!-- 海外资金：北向日度成交热度榜（行业级持仓已停披，如实展示交易所仍公开数据） -->
    <template v-if="node.type === 'foreign'">
      <view v-if="north && north.series.length" class="board__rows">
        <view v-for="(d, i) in shownNorth" :key="d.date" class="board__row">
          <text class="board__rank" :class="{ 'board__rank--top': i < 3 }">{{ i + 1 }}</text>
          <view class="board__cell">
            <view class="board__cell-top">
              <text class="board__name">{{ d.date }}</text>
              <text class="board__pct">{{ d.dealAmtYi.toFixed(2) }}亿</text>
            </view>
            <view class="board__cell-sub">
              <text class="board__sub"><template v-if="d.dealNum > 0">成交 {{ fmtWan(d.dealNum) }} 笔</template><template v-if="d.lead"> · 领涨 {{ d.lead }}<template v-if="d.leadZdf !== 0"> {{ fmtPct(d.leadZdf) }}</template></template></text>
            </view>
          </view>
        </view>
      </view>
      <view v-else class="board__empty"><text>北向日度数据暂不可用</text></view>
    </template>

    <!-- 其他三类：板块增仓榜（top3 → 更多 → top10）+ 领涨股 -->
    <template v-else>
      <view class="board__rows">
        <view v-for="s in shownSectors" :key="s.code" class="board__row">
          <text class="board__rank" :class="{ 'board__rank--top': s.rank <= 3 }">{{ s.rank }}</text>
          <view class="board__cell">
            <view class="board__cell-top">
              <text class="board__name">{{ s.name }}</text>
              <text class="board__pct" :class="s.pct >= 0 ? 'is-up' : 'is-down'">{{ fmtFlow(s.pct) }}</text>
            </view>
            <view class="board__cell-sub">
              <text class="board__sub">5日 {{ fmtFlow(s.pct5d) }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="stocks.length" class="board__stock">
        <text class="board__stock-label">股票中意 · 净流入前列行业领涨股</text>
        <view v-for="s in stocks.slice(0, 3)" :key="s.code" class="board__stock-row">
          <text class="board__stock-name">{{ s.name }}</text>
          <text class="board__stock-sector">{{ s.sector }}</text>
          <text class="board__stock-pct" :class="s.pct >= 0 ? 'is-up' : 'is-down'">{{ fmtPct(s.pct) }}</text>
        </view>
      </view>
    </template>

    <view v-if="canToggle" class="board__more" hover-class="board__more--hover" @tap="expanded = !expanded">
      <text>{{ expanded ? '收起 ▴' : '更多 ▾' }}</text>
    </view>

    <view v-if="metric && metric.notice" class="board__notice"><text>{{ metric.notice }}</text></view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FundNode, MetricInfo, NorthData, SectorNode, StockItem } from '@/api/fundflow'

const props = defineProps<{
  node: FundNode
  metric?: MetricInfo
  sectors?: SectorNode[]
  stocks?: StockItem[]
  north?: NorthData
}>()

const expanded = ref(false)
const sectors = computed(() => props.sectors || [])
const stocks = computed(() => props.stocks || [])
const shownSectors = computed(() => (expanded.value ? sectors.value : sectors.value.slice(0, 3)))
const northSeries = computed(() => props.north?.series || [])
const shownNorth = computed(() => (expanded.value ? northSeries.value.slice(0, 10) : northSeries.value.slice(0, 3)))
const canToggle = computed(() =>
  props.node.type === 'foreign' ? northSeries.value.length > 3 : sectors.value.length > 3,
)

// 外资卡合计 = 北向成交额（非涨跌，中性色）
const totalClass = computed(() => (props.node.type === 'foreign' ? '' : props.node.totalPct >= 0 ? 'is-up' : 'is-down'))

// A 股：红涨绿跌（#e2553b / #26a86b，与其他 tab 一致）
function fmtFlow(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}亿`
}
function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
function fmtWan(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(0)}万` : String(n)
}
</script>

<style lang="scss" scoped>
/* 与 market/portfolio 一致的金色系（不得引入新色） */
$color-bg: #0b0b0d;
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$color-text-warm: #d3c3ad;
$rf-amber: #ffb86b;
$rf-red: #e2553b;
$rf-green: #26a86b;
$radius-lg: 20rpx;
$radius-md: 14rpx;

.board {
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  border-radius: $radius-lg;
  padding: 20rpx 24rpx;
  margin-bottom: 20rpx;
}
.board__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 12rpx;
}
.board__title-wrap { display: flex; align-items: baseline; gap: 10rpx; flex-wrap: wrap; }
.board__emoji { font-size: 28rpx; }
.board__title { font-size: 30rpx; font-weight: 600; color: $color-text-primary; }
.board__chip {
  font-size: 20rpx;
  color: $color-text-warm;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  border: 1rpx solid $color-border;
  background: rgba(255, 184, 107, 0.05);
}
.board__total { font-size: 28rpx; font-weight: 700; color: $color-text-warm; }
.board__rows { display: flex; flex-direction: column; }
.board__row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 10rpx 4rpx;
  border-top: 1rpx dashed rgba(255, 184, 107, 0.16);
}
.board__row:first-child { border-top: none; }
.board__rank {
  flex: 0 0 auto;
  width: 36rpx;
  height: 36rpx;
  line-height: 36rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 22rpx;
  color: $color-text-secondary;
  background: rgba(255, 184, 107, 0.08);
}
.board__rank--top {
  color: #1a1206;
  background: linear-gradient(135deg, #fff4c0, #d89c1c);
  font-weight: 700;
}
.board__cell { flex: 1; min-width: 0; }
.board__cell-top { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.board__name {
  font-size: 28rpx;
  color: $color-text-primary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.board__pct { font-size: 26rpx; font-weight: 700; }
.board__cell-sub { margin-top: 2rpx; }
.board__sub { font-size: 22rpx; color: $color-text-secondary; }

.board__stock { margin-top: 10rpx; padding-top: 10rpx; border-top: 1rpx solid rgba(255, 184, 107, 0.16); }
.board__stock-label { display: block; font-size: 22rpx; color: $rf-amber; font-weight: 600; margin-bottom: 4rpx; }
.board__stock-row { display: flex; align-items: center; gap: 12rpx; padding: 6rpx 4rpx; }
.board__stock-name { font-size: 26rpx; color: $color-text-primary; font-weight: 600; }
.board__stock-sector { font-size: 22rpx; color: $color-text-secondary; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board__stock-pct { font-size: 24rpx; font-weight: 700; }

.board__more {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12rpx 20rpx;
  font-size: 24rpx;
  border-radius: $radius-md;
  background: rgba(255, 184, 107, 0.05);
  border: 1rpx solid rgba(255, 184, 107, 0.3);
  color: $color-text-primary;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.board__more--hover { opacity: 0.85; transform: scale(0.98); }

.board__notice { margin-top: 10rpx; }
.board__notice text { font-size: 20rpx; color: $color-text-secondary; line-height: 1.5; display: block; }
.board__empty { text-align: center; color: $color-text-secondary; font-size: 24rpx; padding: 20rpx 0; }

.is-up { color: $rf-red; }
.is-down { color: $rf-green; }
</style>
