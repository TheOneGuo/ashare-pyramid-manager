<template>
  <view class="sankey-wrap">
    <svg
      class="sankey"
      :viewBox="`0 0 ${VB_W} ${VB_H}`"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <!-- 彩带：带色只看 fund；切 tab 高亮过渡 -->
      <path
        v-for="(e, i) in layout.edgeList"
        :key="'e' + i"
        :d="e.d"
        :fill="e.color"
        :opacity="e.opacity"
        class="sankey__edge"
      />

      <!-- 左列：4 类资金节点 -->
      <g v-for="(n, i) in layout.leftNodes" :key="'L' + i">
        <rect :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="8"
              :fill="n.color" fill-opacity="0.16" :stroke="n.color" stroke-opacity="0.55" />
        <text :x="n.x + n.w / 2" :y="n.y + n.h / 2 - 3" text-anchor="middle" class="sankey__node">{{ n.emoji }} {{ trunc(n.name, 4) }}</text>
        <text :x="n.x + n.w / 2" :y="n.y + n.h / 2 + 15" text-anchor="middle"
              :class="['sankey__chip', pctClass(n.totalPct)]">{{ pctText(n.totalPct) }}</text>
      </g>

      <!-- 右列：板块节点 + 右侧涨跌 chip -->
      <g v-for="(n, i) in layout.rightNodes" :key="'R' + i">
        <rect :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="8"
              fill="rgba(255,184,107,0.10)" stroke="rgba(255,184,107,0.30)" />
        <text :x="n.x + n.w / 2" :y="n.y + n.h / 2 + 5" text-anchor="middle" class="sankey__node">
          <title>{{ n.name }}</title>{{ trunc(n.name, 5) }}
        </text>
        <text :x="n.x + n.w + 8" :y="n.y + n.h / 2 + 5" text-anchor="start"
              :class="['sankey__chip', pctClass(n.pct)]">{{ pctText(n.pct) }}</text>
      </g>
    </svg>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { FundFlowResp, FundType, SectorNode, FundNode } from '@/api/fundflow'

const props = defineProps<{
  sankey: FundFlowResp['sankey']
  activeType: FundType
}>()

// ⚠️ 与 src/styles/theme.scss 的 $fund-* 同步（SVG 内联，无法用 SCSS 变量）
// 四色全部取自项目既有色板（金/青/暖灰/橙红），不引入新色
const FUND_COLORS: Record<string, string> = {
  joint: '#f4c542',
  public: '#72f7ff',
  stab: '#d3c3ad',
  foreign: '#ff7a3d',
}
const UP = '#e2553b' // 红涨（与其他 tab 一致）
const DOWN = '#26a86b' // 绿跌（与其他 tab 一致）

const VB_W = 690
const VB_H = 400
const PAD_T = 16
const LEFT_X = 8
const LEFT_W = 104
const RIGHT_W = 96
const RIGHT_X = 540
const LEFT_R = LEFT_X + LEFT_W // 112，彩带起点
const RIGHT_L = RIGHT_X // 540，彩带终点
const CX = (LEFT_R + RIGHT_L) / 2

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
// 三次 bezier 填充带（左节点右缘 → 右节点左缘）
function ribbon(x1: number, x2: number, cx: number, y1: number, y2: number, w: number): string {
  const w2 = w / 2
  return (
    `M ${x1},${(y1 - w2).toFixed(2)} ` +
    `C ${cx},${(y1 - w2).toFixed(2)} ${cx},${(y2 - w2).toFixed(2)} ${x2},${(y2 - w2).toFixed(2)} ` +
    `L ${x2},${(y2 + w2).toFixed(2)} ` +
    `C ${cx},${(y2 + w2).toFixed(2)} ${cx},${(y1 + w2).toFixed(2)} ${x1},${(y1 + w2).toFixed(2)} Z`
  )
}

const layout = computed(() => {
  const left = props.sankey.left
  const right = props.sankey.right
  const edges = props.sankey.edges
  const avail = VB_H - 2 * PAD_T

  const LH = 40
  const gapL = Math.max(8, (avail - left.length * LH) / Math.max(1, left.length - 1))
  const leftNodes = left.map((f: FundNode, i: number) => {
    const y = PAD_T + i * (LH + gapL)
    return { ...f, x: LEFT_X, y, w: LEFT_W, h: LH, cy: y + LH / 2, color: FUND_COLORS[f.colorKey] }
  })

  const N = right.length
  const RH = N > 6 ? Math.min(40, (avail - (N - 1) * 8) / N) : 40
  const gapR = N > 1 ? (avail - N * RH) / (N - 1) : 0
  const rightNodes = right.map((s: SectorNode, i: number) => {
    const y = PAD_T + i * (RH + gapR)
    return { ...s, x: RIGHT_X, y, w: RIGHT_W, h: RH, cy: y + RH / 2 }
  })

  const maxAbs = Math.max(0.0001, ...edges.map((e) => Math.abs(e.pct)))
  const edgeList = edges
    .map((e) => {
      const l = leftNodes.find((n) => n.type === e.fund)
      const r = rightNodes.find((n) => n.code === e.sectorCode)
      if (!l || !r) return null
      const w = clamp((Math.abs(e.pct) / maxAbs) * 26, 4, 26)
      const active = props.activeType === e.fund
      return {
        d: ribbon(LEFT_R, RIGHT_L, CX, l.cy, r.cy, w),
        color: FUND_COLORS[l.colorKey],
        opacity: active ? 0.85 : 0.15,
      }
    })
    .filter((x): x is { d: string; color: string; opacity: number } => x !== null)

  return { leftNodes, rightNodes, edgeList }
})

function pctClass(v: number): string {
  return v >= 0 ? 'is-up' : 'is-down'
}
function pctText(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}
function trunc(name: string, n: number): string {
  return name.length > n ? name.slice(0, n) + '…' : name
}
</script>

<style lang="scss" scoped>
.sankey-wrap {
  width: 100%;
  background: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
  border: 1rpx solid rgba(255, 184, 107, 0.24);
  border-radius: 20rpx;
  padding: $spacing-sm;
  box-sizing: border-box;
}
.sankey {
  display: block;
  width: 100%;
  height: auto;
}
.sankey__edge {
  transition: opacity 0.25s ease;
}
.sankey__node {
  fill: #f5ecd9;
  font-size: 13px;
  font-weight: 500;
  font-family: -apple-system, 'PingFang SC', sans-serif;
}
.sankey__chip {
  font-size: 12px;
  font-weight: 700;
  font-family: -apple-system, 'PingFang SC', sans-serif;
}
// 红涨绿跌（chip 只看符号，与 fund 颜色无关；与其他 tab 色板一致）
.is-up { fill: #e2553b; }
.is-down { fill: #26a86b; }
</style>
