<template>
  <view class="mk-page" :class="{ 'h5-mode': isH5 }">
    <TabBarComp v-if="isH5" />
    <view class="mk-head">
      <view class="mk-header">
        <text class="mk-title">行情中心</text>
        <text class="mk-hint">K线 · 北向 · 龙虎榜 · F10</text>
      </view>
      <view class="mk-source-strip">
        <view class="mk-source-chip" :class="{ active: tab === 'kline' }" @tap="switchTab('kline')"><text>K线</text></view>
        <view class="mk-source-chip" :class="{ active: tab === 'north' }" @tap="switchTab('north')"><text>北向</text></view>
        <view class="mk-source-chip" :class="{ active: tab === 'lhb' }" @tap="switchTab('lhb')"><text>龙虎榜</text></view>
        <view class="mk-source-chip" :class="{ active: tab === 'f10' }" @tap="switchTab('f10')"><text>F10</text></view>
      </view>
    </view>

    <view class="mk-body">
      <!-- K线 -->
      <view v-if="tab === 'kline'" class="mk-pane">
        <view class="mk-search">
          <input class="mk-input" v-model="code" placeholder="输入6位代码，如 600519" @confirm="loadKline" />
          <view class="mk-btn" @tap="loadKline">查询</view>
        </view>
        <view v-if="klineErr" class="mk-err"><text>{{ klineErr }}</text></view>
        <view v-if="klineItems.length" class="mk-kline-card">
          <view class="mk-kline-head">
            <text class="mk-kline-code">{{ code }}</text>
            <text class="mk-kline-last">最新 {{ lastClose }}</text>
            <text class="mk-kline-range">近 {{ klineItems.length }} 日</text>
          </view>
          <canvas
            type="2d"
            :id="'kline-canvas'"
            class="mk-canvas"
            @touchstart="onTouchStart"
            @touchmove="onTouchMove"
          ></canvas>
          <view v-if="hoverIdx >= 0 && hoverData" class="mk-hover">
            <text>{{ hoverData.date }} 收 {{ hoverData.close }} 量 {{ hoverData.volume }}</text>
          </view>
        </view>
        <view v-else-if="!klineErr" class="mk-empty"><text>输入代码查询历史K线</text></view>
      </view>

      <!-- 北向 -->
      <view v-else-if="tab === 'north'" class="mk-pane">
        <view v-if="northErr" class="mk-err"><text>{{ northErr }}</text></view>
        <view v-for="(n, i) in northItems" :key="i" class="mk-north-card">
          <view class="mk-north-row"><text class="mk-north-label">{{ n.板块 }}</text><text class="mk-north-date">{{ n.交易日 }}</text></view>
          <view class="mk-north-grid">
            <view class="mk-north-cell"><text class="mk-north-k">成交净买额</text><text class="mk-north-v">{{ n.成交净买额 }}</text></view>
            <view class="mk-north-cell"><text class="mk-north-k">资金净流入</text><text class="mk-north-v">{{ n.资金净流入 }}</text></view>
            <view class="mk-north-cell"><text class="mk-north-k">上涨/下跌</text><text class="mk-north-v">{{ n.上涨数 }}/{{ n.下跌数 }}</text></view>
            <view class="mk-north-cell"><text class="mk-north-k">相关指数</text><text class="mk-north-v">{{ n.相关指数 }} {{ n.指数涨幅 }}</text></view>
          </view>
        </view>
        <view v-if="!northItems.length && !northErr" class="mk-empty"><text>加载中…</text></view>
      </view>

      <!-- 龙虎榜 -->
      <view v-else-if="tab === 'lhb'" class="mk-pane">
        <view class="mk-search">
          <input class="mk-input" v-model="lhbDate" placeholder="日期 YYYYMMDD" @confirm="loadLhb" />
          <view class="mk-btn" @tap="loadLhb">查询</view>
        </view>
        <view v-if="lhbErr" class="mk-err"><text>{{ lhbErr }}</text></view>
        <view v-for="(it, i) in lhbItems" :key="i" class="mk-lhb-card">
          <view class="mk-lhb-row"><text class="mk-lhb-name">{{ it.名称 }}</text><text class="mk-lhb-code">{{ it.代码 }}</text><text class="mk-lhb-pct" :class="it.涨跌幅 >= 0 ? 'up' : 'down'">{{ it.涨跌幅 }}%</text></view>
          <view class="mk-lhb-meta"><text>净买额 {{ it.龙虎榜净买额 }} · 换手 {{ it.换手率 }}%</text></view>
          <view class="mk-lhb-reason"><text>{{ it.上榜原因 }}</text></view>
        </view>
        <view v-if="!lhbItems.length && !lhbErr" class="mk-empty"><text>加载中…</text></view>
      </view>

      <!-- F10 -->
      <view v-else-if="tab === 'f10'" class="mk-pane">
        <view class="mk-search">
          <input class="mk-input" v-model="code" placeholder="输入6位代码，如 600519" @confirm="loadF10" />
          <view class="mk-btn" @tap="loadF10">查询</view>
        </view>
        <view v-if="f10Err" class="mk-err"><text>{{ f10Err }}</text></view>
        <view v-if="f10Items.length" class="mk-f10-table">
          <view class="mk-f10-row mk-f10-row--head"><text class="mk-f10-c">日期</text><text class="mk-f10-c">指标</text><text class="mk-f10-c mk-f10-c--num">值</text></view>
          <view v-for="(r, i) in f10Rows" :key="i" class="mk-f10-row">
            <text class="mk-f10-c">{{ r.date }}</text>
            <text class="mk-f10-c">{{ r.key }}</text>
            <text class="mk-f10-c mk-f10-c--num">{{ r.val }}</text>
          </view>
        </view>
        <view v-else-if="!f10Err" class="mk-empty"><text>输入代码查询财务数据</text></view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TabBarComp from '@/custom-tab-bar/index.vue'
