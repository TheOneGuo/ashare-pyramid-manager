<template>
  <view class="ff-page" :class="{ 'h5-mode': isH5 }">
    <TabBarComp v-if="isH5" />

    <view class="ff-body">
      <!-- 数据就绪才渲染主体：避免 data 为 null 时模板读取 data.sankey / data.funds 抛 TypeError -->
      <view v-if="data" class="ff-layout">
        <!-- 左栏：标题 + 日期 + 资金子 tab + 桑基图 + CTA -->
        <view class="col-left">
          <view class="ff-sticky">
            <HeroCard />
            <DateBanner :asOf="data?.asOf || ''" />
            <SubTabs :activeType="activeType" @change="onTabChange" />
          </view>
          <SankeyChart :sankey="data.sankey" :activeType="activeType" />
          <SankeyCTA />
        </view>

        <!-- 右栏：板块增仓榜 + 股票中意榜 -->
        <view class="col-right">
          <RankBoard kind="sector" title="板块增仓榜" :data="data" :activeType="activeType" />
          <RankBoard kind="stock" title="股票中意榜" :data="data" :activeType="activeType" />
        </view>
      </view>

      <!-- 加载态 / 错误态（data 未就绪时显示） -->
      <view v-else class="ff-state" :class="{ 'ff-state--error': error }" @tap="retry">
        <text>{{ error ? '加载失败 · 点击重试' : '加载资金流向…' }}</text>
        <text v-if="error" class="ff-state-hint">{{ error }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import TabBarComp from '@/custom-tab-bar/index.vue'
import { fetchFundFlow, type FundFlowResp, type FundType } from '@/api/fundflow'
import HeroCard from './components/HeroCard.vue'
import DateBanner from './components/DateBanner.vue'
import SubTabs from './components/SubTabs.vue'
import SankeyChart from './components/SankeyChart.vue'
import SankeyCTA from './components/SankeyCTA.vue'
import RankBoard from './components/RankBoard.vue'

const isH5 = ref(typeof window !== 'undefined')

// ============= useFundFlow 状态机（页内 composable，不引 pinia） =============
const data = ref<FundFlowResp | null>(null)
const loading = ref(false)
const error = ref('')
const activeType = ref<FundType>('joint')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await fetchFundFlow()
    if (!r?.ok) throw new Error(r?.error || '加载失败')
    data.value = r
    // 刷新后若 URL 带 type 查询，应用选中
    const q = getQueryType()
    if (q && r.funds.some((f) => f.type === q)) activeType.value = q
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}
function retry() {
  load()
}

// 切子 tab：零请求（纯前端高亮），并同步 URL query（H5）
function onTabChange(t: FundType) {
  activeType.value = t
  syncQuery(t)
}

// H5：从 URL query 读取 type（刷新后保持选中）
function getQueryType(): FundType | null {
  // #ifdef H5
  if (typeof window !== 'undefined') {
    const p = new URLSearchParams(window.location.search)
    const t = p.get('type')
    if (t) return t as FundType
  }
  // #endif
  return null
}
function syncQuery(type: FundType) {
  // #ifdef H5
  if (typeof window !== 'undefined' && typeof history !== 'undefined') {
    const url = new URL(window.location.href)
    url.searchParams.set('type', type)
    history.replaceState(null, '', url.toString())
  }
  // #endif
}

onMounted(() => {
  load()
})
onShow(() => {
  if (!data.value && !loading.value) load()
})
onPullDownRefresh(() => {
  load().finally(() => uni.stopPullDownRefresh())
})
</script>

<style lang="scss" scoped>
.ff-page {
  min-height: 100vh;
  background: $app-bg;
  padding-bottom: calc(160rpx + env(safe-area-inset-bottom, 0px));
}
.ff-page.h5-mode {
  position: fixed;
  left: 0; right: 0; top: 0;
  bottom: calc(110rpx + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ff-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 $spacing-base calc(140rpx + env(safe-area-inset-bottom, 0px));
}
.ff-layout {
  display: flex;
  flex-direction: column;
  gap: $spacing-base;
  padding-top: $spacing-base;
}
.col-left { display: flex; flex-direction: column; gap: $spacing-base; }
.col-right { display: flex; flex-direction: column; gap: $spacing-base; }

.ff-state {
  padding: 120rpx 20rpx;
  text-align: center;
  color: $app-text-muted;
  font-size: 26rpx;
  line-height: 1.7;
}
.ff-state--error { color: $app-error; }
.ff-state-hint { display: block; margin-top: 8rpx; font-size: 22rpx; color: $app-text-muted; }

// ─────────────────────────────────────────────
// 折叠屏 / 平板双栏（H5，宽 700~1400px）：左栏 58% + 右栏 42%
// 直板机（< 700px）不命中，UI 不变。
// ─────────────────────────────────────────────
@include fold-wide {
  .ff-page.h5-mode { flex-direction: row; }
  .ff-body {
    flex: 1;
    min-width: 0;
    padding: 12px 14px;
    overflow: hidden;
    display: flex;
  }
  .ff-layout {
    flex: 1;
    min-height: 0;
    flex-direction: row;
    align-items: stretch;
    gap: 16px;
    padding-top: 0;
  }
  .col-left { flex: 0 0 58%; max-width: 58%; overflow-y: auto; min-height: 0; }
  .col-right { flex: 1 1 42%; max-width: 42%; overflow-y: auto; min-height: 0; }
  // 左栏头（标题/日期/子 tab）在折叠屏下吸顶
  .ff-sticky { position: sticky; top: 0; background: $app-bg; z-index: 5; padding-bottom: 8rpx; }
}
</style>
