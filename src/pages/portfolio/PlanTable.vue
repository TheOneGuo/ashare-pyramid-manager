<template>
  <view class="pf-plan-table">
    <!-- 加仓表 -->
    <view class="pf-plan-grid">
      <text class="pf-plan-cell pf-plan-cell--th">档</text>
      <text class="pf-plan-cell pf-plan-cell--th">触发挂单价</text>
      <text class="pf-plan-cell pf-plan-cell--th">股数</text>
      <text class="pf-plan-cell pf-plan-cell--th">投入金额</text>
      <text class="pf-plan-cell pf-plan-cell--th">全仓止损价</text>
      <text class="pf-plan-cell pf-plan-cell--th">占比</text>
      <template v-for="(r, i) in plan.rows" :key="i">
        <text class="pf-plan-cell">{{ tierLabel(r.tier) }}</text>
        <text class="pf-plan-cell">{{ fmtMoney(r.price, 2) }}</text>
        <text class="pf-plan-cell">{{ r.shares }}</text>
        <text class="pf-plan-cell">{{ fmtMoney(r.amount || 0) }}</text>
        <text class="pf-plan-cell">{{ fmtMoney(r.stop, 2) }}</text>
        <text class="pf-plan-cell">{{ fmtPct(r.pct) }}</text>
      </template>
    </view>

    <!-- 分批止盈与动态止损表 -->
    <text v-if="plan.tp_rows && plan.tp_rows.length" class="pf-tp-title">分批止盈与动态止损</text>
    <view v-if="plan.tp_rows && plan.tp_rows.length" class="pf-tp-grid">
      <text class="pf-tp-cell pf-tp-cell--th">档</text>
      <text class="pf-tp-cell pf-tp-cell--th">触发价</text>
      <text class="pf-tp-cell pf-tp-cell--th">减仓股数</text>
      <text class="pf-tp-cell pf-tp-cell--th">剩余股数</text>
      <text class="pf-tp-cell pf-tp-cell--th">动态止损价</text>
      <template v-for="(t, i) in plan.tp_rows" :key="i">
        <text class="pf-tp-cell">{{ tierLabel(t.tier) }}</text>
        <text class="pf-tp-cell">{{ fmtMoney(t.price, 2) }}</text>
        <text class="pf-tp-cell">{{ t.cut_shares }}</text>
        <text class="pf-tp-cell">{{ t.remain_shares }}</text>
        <text class="pf-tp-cell">{{ t.dynamic_stop != null ? fmtMoney(t.dynamic_stop, 2) : '全平' }}</text>
      </template>
    </view>

    <!-- 底部汇总 -->
    <view v-if="plan.total_invest != null" class="pf-tp-summary">
      <text>总投入 {{ fmtMoney(plan.total_invest) }}</text>
      <text v-if="plan.remain != null">剩余 {{ fmtMoney(plan.remain) }}（{{ fmtPct(plan.remain_pct) }}）</text>
    </view>
    <view v-if="plan.ratio_note" class="pf-tp-summary"><text>{{ plan.ratio_note }}</text></view>
  </view>
</template>

<script setup lang="ts">
import type { PlanResult } from '@/api/portfolio'
import { fmtMoney, fmtPct, tierLabel } from '@/utils/portfolioFormat'

defineProps<{ plan: PlanResult }>()
</script>