import { fetchHist, fetchNorth, fetchLhb, fetchF10, type KLine } from '@/api/market'

const isH5 = ref(false)
const tab = ref<'kline' | 'north' | 'lhb' | 'f10'>('kline')

const code = ref('600519')
const lhbDate = ref('20260819')

// K线
const klineItems = ref<KLine[]>([])
const klineErr = ref('')
const lastClose = computed(() => (klineItems.value.length ? klineItems.value[klineItems.value.length - 1].close : '—'))

// 北向
const northItems = ref<any[]>([])
const northErr = ref('')

// 龙虎榜
const lhbItems = ref<any[]>([])
const lhbErr = ref('')

// F10
const f10Items = ref<Record<string, any>[]>([])
const f10Err = ref('')
const f10Rows = computed(() => {
  const rows: { date: string; key: string; val: string }[] = []
  for (const item of f10Items.value) {
    const date = item['日期'] || ''
    for (const k of Object.keys(item)) {
      if (k === '日期') continue
      const v = item[k]
      rows.push({ date, key: k, val: v === null || v === undefined ? '—' : String(v) })
    }
  }
  return rows.slice(0, 60)
})

// canvas 交互
const hoverIdx = ref(-1)
const hoverData = ref<KLine | null>(null)
let canvasCtx: any = null
let canvasW = 0
let canvasH = 0
let dpr = 1

onMounted(() => {
  isH5.value = typeof window !== 'undefined'
  loadKline()
  loadNorth()
  loadLhb()
  if (code.value) loadF10()
})

onShow(() => {
  // 复用 news/portfolio 的跨页联动：若从持仓页带聚焦代码过来
  try {
    const fc = uni.getStorageSync('market_focus_code')
    if (fc) {
      code.value = fc
      uni.removeStorageSync('market_focus_code')
      loadKline()
      loadF10()
    }
  } catch (e) { /* ignore */ }
})

function switchTab(t: 'kline' | 'north' | 'lhb' | 'f10') {
  tab.value = t
}

async function loadKline() {
  klineErr.value = ''
  klineItems.value = []
  if (!/^\d{6}$/.test(code.value)) { klineErr.value = '请输入6位数字代码'; return }
  try {
    const r = await fetchHist(code.value, { limit: 120, adjust: 'qfq' })
    if (!r.ok || !r.items) { klineErr.value = r.error || '无数据'; return }
    klineItems.value = r.items
    await nextTick()
    drawKline()
  } catch (e: any) {
    klineErr.value = e.message || '请求失败'
  }
}

async function loadNorth() {
  northErr.value = ''
  try {
    const r = await fetchNorth(60)
    if (!r.ok || !r.items) { northErr.value = r.error || '无数据'; return }
    northItems.value = r.items
  } catch (e: any) {
    northErr.value = e.message || '请求失败'
  }
}

async function loadLhb() {
  lhbErr.value = ''
  lhbItems.value = []
  if (!/^\d{8}$/.test(lhbDate.value)) { lhbErr.value = '日期格式 YYYYMMDD'; return }
  try {
    const r = await fetchLhb(lhbDate.value, 50)
    if (!r.ok || !r.items) { lhbErr.value = r.error || '无数据'; return }
    lhbItems.value = r.items
  } catch (e: any) {
    lhbErr.value = e.message || '请求失败'
  }
}

async function loadF10() {
  f10Err.value = ''
  f10Items.value = []
  if (!/^\d{6}$/.test(code.value)) { f10Err.value = '请输入6位数字代码'; return }
  try {
    const r = await fetchF10(code.value, 'indicator', 40)
    if (!r.ok || !r.items) { f10Err.value = r.error || '无数据'; return }
    f10Items.value = r.items
  } catch (e: any) {
    f10Err.value = e.message || '请求失败'
  }
}

