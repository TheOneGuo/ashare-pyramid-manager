<template>
  <view class="ff-page" :class="{ 'h5-mode': isH5 }">
    <TabBarComp v-if="isH5" />

    <!-- head 固定区（对齐持仓/行情页）：标题 + 提示 -->
    <view class="ff-head">
      <text class="ff-title">资金流向</text>
      <text class="ff-hint">行业主力净流入 · 北向成交 · 板块增仓榜（真实数据）</text>
    </view>

    <view class="ff-body">
      <!-- 数据就绪才渲染主体：避免 data 为 null 时模板读取 data.sankey 抛 TypeError -->
      <view v-if="data" class="ff-layout">
        <!-- 左栏：口径说明 + 资金子 tab + 桑基图 / 北向面板 -->
        <view class="col-left">
          <view class="ff-sticky">
            <DateBanner :metric="activeMetric" :as-of="data.asOf" />
            <SubTabs :active-type="activeType" @change="onTabChange" />
          </view>
          <!-- 海外资金：北向行业级持仓自 2024-08-16 停披，板块榜为代理口径；
               桑基图照常展示海外资金流向（高亮），下方补充北向日度成交作为口径说明 -->
          <view v-if="activeType === 'foreign'">
            <SankeyChart :sankey="data.sankey" :active-type="activeType" />
            <NorthPanel v-if="data.north" :north="data.north" :notice="activeMetric?.notice" />
            <view v-else class="ff-state"><text>北向日度数据暂不可用</text></view>
          </view>
          <SankeyChart v-else :sankey="data.sankey" :active-type="activeType" />
        </view>

        <!-- 右栏：四类资金分区榜（每类一张卡，top3 → 更多 → top10） -->
        <view class="col-right">
          <RankBoard
            v-for="f in data.funds"
            :key="f.type"
            :node="f"
            :metric="data.metric[f.type]"
            :sectors="data.sectors[f.type]"
            :stocks="data.stocks[f.type]"
            :north="data.north"
          />
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
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TabBarComp from '@/custom-tab-bar/index.vue'
import { fetchFundFlow, type FundFlowResp, type FundType } from '@/api/fundflow'
import DateBanner from './components/DateBanner.vue'
import SubTabs from './components/SubTabs.vue'
import SankeyChart from './components/SankeyChart.vue'
import RankBoard from './components/RankBoard.vue'
import NorthPanel from './components/NorthPanel.vue'

const isH5 = ref(typeof window !== 'undefined')

// ============= useFundFlow 状态机（页内 composable，不引 pinia） =============
const data = ref<FundFlowResp | null>(null)
const loading = ref(false)
const error = ref('')
const activeType = ref<FundType>('joint')

const activeMetric = computed(() => (data.value ? data.value.metric[activeType.value] : undefined))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await fetchFundFlow()
    if (!r?.ok) throw new Error(r?.error || '加载失败')
    data.value = r
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
</script>

<style lang="scss" scoped>
/* 与 market/portfolio 页一致的金色系（不引入新色） */
$color-bg: #0b0b0d;
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$color-text-warm: #d3c3ad;
$rf-amber: #ffb86b;
$radius-lg: 20rpx;

.ff-page {
  min-height: 100vh;
  background: $color-bg;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.032) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.032) 1px, transparent 1px);
  background-size: 48px 48px;
  color: $color-text-primary;
  /* 与财经快讯/AI 研报/持仓分析一致：顶部留白 24rpx（标题垂直位置对齐）
     字体不在此处覆盖，继承 App.vue 全局字体（"Noto Serif SC","Songti SC",SimSun,serif） */
  padding-top: 24rpx;
  padding-bottom: calc(160rpx + env(safe-area-inset-bottom, 0px));
}
.ff-page.h5-mode {
  position: fixed;
  left: 0; right: 0; top: 0;
  bottom: calc(110rpx + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-top: 24rpx;
  padding-bottom: 0;
}
.ff-text-muted { color: $color-text-secondary; }
.font-inherit { font-family: inherit; }
/* head 固定区（对齐财经快讯/持仓分析：靠 flex 布局自然固定在顶部，不用 sticky） */
.ff-head {
  flex: 0 0 auto;
  background: $color-bg;
  padding: 16rpx 24rpx 8rpx;
}
.ff-title {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
  color: $color-text-primary;
  letter-spacing: 1rpx;
}
.ff-hint {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $color-text-secondary;
  letter-spacing: 1rpx;
}

/* body 滚动区（金色滚动条，与其他 tab 一致） */
.ff-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 8rpx 24rpx calc(140rpx + env(safe-area-inset-bottom, 0px));
}
.ff-body::-webkit-scrollbar { width: 5rpx; }
.ff-body::-webkit-scrollbar-track { background: transparent; }
.ff-body::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #fff4c0 0%, #f4c542 50%, #d89c1c 100%);
  border-radius: 6rpx;
}
.ff-body { scrollbar-width: thin; scrollbar-color: #d89c1c transparent; }

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
  color: $color-text-secondary;
  font-size: 26rpx;
  line-height: 1.7;
}
.ff-state--error { color: #e2553b; }
.ff-state-hint { display: block; margin-top: 8rpx; font-size: 22rpx; color: $color-text-secondary; }

// ─────────────────────────────────────────────
// 折叠屏 / 平板双栏（H5，宽 700~1400px）：左栏 58% + 右栏 42%
// 直板机（< 700px）不命中，UI 不变。
// ─────────────────────────────────────────────
@include fold-wide {
  .ff-page.h5-mode { flex-direction: row; }
  .ff-head {
    flex: 0 0 240px;
    width: 240px;
    border-right: 1rpx solid $color-border;
    padding: 16rpx 14rpx 24rpx;
    overflow-y: auto;
  }
  .ff-title { font-size: 20px; }
  .ff-hint { font-size: 11px; }
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
  .ff-sticky { position: sticky; top: 0; background: $color-bg; z-index: 5; padding-bottom: 8rpx; }
}
</style>