// ---- 手绘 K 线 ----
async function drawKline() {
  if (isH5.value) {
    drawWithSelector('#kline-canvas')
  } else {
    // 小程序：用 uni.createSelectorQuery
    try {
      const q: any = (uni as any).createSelectorQuery()
      q.select('#kline-canvas').fields({ node: true, size: true }).exec((res: any) => {
        if (!res || !res[0] || !res[0].node) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        dpr = uni.getSystemInfoSync().pixelRatio || 2
        canvas.width = res[0].width * dpr
        canvas.height = res[0].height * dpr
        ctx.scale(dpr, dpr)
        canvasW = res[0].width
        canvasH = res[0].height
        canvasCtx = ctx
        renderKline()
      })
    } catch (e) { /* ignore */ }
  }
}

function drawWithSelector(sel: string) {
  // uni-app H5 把 <canvas type=2d> 包成 <uni-canvas>，内部才是真实 <canvas>
  const wrap = document.querySelector(sel) as any
  if (!wrap) return
  const el = wrap.querySelector ? wrap.querySelector('canvas') : null
  const target = el || wrap
  const ctx = target.getContext('2d')
  dpr = window.devicePixelRatio || 2
  const rect = el.getBoundingClientRect()
  el.width = rect.width * dpr
  el.height = rect.height * dpr
  ctx.scale(dpr, dpr)
  canvasW = rect.width
  canvasH = rect.height
  canvasCtx = ctx
  renderKline()
}

function renderKline() {
  const ctx = canvasCtx
  if (!ctx) return
  const data = klineItems.value
  if (!data.length) return
  const padL = 8, padR = 8, padT = 10, padB = 18
  const w = canvasW - padL - padR
  const h = canvasH - padT - padB
  ctx.clearRect(0, 0, canvasW, canvasH)

  let min = Infinity, max = -Infinity
  for (const d of data) { min = Math.min(min, d.low); max = Math.max(max, d.high) }
  const range = max - min || 1
  const step = w / data.length

  // 网格 + 价格刻度
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  for (let g = 0; g <= 4; g++) {
    const y = padT + (h * g) / 4
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke()
  }

  // K线
  const bw = Math.max(1.5, step * 0.6)
  for (let i = 0; i < data.length; i++) {
    const d = data[i]
    const x = padL + step * i + step / 2
    const yOpen = padT + h * (1 - (d.open - min) / range)
    const yClose = padT + h * (1 - (d.close - min) / range)
    const yHigh = padT + h * (1 - (d.high - min) / range)
    const yLow = padT + h * (1 - (d.low - min) / range)
    const up = d.close >= d.open
    ctx.strokeStyle = up ? '#e2553b' : '#26a86b'
    ctx.fillStyle = up ? '#e2553b' : '#26a86b'
    // 影线
    ctx.beginPath(); ctx.moveTo(x, yHigh); ctx.lineTo(x, yLow); ctx.stroke()
    // 实体
    const yo = Math.min(yOpen, yClose)
    const bh = Math.max(1, Math.abs(yClose - yOpen))
    ctx.fillRect(x - bw / 2, yo, bw, bh)
  }

  // 最新价线
  const lastY = padT + h * (1 - (data[data.length - 1].close - min) / range)
  ctx.strokeStyle = 'rgba(244,197,66,0.5)'
  ctx.setLineDash([4, 3])
  ctx.beginPath(); ctx.moveTo(padL, lastY); ctx.lineTo(padL + w, lastY); ctx.stroke()
  ctx.setLineDash([])
}

function onTouchStart(e: any) { handleTouch(e) }
function onTouchMove(e: any) { handleTouch(e) }
function handleTouch(e: any) {
  const data = klineItems.value
  if (!data.length || !canvasW) return
  const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
  if (!t) return
  const cx = (t.x !== undefined ? t.x : t.clientX) - 8
  const step = (canvasW - 16) / data.length
  const idx = Math.floor(cx / step)
  if (idx >= 0 && idx < data.length) {
    hoverIdx.value = idx
    hoverData.value = data[idx]
  }
}
</script>

<style lang="scss" scoped>
$rf-cyan: #72f7ff;
$rf-amber: #ffb86b;
$rf-orange: rgba(255, 184, 107, 1);
$rf-cream: #f5ecd9;
$rf-muted: #a89a82;
$color-bg: #0d1b2a;
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: #f5ecd9;
$color-text-secondary: #a89a82;
$color-text-warm: #d3c3ad;
$color-match-bg: rgba(114, 247, 255, 0.12);
$color-match-border: rgba(114, 247, 255, 0.5);
$radius-md: 14px;
$radius-lg: 18px;
$radius-full: 999px;

.mk-page {
  min-height: 100vh;
  background: $color-bg;
  color: $color-text-primary;
  font-family: -apple-system, 'PingFang SC', sans-serif;
  padding-bottom: 140rpx;
}
.mk-head {
  position: sticky;
  top: 0;
  z-index: 10;
  background: $color-bg;
  padding: 16rpx 0 8rpx;
}
.mk-header { padding: 0 24rpx; }
.mk-title { font-size: 44rpx; font-weight: 700; color: $color-text-primary; }
.mk-hint { display: block; font-size: 22rpx; color: $color-text-secondary; margin-top: 4rpx; }
.mk-source-strip {
  display: flex;
  gap: 12rpx;
  padding: 16rpx 24rpx 0;
}
.mk-source-chip {
  padding: 10rpx 28rpx;
  border-radius: $radius-full;
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  color: $color-text-secondary;
  font-size: 26rpx;
  font-weight: 600;
  transition: all 0.18s ease;
}
.mk-source-chip.active {
  background: linear-gradient(180deg, #f4c542, #d89c1c);
  color: #1a1206;
  border-color: transparent;
}

.mk-body { padding: 16rpx 24rpx; }
.mk-pane { display: flex; flex-direction: column; gap: 16rpx; }

.mk-search { display: flex; gap: 12rpx; }
.mk-input {
  flex: 1;
  height: 72rpx;
  padding: 0 20rpx;
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  border-radius: $radius-md;
  color: $color-text-primary;
  font-size: 28rpx;
}
.mk-btn {
  width: 140rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 72rpx;
  border-radius: $radius-md;
  background: linear-gradient(180deg, #f4c542, #d89c1c);
  color: #1a1206;
  font-weight: 700;
  font-size: 28rpx;
}

.mk-err { color: #e2553b; font-size: 24rpx; padding: 12rpx 0; }
.mk-empty { color: $color-text-secondary; font-size: 26rpx; padding: 40rpx 0; text-align: center; }

.mk-kline-card {
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  border-radius: $radius-lg;
  padding: 16rpx;
}
.mk-kline-head { display: flex; align-items: center; gap: 16rpx; margin-bottom: 8rpx; }
.mk-kline-code { font-size: 28rpx; font-weight: 700; color: $color-text-primary; }
.mk-kline-last { font-size: 24rpx; color: $rf-amber; }
.mk-kline-range { font-size: 22rpx; color: $color-text-secondary; margin-left: auto; }
.mk-canvas { width: 100%; height: 420rpx; display: block; }
.mk-hover {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $color-text-secondary;
  text-align: center;
}

.mk-north-card, .mk-lhb-card {
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  border-radius: $radius-lg;
  padding: 20rpx;
}
.mk-north-row { display: flex; justify-content: space-between; align-items: center; }
.mk-north-label { font-size: 30rpx; font-weight: 700; color: $rf-cream; }
.mk-north-date { font-size: 22rpx; color: $color-text-secondary; }
.mk-north-grid { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 12rpx; }
.mk-north-cell { width: calc(50% - 6rpx); display: flex; flex-direction: column; }
.mk-north-k { font-size: 22rpx; color: $color-text-secondary; }
.mk-north-v { font-size: 30rpx; font-weight: 700; color: $color-text-primary; }

.mk-lhb-row { display: flex; align-items: center; gap: 12rpx; }
.mk-lhb-name { font-size: 30rpx; font-weight: 700; color: $rf-cream; }
.mk-lhb-code { font-size: 22rpx; color: $color-text-secondary; }
.mk-lhb-pct { margin-left: auto; font-size: 26rpx; font-weight: 700; }
.mk-lhb-pct.up { color: #e2553b; }
.mk-lhb-pct.down { color: #26a86b; }
.mk-lhb-meta { font-size: 22rpx; color: $color-text-secondary; margin-top: 6rpx; }
.mk-lhb-reason { font-size: 22rpx; color: $rf-amber; margin-top: 6rpx; }

.mk-f10-table {
  background: $color-card-bg;
  border: 1rpx solid $color-border;
  border-radius: $radius-lg;
  overflow: hidden;
}
.mk-f10-row {
  display: flex;
  padding: 14rpx 16rpx;
  border-bottom: 1rpx solid $color-border;
  font-size: 24rpx;
}
.mk-f10-row--head { color: $color-text-secondary; font-weight: 700; background: rgba(255,255,255,0.03); }
.mk-f10-c { flex: 1; color: $color-text-primary; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk-f10-c--num { flex: 1; text-align: right; color: $rf-amber; }
</style>
