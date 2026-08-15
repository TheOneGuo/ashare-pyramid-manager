<template>
  <view class="pf-page" :class="{ 'h5-mode': isH5 }" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
    <TabBarComp v-if="isH5" />
    <!-- 固定在顶部的 head 区：标题 + 提示 -->
    <view class="pf-head">
      <text class="pf-title">持仓分析</text>
      <text class="pf-hint">下拉刷新最新 · AI 建议仅供参考</text>
    </view>

    <!-- 可滚动内容区（滚动条仅在此区域内） -->
    <view class="pf-body">
    <!-- Touch 下拉指示器 -->
    <view v-if="pullDistance > 0" class="pf-pull-indicator" :style="{ height: pullDistance + 'px', opacity: pullProgress }">
      <text class="pf-pull-text">{{ pullText }}</text>
    </view>

    <!-- ① 账户与保证金 -->
    <view class="pf-card pf-ledger">
      <view class="pf-import-head" @tap="ledgerOpen = !ledgerOpen">
        <text class="pf-section-title">🏦 账户与保证金</text>
        <text class="pf-toggle">{{ ledgerOpen ? '收起' : '展开' }}</text>
      </view>

      <view v-if="ledgerOpen" class="pf-ledger-body">
        <!-- 未配置：初始录入（总资金 + 佣金） -->
        <view v-if="!ledgerSnapshot.configured" class="pf-ledger-init">
          <view class="pf-row">
            <view class="pf-col">
              <text class="pf-label">总资金（元）</text>
              <input class="pf-input" type="number" :value="totalCapital == null ? '' : totalCapital" @input="onCapitalInput" placeholder="请输入总资金，如 500000" />
            </view>
            <view class="pf-col">
              <text class="pf-label">佣金（万分之）</text>
              <input class="pf-input" type="number" :value="feeWan == null ? '' : feeWan" @input="onFeeInput" placeholder="请输入佣金，如 1.2" />
            </view>
          </view>
          <view class="pf-btn pf-btn--primary pf-btn--block" hover-class="pf-btn--hover" @tap="onLedgerConfirmInit">
            <text>确认账户</text>
          </view>
          <view v-if="ledgerInitMsg" class="pf-note" :class="ledgerInitOk ? 'pf-note--ok' : 'pf-note--warn'">{{ ledgerInitMsg }}</view>
        </view>

        <!-- 已配置：状态 + 操作 -->
        <view v-else class="pf-ledger-state">
          <view class="pf-ledger-grid">
            <view class="pf-ledger-cell"><text class="pf-ledger-k">总保证金</text><text class="pf-ledger-v">{{ fmtMoney(ledgerSnapshot.total_margin) }}</text></view>
            <view class="pf-ledger-cell"><text class="pf-ledger-k">可开标的上限</text><text class="pf-ledger-v">{{ ledgerSnapshot.max_hold }}</text></view>
            <view class="pf-ledger-cell"><text class="pf-ledger-k">已分配资金</text><text class="pf-ledger-v">{{ fmtMoney(ledgerSnapshot.allocated) }}</text></view>
            <view class="pf-ledger-cell"><text class="pf-ledger-k">可分配额度</text><text class="pf-ledger-v pf-ledger-v--cyan">{{ fmtMoney(ledgerSnapshot.available) }}</text></view>
            <view class="pf-ledger-cell"><text class="pf-ledger-k">手续费率</text><text class="pf-ledger-v">万分之 {{ ledgerSnapshot.fee_rate_wan }}</text></view>
            <view class="pf-ledger-cell"><text class="pf-ledger-k">累计实现盈亏</text><text class="pf-ledger-v" :class="ledgerSnapshot.realized_pnl >= 0 ? 'pf-up' : 'pf-down'">{{ fmtMoney(ledgerSnapshot.realized_pnl) }}</text></view>
          </view>

          <view class="pf-ledger-meta">
            可开标的 {{ ledgerSnapshot.max_hold }} 个 · 已分配 {{ fmtMoney(ledgerSnapshot.allocated) }} 元 · 可分配额度 {{ fmtMoney(ledgerSnapshot.available) }} 元
          </view>

          <view class="pf-ledger-actions">
            <view class="pf-btn pf-btn--secondary pf-btn--xs" hover-class="pf-btn--hover" @tap="onLedgerDeposit"><text>加保证金</text></view>
            <view class="pf-btn pf-btn--secondary pf-btn--xs" hover-class="pf-btn--hover" @tap="onLedgerWithdraw"><text>提保证金</text></view>
            <view class="pf-btn pf-btn--secondary pf-btn--xs" hover-class="pf-btn--hover" @tap="onLedgerFee"><text>改手续费率</text></view>
            <view class="pf-btn pf-btn--secondary pf-btn--xs" hover-class="pf-btn--hover" @tap="onLedgerReset"><text>重置</text></view>
          </view>
          <view v-if="ledgerMsg" class="pf-note" :class="ledgerMsgOk ? 'pf-note--ok' : 'pf-note--warn'">{{ ledgerMsg }}</view>

          <!-- 费率警告 -->
          <view v-if="ledgerSnapshot.fee_level === 'warn_low' || ledgerSnapshot.fee_level === 'warn_high'" class="pf-fee-warn">
            <text>⚠️ 费率{{ ledgerSnapshot.fee_level === 'warn_low' ? '偏低' : '偏高' }}：{{ ledgerSnapshot.fee_msg }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ② 截图 / 手动输入 Import 折叠区 -->
    <view class="pf-card pf-import">
      <view class="pf-import-head" @tap="importOpen = !importOpen">
        <text class="pf-section-title">📥 已有持仓（截图或手动）</text>
        <text class="pf-toggle">{{ importOpen ? '收起' : '展开' }}</text>
      </view>
      <view v-if="importOpen" class="pf-import-body">
        <view class="pf-import-actions">
          <view class="pf-btn pf-btn--secondary" hover-class="pf-btn--hover" @tap="onUpload">
            <text>📷 上传截图</text>
          </view>
          <view class="pf-btn pf-btn--secondary" hover-class="pf-btn--hover" @tap="onMockExtract">
            <text>🤖 智能识别（mock）</text>
          </view>
        </view>
        <textarea
          v-model="importText"
          class="pf-textarea"
          placeholder="粘贴持仓（每行：代码 成本 数量）例如：&#10;600519 1700 100&#10;000858 165 200"
          :auto-height="true"
        />
        <view class="pf-import-actions">
          <view class="pf-btn pf-btn--primary" hover-class="pf-btn--hover" @tap="onImport">
            <text>导入到持仓列表</text>
          </view>
          <view class="pf-btn pf-btn--primary" hover-class="pf-btn--hover" @tap="manualOpen = !manualOpen">
            <text>➕ 手动输入</text>
          </view>
        </view>
        <!-- 手动输入表单 -->
        <view v-if="manualOpen" class="pf-manual-row">
          <input class="pf-input pf-input--sm" v-model="manualCode" placeholder="代码" />
          <input class="pf-input pf-input--sm" v-model="manualName" placeholder="名称" />
          <input class="pf-input pf-input--xs" type="number" v-model.number="manualCost" placeholder="成本" />
          <input class="pf-input pf-input--xs" type="number" v-model.number="manualQty" placeholder="数量" />
          <view class="pf-btn pf-btn--primary pf-btn--xs" hover-class="pf-btn--hover" @tap="onManualAdd"><text>添加</text></view>
        </view>
        <view v-if="ocrNote" class="pf-note">{{ ocrNote }}</view>

        <!-- 持仓列表（逐行编辑/删除） -->
        <view v-if="holdings.length" class="pf-hold-list">
          <view v-for="h in holdings" :key="h.stock_code" class="pf-hold-row">
            <text class="pf-hold-name">{{ h.short_name || h.stock_code }} · {{ h.stock_code }}</text>
            <input class="pf-hold-input pf-hold-input--cost" type="number" v-model.number="h.cost_basis" @blur="onHoldChange(h)" />
            <input class="pf-hold-input pf-hold-input--qty" type="number" v-model.number="h.shares" @blur="onHoldChange(h)" />
            <text class="pf-hold-del" @tap="onHoldDel(h)">✕</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ③ 拟新买标的 -->
    <view class="pf-card pf-proposed">
      <view class="pf-import-head" @tap="proposedOpen = !proposedOpen">
        <text class="pf-section-title">🎯 拟新买标的</text>
        <text class="pf-toggle">{{ proposedOpen ? '收起' : '展开' }}</text>
      </view>
      <view v-if="proposedOpen" class="pf-import-body">
        <view class="pf-proposed-labels">
          <text style="flex:0 0 200rpx">代码</text>
          <text style="flex:1">名称</text>
          <text style="flex:0 0 140rpx">基准价格</text>
          <text style="flex:0 0 56rpx"></text>
        </view>
        <view class="pf-proposed-added">
          <view v-for="(p, i) in proposedTargets" :key="i" class="pf-proposed-row">
            <input class="pf-input pf-input--sm" v-model="p.code" placeholder="代码" />
            <input class="pf-input pf-input--md" v-model="p.name" placeholder="名称" />
            <input class="pf-input pf-input--xs" type="number" v-model.number="p.price" placeholder="基准价" />
            <text class="pf-rec-del" @tap="proposedTargets.splice(i, 1)">✕</text>
          </view>
        </view>
        <view class="pf-proposed-actions">
          <view class="pf-btn pf-btn--primary" hover-class="pf-btn--hover" @tap="proposedTargets.push({ code: '', name: '', price: null })">
            <text>＋ 添加标的</text>
          </view>
          <view class="pf-btn pf-btn--primary pf-run-btn" hover-class="pf-btn--hover" @tap="onRunAnalyze" :class="{ 'pf-btn--loading': analyzeLoading }">
            <text>{{ analyzeLoading ? '分析中…' : '开始分析' }}</text>
          </view>
        </view>
        <view class="pf-run-status">{{ analyzeStatus }}</view>
        <view v-if="feeWarning" class="pf-fee-warn" :class="feeWarningClass">
          <text>⚠️ {{ feeWarning }}</text>
        </view>
      </view>
    </view>

    <!-- ⑥ 策略方案（现有持仓处置 + 新标的方案） -->
    <view v-if="analyzeReport" class="pf-card pf-report">
      <text class="pf-section-title">📐 策略方案</text>
      <view v-if="analyzeReport.notices && analyzeReport.notices.length" class="pf-notice-list">
        <view v-for="(n, i) in analyzeReport.notices" :key="i" class="pf-notice"><text>· {{ n }}</text></view>
      </view>
      <view v-if="analyzeReport.fee_level === 'warn_low' || analyzeReport.fee_level === 'warn_high'" class="pf-fee-warn">
        <text>⚠️ 费率{{ analyzeReport.fee_level === 'warn_low' ? '偏低' : '偏高' }}：{{ analyzeReport.fee_msg }}</text>
      </view>

      <!-- 价格偏离核对 -->
      <view v-if="analyzeReport.confirms && analyzeReport.confirms.length" class="pf-confirms">
        <view v-for="c in analyzeReport.confirms" :key="c.code" class="pf-confirm">
          <text>{{ c.code }} {{ c.name }}：现价偏离基准价超过 2%，基准价区间 {{ fmtMoney(c.limit_lo, 2) }}~{{ fmtMoney(c.limit_hi, 2) }}。请核对。</text>
          <view class="pf-btn pf-btn--primary pf-btn--xs" @tap="onConfirmPrice(c.code)"><text>核对无误，继续计算</text></view>
        </view>
      </view>

      <!-- 现有持仓处置 -->
      <view v-if="analyzeReport.existing_advice && analyzeReport.existing_advice.length" class="pf-existing">
        <text class="pf-sub-section-title">📋 现有持仓处置</text>
        <view v-for="ea in analyzeReport.existing_advice" :key="ea.code || ea.text" class="pf-existing-row">
          <view v-if="ea.type === 'global'" class="pf-existing-global"><text>{{ ea.text }}</text></view>
          <view v-else-if="ea.type === 'invalid'" class="pf-existing-invalid"><text>{{ ea.text }}</text></view>
          <view v-else class="pf-existing-item">
            <text class="pf-existing-code">{{ ea.code }} {{ ea.name }}</text>
            <text class="pf-existing-action" :class="actionClass(ea.action)">{{ ea.action }}</text>
            <PlanTable v-if="ea.plan && ea.plan.rows && ea.plan.rows.length" :plan="ea.plan" />
          </view>
        </view>
      </view>

      <!-- 新标的方案 -->
      <view v-if="analyzeReport.stocks && analyzeReport.stocks.length">
        <text class="pf-sub-section-title">🎯 新标的方案</text>
        <view v-for="s in analyzeReport.stocks" :key="(s.code || '') + (s.name || '')" class="pf-stock">
          <view class="pf-stock-head">
            <text class="pf-stock-code">{{ s.code }} {{ s.name }}</text>
            <text class="pf-stock-budget">单标 {{ fmtMoney(s.capital) }} 元 · ATR {{ fmtPct(s.atr_pct) }}</text>
          </view>
          <view v-if="s.error" class="pf-stock-err">⚠️ {{ s.error }}</view>
          <view v-else-if="s.plan && s.plan.too_expensive" class="pf-stock-err">价格过高 · 当前资金无法开出 4 笔完整仓位，建议更换标的</view>
          <view v-else-if="s.plan && s.plan.rows && s.plan.rows.length">
            <PlanTable :plan="s.plan" />
          </view>
          <view v-else class="pf-stock-err">无方案</view>
        </view>
      </view>
    </view>

    <!-- ⑦ 持仓方案跟踪 -->
    <view class="pf-card pf-track">
      <view class="pf-import-head" @tap="trackOpen = !trackOpen">
        <text class="pf-section-title">🗂️ 持仓方案跟踪</text>
        <text class="pf-toggle">{{ trackOpen ? '收起' : '展开' }}</text>
      </view>
      <view v-if="trackOpen" class="pf-import-body">
        <view v-if="planItems.length === 0" class="pf-empty"><text>分析后生成的固定项会列在这里。每个标的成一项，输入现价即可查看触发进度。</text></view>
        <view v-else>
          <view
            v-for="(it, idx) in planItems"
            :key="it.stock_code"
            class="pf-track-item"
            :class="{ active: trackSelected === it.stock_code }"
            @tap="onTrackSelect(it.stock_code)"
          >
            <view class="pf-track-item-head">
              <text class="pf-track-code">{{ it.stock_code }} {{ it.stock_name }}</text>
              <text class="pf-track-invest">投入 {{ fmtMoney(it.total_invest) }}</text>
            </view>
          </view>

          <!-- 选中项详情 -->
          <view v-if="selectedPlan" class="pf-track-detail">
            <view class="pf-track-detail-head">
              <text>{{ selectedPlan.stock_code }} {{ selectedPlan.stock_name }}</text>
              <text>基准 {{ fmtMoney(selectedPlan.p0) }} · ATR {{ fmtPct(selectedPlan.atr_pct) }}</text>
            </view>
            <view class="pf-row pf-track-cur-row">
              <text class="pf-label">当前价</text>
              <input class="pf-input pf-input--sm" type="number" v-model.number="trackCurPrice" @input="onTrackEval" />
              <view class="pf-btn pf-btn--secondary pf-btn--xs" @tap="onTrackReset"><text>重置执行</text></view>
            </view>
            <view class="pf-track-steps">
              <view v-for="(step, i) in trackSteps" :key="i" class="pf-track-step" :class="stepClass(step)">
                <text class="pf-track-step-name">{{ step.kindLabel }}</text>
                <text class="pf-track-step-info">{{ step.info }}</text>
                <text class="pf-track-step-state">{{ step.done ? '✓ 已执行' : (step.armed ? '价位已到 / 执行' : '待触发') }}</text>
              </view>
            </view>
            <view class="pf-track-hint">到达价位默认自动执行，下一步开/平仓数量已算好。</view>
          </view>
        </view>
      </view>
    </view>

    <view class="pf-disclaimer">
      <text>AI + 算法建议不构成投资建议 · 投资有风险，入市需谨慎</text>
    </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { onShow } from '@dcloudio/uni-app'
// H5 端手动挂载自定义 tabBar（WeChat 端由 custom:true 自动挂载，此处按条件跳过）
const isH5 = ref(typeof window !== 'undefined')
import TabBarComp from '@/custom-tab-bar/index.vue'
import {
  listHoldings, upsertHolding, deleteHolding,
  extractFromImages, analyzePortfolio,
  getLedger, appendLedgerEvent, previewLedgerEvent, clearLedger,
  listPlans, deletePlan,
  type Holding, type AnalyzeReport,
  type LedgerSnapshot, type LedgerEvent, type PlanItem,
} from '@/api/portfolio'
import { parseHoldingsText, fmtMoney, fmtPct, tierLabel, padCode } from '@/utils/portfolioFormat'

// ── ① 账本 ──
const ledgerOpen = ref(true)
const ledgerSnapshot = ref<LedgerSnapshot>(emptySnapshot())
const ledgerEvents = ref<LedgerEvent[]>([])
const ledgerInitMsg = ref('')
const ledgerInitOk = ref(true)
const ledgerMsg = ref('')
const ledgerMsgOk = ref(true)

function emptySnapshot(): LedgerSnapshot {
  return {
    ok: false, configured: false, initial_margin: 0, deposit_total: 0, withdraw_total: 0,
    realized_pnl: 0, total_margin: 0, allocated: 0, available: 0, held_count: 0,
    max_hold: 0, can_open_more: 0, fee_rate_wan: 0, fee_level: 'ok', fee_msg: '', small_account: false,
  }
}

async function loadLedger() {
  try {
    const r = await getLedger()
    ledgerSnapshot.value = r.snapshot || emptySnapshot()
    ledgerEvents.value = r.events || []
  } catch (e) {
    console.warn('[ledger] load failed', e)
  }
}

async function onLedgerConfirmInit() {
  ledgerInitMsg.value = ''
  if (!totalCapital.value || totalCapital.value <= 0) {
    ledgerInitOk.value = false; ledgerInitMsg.value = '请输入有效总资金'; return
  }
  if (!feeWan.value || feeWan.value <= 0) {
    ledgerInitOk.value = false; ledgerInitMsg.value = '请输入有效手续费率'; return
  }
  try {
    const r = await appendLedgerEvent('init', { amount: totalCapital.value, fee_rate_wan: feeWan.value })
    if (r.ok) {
      ledgerSnapshot.value = r.snapshot
      ledgerEvents.value = r.events
      ledgerInitOk.value = true
      ledgerInitMsg.value = '账户已确认'
    } else {
      ledgerInitOk.value = false
      ledgerInitMsg.value = '确认失败'
    }
  } catch (e: any) {
    ledgerInitOk.value = false; ledgerInitMsg.value = e?.message || '确认失败'
  }
}

async function onLedgerDeposit() {
  const amt = await uniPrompt('添加保证金', '请输入添加金额（元）')
  if (amt == null) return
  await applyLedgerEvent('deposit', amt, '添加成功')
}
async function onLedgerWithdraw() {
  const amt = await uniPrompt('提取保证金', `可提取上限 ${fmtMoney(ledgerSnapshot.value.available)} 元（已有持仓占用需先平仓）`)
  if (amt == null) return
  // 先预览校验上限
  try {
    const prev = await previewLedgerEvent('withdraw', amt)
    if (!prev.ok) {
      ledgerMsgOk.value = false; ledgerMsg.value = prev.preview?.msg || '提取失败'; return
    }
  } catch (e) { /* 继续 */ }
  await applyLedgerEvent('withdraw', amt, '提取成功')
}
async function onLedgerFee() {
  const v = await uniPrompt('手续费率', '请输入费率（万分之，0.1~10）')
  if (v == null) return
  try {
    const prev = await previewLedgerEvent('fee_rate_change', undefined, v)
    if (!prev.ok) { ledgerMsgOk.value = false; ledgerMsg.value = prev.preview?.msg || '费率非法'; return }
    if (prev.preview?.requires_confirm) {
      uni.showModal({ title: '费率提醒', content: prev.preview.msg || '', success: async (m) => { if (m.confirm) await applyLedgerEvent('fee_rate_change', undefined, '费率已更新', v) } })
      return
    }
    await applyLedgerEvent('fee_rate_change', undefined, '费率已更新', v)
  } catch (e: any) { ledgerMsgOk.value = false; ledgerMsg.value = e?.message || '费率更新失败' }
}
async function onLedgerReset() {
  uni.showModal({
    title: '重置账本', content: '将清空全部账本事件，重新开始。确认？', success: async (m) => {
      if (!m.confirm) return
      try { await clearLedger(); ledgerSnapshot.value = emptySnapshot(); ledgerEvents.value = []; ledgerMsgOk.value = true; ledgerMsg.value = '账本已重置'; totalCapital.value = null; feeWan.value = null } catch (e: any) { ledgerMsgOk.value = false; ledgerMsg.value = e?.message || '重置失败' }
    },
  })
}
async function applyLedgerEvent(type: string, amount: number | undefined, okMsg: string, feeWanArg?: number) {
  ledgerMsg.value = ''
  const payload: any = {}
  if (amount != null) payload.amount = amount
  if (feeWanArg != null) payload.fee_rate_wan = feeWanArg
  try {
    const r = await appendLedgerEvent(type, payload)
    if (r.ok) {
      ledgerSnapshot.value = r.snapshot; ledgerEvents.value = r.events
      ledgerMsgOk.value = true; ledgerMsg.value = okMsg
      // 账本变化影响可用资金 → 同步总资金输入
      if (type === 'init' || type === 'deposit' || type === 'withdraw') {
        totalCapital.value = Math.round(r.snapshot.total_margin)
        feeWan.value = r.snapshot.fee_rate_wan
      }
    } else {
      ledgerMsgOk.value = false; ledgerMsg.value = '操作失败'
    }
  } catch (e: any) { ledgerMsgOk.value = false; ledgerMsg.value = e?.message || '操作失败' }
}

// ── 通用 prompt（uni 无原生 prompt，用 modal+input 模拟） ──
function uniPrompt(title: string, placeholder: string): Promise<number | null> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content: placeholder,
      editable: true,
      placeholderText: '请输入数字',
      success: (m) => {
        if (!m.confirm) return resolve(null)
        const n = Number((m as any).content)
        if (!m.content || Number.isNaN(n) || n <= 0) { uni.showToast({ title: '输入无效', icon: 'none' }); return resolve(null) }
        resolve(n)
      },
      fail: () => resolve(null),
    })
  })
}

// ── ② 已有持仓 ──
const importOpen = ref(true)
const importText = ref('')
const ocrNote = ref('')
const holdings = ref<Holding[]>([])

// 手动输入
const manualOpen = ref(false)
const manualCode = ref('')
const manualName = ref('')
const manualCost = ref<number | null>(null)
const manualQty = ref<number | null>(null)
async function onManualAdd() {
  const code = padCode(manualCode.value)
  if (!/^\d{6}$/.test(code)) { uni.showToast({ title: '代码格式错误（6 位数字）', icon: 'none' }); return }
  if (!manualCost.value || !manualQty.value) { uni.showToast({ title: '请输入成本与数量', icon: 'none' }); return }
  try {
    await upsertHolding({ stock_code: code, short_name: manualName.value.trim(), shares: manualQty.value, cost_basis: manualCost.value })
    manualCode.value = ''; manualName.value = ''; manualCost.value = null; manualQty.value = null; manualOpen.value = false
    await loadHoldings(); await loadLedger()
    uni.showToast({ title: '已添加持仓', icon: 'success' })
  } catch (e) { uni.showToast({ title: '添加失败', icon: 'none' }) }
}

async function loadHoldings() {
  try {
    holdings.value = await listHoldings()
  } catch (e) { console.warn('[holdings] load failed', e) }
}
async function onHoldChange(h: Holding) {
  try { await upsertHolding({ stock_code: h.stock_code, short_name: h.short_name, shares: h.shares, cost_basis: h.cost_basis }); await loadLedger() } catch (e) { uni.showToast({ title: '保存失败', icon: 'none' }) }
}
async function onHoldDel(h: Holding) {
  try { await deleteHolding(h.stock_code); await loadHoldings(); await loadLedger() } catch (e) { uni.showToast({ title: '删除失败', icon: 'none' }) }
}
function onUpload() {
  uni.chooseImage({
    count: 1,
    success: async (res) => {
      const fp = res.tempFilePaths?.[0]
      if (!fp) return
      uni.hideLoading()
      uni.showToast({ title: '已选图，请用下方「智能识别」跑 mock，或手动输入', icon: 'none', duration: 3000 })
      ocrNote.value = `已选图（${fp}）。注：浏览器端跨域文件读取受限；用「智能识别」跑 mock 数据演示。`
    },
  })
}
async function onMockExtract() {
  uni.showLoading({ title: '识别中…' })
  try {
    const r = await extractFromImages(['data:image/png;base64,iVBORw0KGgo='])
    uni.hideLoading()
    if (r.ok && r.positions && r.positions.length) {
      const lines = r.positions.map((p) => `${p.code} ${p.cost} ${p.qty}`).join('\n')
      importText.value = lines
      ocrNote.value = r.mock ? `（mock 数据：${r.note || 'LLM 未配置'}）— 点击下方"导入到持仓列表"入库` : `识别成功 ${r.positions.length} 条 — 点击下方"导入到持仓列表"入库`
    } else { ocrNote.value = r.error || '识别失败' }
  } catch (e: any) { uni.hideLoading(); ocrNote.value = e?.message || '识别失败' }
}
async function onImport() {
  const list = parseHoldingsText(importText.value)
  if (list.length === 0) { uni.showToast({ title: '没解析到有效持仓（每行：代码 成本 数量）', icon: 'none' }); return }
  uni.showLoading({ title: '导入中…' })
  let ok = 0
  for (const p of list) {
    try { await upsertHolding({ stock_code: p.code, short_name: '', shares: p.qty, cost_basis: p.cost }); ok++ } catch (e) { console.warn('[import] upsert failed', p, e) }
  }
  uni.hideLoading()
  uni.showToast({ title: `导入 ${ok}/${list.length} 条`, icon: 'success' })
  importText.value = ''
  await loadHoldings()
  await loadLedger()
}

// ── ③ 拟新买标的 ──
const proposedOpen = ref(true)
const proposedTargets = ref<{ code: string; name: string; price: number | null }[]>([])

function onCapitalInput(e: any) {
  const v = Number(e?.detail?.value)
  totalCapital.value = Number.isNaN(v) ? null : v
}
function onFeeInput(e: any) {
  const v = Number(e?.detail?.value)
  feeWan.value = Number.isNaN(v) ? null : v
}

// ── ④ 运行分析 ──
const totalCapital = ref<number | null>(null)
const feeWan = ref<number | null>(null)
const feeWarning = computed(() => {
  const f = feeWan.value ?? ledgerSnapshot.value.fee_rate_wan
  if (!f || f <= 0) return '请输入佣金费率'
  if (f < 0.1 || f > 10) return '费率需在万分之 0.1 ~ 10 之间'
  if (f < 0.5) return '您输入的费率偏低（万分之 0.5 以下），请核对'
  if (f > 3) return '您输入的费率偏高（万分之 3 以上），请核对'
  return ''
})
const feeWarningClass = computed(() => {
  const f = feeWan.value ?? ledgerSnapshot.value.fee_rate_wan
  if (!f || f <= 0 || f < 0.1 || f > 10) return 'pf-fee-warn--hard'
  if (f < 0.5 || f > 3) return 'pf-fee-warn--warn'
  return ''
})
const analyzeLoading = ref(false)
const analyzeStatus = ref('请先确认账户再开始分析')
const analyzeReport = ref<AnalyzeReport | null>(null)
const priceConfirmedCodes = ref<string[]>([])

async function onRunAnalyze() {
  if (!ledgerSnapshot.value.configured) {
    uni.showToast({ title: '请先在上方确认账户初始保证金与手续费率', icon: 'none' })
    ledgerOpen.value = true
    return
  }
  if (!totalCapital.value || totalCapital.value <= 0) { uni.showToast({ title: '请输入总资金', icon: 'none' }); return }

  const stocks = [
    ...holdings.value.map((h) => ({ code: h.stock_code, name: h.short_name, price: h.cost_basis, capital: 0 })),
    ...proposedTargets.value.filter((p) => /^\d{6}$/.test(padCode(p.code))).map((p) => ({ code: padCode(p.code), name: p.name, price: p.price || 0, capital: 0 })),
  ]
  const existing = holdings.value.map((h) => ({ code: h.stock_code, name: h.short_name, cost: h.cost_basis, qty: h.shares, cur: h.cost_basis }))

  analyzeLoading.value = true
  analyzeStatus.value = '正在计算…'
  try {
    const r = await analyzePortfolio({
      total_capital: totalCapital.value ?? 0,
      fee_wan: feeWan.value ?? ledgerSnapshot.value.fee_rate_wan ?? 0,
      stocks,
      existing,
      fee_confirmed: true,
      price_confirmed_codes: priceConfirmedCodes.value,
    })
    if (r.fee_confirm) {
      uni.showModal({
        title: '费率确认', content: r.fee_msg || '', success: async (m) => {
          if (m.confirm) {
            const r2 = await analyzePortfolio({ total_capital: totalCapital.value ?? 0, fee_wan: feeWan.value ?? 0, stocks, existing, fee_confirmed: true, price_confirmed_codes: priceConfirmedCodes.value })
            analyzeReport.value = r2
            analyzeStatus.value = r2.ok ? '分析完成' : (r2.error || '分析失败')
            await loadPlans()
          }
        },
      })
    } else {
      analyzeReport.value = r
      analyzeStatus.value = r.ok ? '分析完成' : (r.error || '分析失败')
      if (r.ok) await loadPlans()
    }
  } catch (e: any) {
    analyzeStatus.value = e?.message || '分析失败'
    uni.showToast({ title: e?.message || '分析失败', icon: 'none' })
  } finally {
    analyzeLoading.value = false
  }
}

function onConfirmPrice(code: string) {
  if (!priceConfirmedCodes.value.includes(code)) priceConfirmedCodes.value.push(code)
  onRunAnalyze()
}

// ── ⑦ 持仓方案跟踪 ──
const trackOpen = ref(true)
const planItems = ref<PlanItem[]>([])
const trackSelected = ref('')
const trackCurPrice = ref<number | null>(null)
const trackSteps = ref<any[]>([])

async function loadPlans() {
  try {
    const r = await listPlans()
    planItems.value = r.items || []
    if (planItems.value.length && !trackSelected.value) onTrackSelect(planItems.value[0].stock_code)
  } catch (e) { console.warn('[plans] load failed', e) }
}
function onTrackSelect(code: string) {
  trackSelected.value = code
  trackCurPrice.value = null
  trackSteps.value = []
  const it = planItems.value.find((p) => p.stock_code === code)
  if (it) buildSteps(it)
}
function buildSteps(it: PlanItem): any[] {
  const rows = it.plan_json?.rows || []
  const tp = it.plan_json?.tp_rows || []
  const steps: any[] = []
  let cumShares = 0
  // 1) 开/加仓（每笔后紧跟“对全部已持仓”级联动态止损）
  rows.forEach((r, i) => {
    const isOpen = i === 0
    cumShares += r.shares
    steps.push({
      kind: isOpen ? 'open' : 'add',
      kindLabel: isOpen ? '首笔建仓' : `加仓·第${i}笔`,
      price: r.price,
      shares: r.shares,
      amount: r.amount || 0,
      info: `触发价 ${fmtMoney(r.price, 2)} · ${r.shares}股 · 投入 ${fmtMoney(r.amount || 0)}`,
      done: false,
      armed: false,
    })
    steps.push({
      kind: 'stop',
      kindLabel: i === 0 ? '动态止损（首笔）' : `动态止损（全部${cumShares}股）`,
      price: r.stop,
      shares: cumShares,
      amount: 0,
      info: `对全部 ${cumShares} 股设止损价 ${fmtMoney(r.stop, 2)}（本档全仓止损价）`,
      done: false,
      armed: false,
    })
  })
  // 2) 分批止盈（每档后紧跟“对剩余持仓”级联动态止损；最后一档为全平，不再跟止损）
  tp.forEach((t, i) => {
    steps.push({
      kind: 'tp',
      kindLabel: `止盈·第${i + 1}笔`,
      price: t.price,
      shares: t.cut_shares,
      amount: 0,
      info: `触发价 ${fmtMoney(t.price, 2)} · 减仓 ${t.cut_shares}股 · 剩余 ${t.remain_shares}股`,
      done: false,
      armed: false,
    })
    const isLast = i === tp.length - 1
    if (!isLast) {
      const stopPrice = t.dynamic_stop != null ? t.dynamic_stop : (rows[rows.length - 1]?.stop ?? 0)
      steps.push({
        kind: 'stop',
        kindLabel: `动态止损（剩${t.remain_shares}股）`,
        price: stopPrice,
        shares: t.remain_shares,
        amount: 0,
        info: `对剩余 ${t.remain_shares} 股设止损价 ${fmtMoney(stopPrice, 2)}`,
        done: false,
        armed: false,
      })
    }
  })
  return steps
}
function onTrackEval() {
  const it = planItems.value.find((p) => p.stock_code === trackSelected.value)
  if (!it) return
  const cur = Number(trackCurPrice.value)
  if (!cur) { trackSteps.value = buildSteps(it); return }
  const steps = buildSteps(it)
  steps.forEach((s) => {
    if (s.kind === 'stop') {
      if (s.price != null && cur <= s.price + 1e-9) s.done = true
    } else {
      if (cur >= s.price - 1e-9) s.done = true
    }
  })
  trackSteps.value = steps
}
function onTrackReset() {
  const it = planItems.value.find((p) => p.stock_code === trackSelected.value)
  if (it) { trackSteps.value = buildSteps(it); trackCurPrice.value = null }
}
const selectedPlan = computed(() => planItems.value.find((p) => p.stock_code === trackSelected.value) || null)
function stepClass(step: any) {
  if (step.done) return 'pf-track-step--done'
  return ''
}

function actionClass(action?: string) {
  if (!action) return ''
  if (action.includes('平仓') || action.includes('减仓')) return 'pf-action--reduce'
  if (action.includes('加仓')) return 'pf-action--add'
  return 'pf-action--hold'
}

// ── Touch 下拉刷新 ──
const pullDistance = ref(0)
const pullProgress = ref(0)
const pullText = ref('')
const pullRefreshing = ref(false)
let touchStartY = 0
let isPulling = false
const PULL_THRESHOLD = 80
const PULL_MAX = 140

function refreshHint() {
  if (pullRefreshing.value) { pullText.value = '刷新中…'; return }
  if (pullDistance.value >= PULL_THRESHOLD) { pullText.value = '释放刷新'; return }
  if (pullDistance.value > 10) { pullText.value = '下拉刷新中…'; return }
  pullText.value = ''
}
function onTouchStart(e: any) {
  const scrollTop = (e?.target?.scrollTop ?? 0)
  // #ifdef H5 || APP-PLUS
  touchStartY = (e?.touches?.[0]?.clientY) || 0
  isPulling = scrollTop <= 0
  // #endif
}
function onTouchMove(e: any) {
  if (!isPulling) return
  const y = (e?.touches?.[0]?.clientY) || 0
  const dy = y - touchStartY
  if (dy > 10) {
    const dist = Math.min(PULL_MAX, dy * 0.55)
    pullDistance.value = dist
    pullProgress.value = Math.min(1, dist / PULL_THRESHOLD)
    refreshHint()
    if (e?.preventDefault) e.preventDefault()
  }
}
async function onTouchEnd() {
  if (!isPulling) return
  isPulling = false
  if (pullDistance.value >= PULL_THRESHOLD) {
    pullDistance.value = PULL_THRESHOLD
    pullRefreshing.value = true
    refreshHint()
    await refreshAll()
    pullRefreshing.value = false
  } else {
    pullDistance.value = 0
    pullProgress.value = 0
    refreshHint()
  }
  setTimeout(() => { if (pullDistance.value <= PULL_THRESHOLD) { pullDistance.value = 0; pullProgress.value = 0; refreshHint() } }, 600)
}
async function refreshAll() {
  await Promise.all([loadHoldings(), loadLedger(), loadPlans()])
  setTimeout(() => { pullDistance.value = 0; pullProgress.value = 0 }, 400)
}

onMounted(() => { refreshAll() })
onShow(() => { loadHoldings(); loadLedger(); loadPlans() })
onBeforeUnmount(() => {})
</script>

<style lang="scss" scoped>
$rf-cyan: #72f7ff;
$rf-amber: #ffb86b;
$rf-orange: #ff7a3d;
$rf-cream: #f5ecd9;
$rf-muted: #a89a82;
$rf-green: #6bffad;
$rf-red:   #ff4d4d;
$color-bg: #0d1b2a;
$color-card-bg: linear-gradient(180deg, rgba(255, 184, 107, 0.055), rgba(114, 247, 255, 0.025));
$color-border: rgba(255, 184, 107, 0.24);
$color-text-primary: $rf-cream;
$color-text-secondary: $rf-muted;
$color-text-warm: #d3c3ad;
$radius-lg: 20rpx;

.pf-page { min-height: 100vh; background: $color-bg; padding: 24rpx 24rpx 150rpx; overscroll-behavior-y: contain; }

/* H5：页面作为滚动容器，底部止于 tab 上沿 */
/* H5：页面作为包含 head(固定) + body(滚动) 的容器，止于 tab 上沿 */
.pf-page.h5-mode {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: calc(110rpx + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* head 区固定，不参与滚动 */
.pf-head {
  flex: 0 0 auto;
  padding: 16rpx 24rpx 8rpx;
  background: $color-bg;
}
/* body 区滚动，右侧美化金色滚动条只在此处 */
.pf-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 24rpx 24rpx;
}
.pf-body::-webkit-scrollbar { width: 5rpx; }
.pf-body::-webkit-scrollbar-track { background: transparent; }
.pf-body::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #fff4c0 0%, #f4c542 50%, #d89c1c 100%);
  border-radius: 6rpx;
}
.pf-body { scrollbar-width: thin; scrollbar-color: #d89c1c transparent; }
.pf-head { padding: 16rpx 0 8rpx; margin-bottom: 12rpx; }
.pf-title { display: block; font-size: 44rpx; font-weight: 700; color: $color-text-primary; letter-spacing: 1rpx; }
.pf-hint { display: block; margin-top: 8rpx; font-size: 22rpx; color: $color-text-secondary; letter-spacing: 1rpx; }

.pf-pull-indicator { position: relative; display: flex; align-items: center; justify-content: center; background: rgba(255, 184, 107, 0.08); border-bottom: 1rpx solid $color-border; transition: height 0.15s ease, opacity 0.15s ease; overflow: hidden; }
.pf-pull-text { font-size: 24rpx; color: $rf-amber; font-weight: 600; }

.pf-card { background: $color-card-bg; border: 1rpx solid $color-border; border-radius: $radius-lg; padding: 20rpx 24rpx; margin-bottom: 20rpx; }
.pf-section-title { display: block; font-size: 30rpx; color: $rf-amber; font-weight: 600; margin-bottom: 16rpx; }
.pf-sub-section-title { display: block; font-size: 26rpx; color: $rf-amber; font-weight: 600; margin: 16rpx 0 12rpx; }
.pf-empty { text-align: center; color: $color-text-secondary; font-size: 24rpx; padding: 20rpx 0; }
.pf-label { display: block; font-size: 22rpx; color: $color-text-secondary; margin-bottom: 8rpx; }
.pf-row { display: flex; gap: 16rpx; }
.pf-col { flex: 1; display: flex; flex-direction: column; }
.pf-input { width: 100%; height: 72rpx; min-height: 72rpx; padding: 0 20rpx; font-size: 28rpx; line-height: 72rpx; background: rgba(12, 10, 12, 0.6); color: $color-text-primary; border: 1rpx solid rgba(255, 184, 107, 0.3); border-radius: 12rpx; box-sizing: border-box; }
.pf-input--xs { width: 140rpx; height: 72rpx; min-height: 72rpx; padding: 0 16rpx; line-height: 72rpx; }
.pf-input--sm { flex: 0 0 200rpx; height: 72rpx; min-height: 72rpx; padding: 0 16rpx; line-height: 72rpx; }
.pf-input--md { flex: 1; height: 72rpx; min-height: 72rpx; padding: 0 16rpx; line-height: 72rpx; }

.pf-fee-warn { margin-top: 12rpx; padding: 12rpx 16rpx; font-size: 22rpx; border-radius: 10rpx; border: 1rpx solid; color: $rf-amber; background: rgba(255, 184, 107, 0.08); border-color: rgba(255, 184, 107, 0.3); }
.pf-fee-warn--warn { color: $rf-amber; }
.pf-fee-warn--hard { color: $rf-red; background: rgba(255, 77, 77, 0.08); border-color: rgba(255, 77, 77, 0.3); }

.pf-import-head { display: flex; justify-content: space-between; align-items: center; }
.pf-toggle { font-size: 24rpx; color: $rf-cyan; }
.pf-import-body { margin-top: 16rpx; }
.pf-import-actions { display: flex; gap: 12rpx; margin-bottom: 12rpx; }
.pf-import-actions .pf-btn { flex: 1; }
.pf-textarea { width: 100%; padding: 16rpx; font-size: 24rpx; background: rgba(12, 10, 12, 0.7); color: $color-text-primary; border: 1rpx solid rgba(255, 184, 107, 0.2); border-radius: 12rpx; margin-bottom: 12rpx; min-height: 100rpx; box-sizing: border-box; }
.pf-note { margin-top: 12rpx; font-size: 22rpx; color: $color-text-secondary; line-height: 1.5; }
.pf-note--warn { color: $rf-amber; }
.pf-note--ok { color: $rf-green; }
.pf-note--muted { color: $rf-muted; font-size: 21rpx; margin-bottom: 16rpx; }

.pf-btn { display: inline-flex; align-items: center; justify-content: center; padding: 16rpx 28rpx; font-size: 26rpx; border-radius: 14rpx; border: 1rpx solid transparent; transition: transform 0.15s ease, opacity 0.15s ease; box-sizing: border-box; max-width: 100%; }
.pf-btn--xs { padding: 10rpx 20rpx; font-size: 24rpx; }
.pf-btn--secondary { background: rgba(255, 184, 107, 0.05); border-color: rgba(255, 184, 107, 0.3); color: $color-text-primary; }
.pf-btn--primary { background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%); color: $color-bg; font-weight: 600; border-color: $rf-amber; }
.pf-btn--block { display: flex; width: 100%; margin-top: 16rpx; }
.pf-btn--loading { opacity: 0.7; }
.pf-btn--hover { opacity: 0.85; transform: scale(0.98); }

/* ① 账本 */
.pf-ledger-state { margin-top: 12rpx; }
.pf-ledger-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10rpx; }
.pf-ledger-cell { display: flex; flex-direction: column; padding: 10rpx 12rpx; background: rgba(255, 184, 107, 0.03); border: 1rpx solid rgba(255, 184, 107, 0.1); border-radius: 10rpx; }
.pf-ledger-k { font-size: 20rpx; color: $color-text-secondary; margin-bottom: 4rpx; }
.pf-ledger-v { font-size: 26rpx; font-weight: 600; color: $color-text-primary; font-variant-numeric: tabular-nums; }
.pf-ledger-v--cyan { color: $rf-cyan; }
.pf-up { color: $rf-green !important; }
.pf-down { color: $rf-red !important; }
.pf-ledger-meta { margin-top: 12rpx; font-size: 22rpx; color: $color-text-secondary; line-height: 1.5; }
.pf-ledger-actions { display: flex; gap: 10rpx; flex-wrap: nowrap; margin-top: 12rpx; }
.pf-ledger-actions .pf-btn { flex: 1; min-width: 0; }

/* ② 手动输入行 */
.pf-manual-row { display: flex; gap: 8rpx; align-items: center; margin-top: 12rpx; flex-wrap: wrap; }

/* ② 持仓行 */
.pf-hold-list { margin-top: 16rpx; display: flex; flex-direction: column; gap: 8rpx; }
.pf-hold-row { display: grid; grid-template-columns: 1fr 160rpx 140rpx 60rpx; align-items: center; gap: 8rpx; padding: 8rpx 10rpx; background: rgba(255, 184, 107, 0.03); border: 1rpx solid rgba(255, 184, 107, 0.1); border-radius: 10rpx; }
.pf-hold-name { font-size: 22rpx; color: $color-text-primary; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-hold-input { width: 100%; padding: 8rpx 10rpx; font-size: 22rpx; background: rgba(12, 10, 12, 0.6); color: $color-text-primary; border: 1rpx solid rgba(255, 184, 107, 0.2); border-radius: 8rpx; }
.pf-hold-del { text-align: center; font-size: 28rpx; color: $rf-red; }

/* ③ 拟买 */
.pf-proposed-labels { display: flex; gap: 8rpx; align-items: center; margin-bottom: 8rpx; padding: 0 4rpx; font-size: 22rpx; color: $color-text-secondary; }
.pf-proposed-added { display: flex; flex-direction: column; gap: 8rpx; margin-bottom: 12rpx; }
.pf-proposed-row { display: flex; gap: 8rpx; align-items: center; }
.pf-proposed-actions { display: flex; gap: 12rpx; margin-top: 12rpx; }
.pf-proposed-actions .pf-btn { flex: 1; }
.pf-run-btn { flex: 1; }

/* 研报 tabs */
.pf-tabbar { display: flex; gap: 8rpx; margin-bottom: 16rpx; }
.pf-tab { flex: 1; text-align: center; padding: 14rpx 8rpx; font-size: 24rpx; color: $color-text-secondary; background: rgba(255, 184, 107, 0.05); border: 1rpx solid rgba(255, 184, 107, 0.2); border-radius: 12rpx; box-sizing: border-box; }
.pf-tab--active { color: $color-bg; background: linear-gradient(135deg, $rf-amber 0%, $rf-orange 100%); font-weight: 600; border-color: $rf-amber; }
.pf-research-tab { margin-top: 4rpx; }

/* 已持仓研报勾选 */
.pf-held-list { display: flex; flex-direction: column; gap: 10rpx; margin: 12rpx 0; }
.pf-held-row { display: flex; justify-content: space-between; align-items: center; gap: 12rpx; padding: 14rpx 18rpx; background: rgba(255, 184, 107, 0.03); border: 1rpx solid rgba(255, 184, 107, 0.1); border-radius: 12rpx; }
.pf-held-info { display: flex; flex-direction: column; min-width: 0; }
.pf-held-name { font-size: 26rpx; color: $color-text-primary; font-weight: 600; }
.pf-held-code { font-size: 21rpx; color: $color-text-secondary; margin-top: 2rpx; }
.pf-held-gen { flex: 0 0 200rpx; }
.pf-report-box--sub { margin-top: 16rpx; border-top: 1rpx dashed rgba(255, 184, 107, 0.2); }

/* ④ 运行 */
.pf-run-status { margin-top: 12rpx; font-size: 22rpx; color: $color-text-secondary; text-align: center; }

/* confirums */
.pf-confirms { margin-bottom: 12rpx; }
.pf-confirm { padding: 12rpx 14rpx; font-size: 22rpx; color: $rf-amber; background: rgba(255, 184, 107, 0.08); border: 1rpx solid rgba(255, 184, 107, 0.3); border-radius: 10rpx; margin-bottom: 8rpx; line-height: 1.5; }

/* 策略方案 */
.pf-notice-list { margin-bottom: 12rpx; }
.pf-notice { padding: 10rpx 14rpx; font-size: 24rpx; color: $color-text-warm; background: rgba(114, 247, 255, 0.05); border-left: 4rpx solid $rf-cyan; border-radius: 0 8rpx 8rpx 0; margin-bottom: 6rpx; line-height: 1.5; }
.pf-existing-row { margin-bottom: 12rpx; }
.pf-existing-global { padding: 12rpx 14rpx; font-size: 24rpx; color: $rf-amber; background: rgba(255, 184, 107, 0.08); border: 1rpx solid rgba(255, 184, 107, 0.3); border-radius: 10rpx; margin-bottom: 10rpx; line-height: 1.5; }
.pf-existing-invalid { padding: 10rpx 14rpx; font-size: 24rpx; color: $rf-red; background: rgba(255, 77, 77, 0.05); border: 1rpx solid rgba(255, 77, 77, 0.3); border-radius: 8rpx; margin-bottom: 6rpx; }
.pf-existing-item { padding: 10rpx 14rpx; background: rgba(255, 184, 107, 0.03); border: 1rpx solid rgba(255, 184, 107, 0.1); border-radius: 10rpx; margin-bottom: 8rpx; }
.pf-existing-code { display: block; font-size: 26rpx; font-weight: 600; color: $color-text-primary; margin-bottom: 4rpx; }
.pf-existing-action { display: block; font-size: 24rpx; color: $color-text-warm; margin-bottom: 8rpx; line-height: 1.5; }
.pf-action--add { color: $rf-green; }
.pf-action--reduce { color: $rf-red; }
.pf-action--hold { color: $rf-amber; }

/* 新标的方案 */
.pf-stock { padding: 12rpx 14rpx; background: rgba(114, 247, 255, 0.03); border: 1rpx solid rgba(114, 247, 255, 0.15); border-radius: 10rpx; margin-bottom: 10rpx; }
.pf-stock-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6rpx; }
.pf-stock-code { font-size: 26rpx; font-weight: 600; color: $color-text-primary; }
.pf-stock-budget { font-size: 20rpx; color: $color-text-secondary; font-variant-numeric: tabular-nums; }
.pf-stock-err { font-size: 24rpx; color: $rf-amber; padding: 8rpx 0; line-height: 1.5; }

/* ⑦ 跟踪 */
.pf-track-item { padding: 12rpx 14rpx; background: rgba(255, 184, 107, 0.03); border: 1rpx solid rgba(255, 184, 107, 0.1); border-radius: 10rpx; margin-bottom: 8rpx; }
.pf-track-item.active { border-color: rgba(255, 184, 107, 0.5); background: rgba(255, 184, 107, 0.1); }
.pf-track-item-head { display: flex; justify-content: space-between; align-items: center; }
.pf-track-code { font-size: 26rpx; font-weight: 600; color: $color-text-primary; }
.pf-track-invest { font-size: 22rpx; color: $rf-amber; font-variant-numeric: tabular-nums; }
.pf-track-detail { margin-top: 12rpx; padding-top: 12rpx; border-top: 1rpx dashed rgba(255, 184, 107, 0.2); }
.pf-track-detail-head { display: flex; justify-content: space-between; font-size: 22rpx; color: $color-text-secondary; margin-bottom: 10rpx; }
.pf-track-cur-row { align-items: center; margin-bottom: 10rpx; }
.pf-track-steps { display: flex; flex-direction: column; gap: 6rpx; }
.pf-track-step { display: grid; grid-template-columns: 160rpx 1fr 160rpx; align-items: center; gap: 8rpx; padding: 10rpx 12rpx; background: rgba(12, 10, 12, 0.4); border: 1rpx solid rgba(255, 184, 107, 0.12); border-radius: 8rpx; }
.pf-track-step--done { border-color: rgba(107, 255, 173, 0.4); background: rgba(107, 255, 173, 0.06); }
.pf-track-step-name { font-size: 22rpx; color: $rf-cyan; font-weight: 600; }
.pf-track-step-info { font-size: 20rpx; color: $color-text-primary; }
.pf-track-step-state { font-size: 20rpx; color: $rf-muted; text-align: right; }
.pf-track-step--done .pf-track-step-state { color: $rf-green; }
.pf-track-hint { margin-top: 10rpx; font-size: 20rpx; color: $rf-muted; line-height: 1.5; }

/* PlanTable 组件样式（子组件 scope 透传） */
:deep(.pf-plan-table) {
  display: block; margin-top: 8rpx; background: rgba(12, 10, 12, 0.5); border-radius: 8rpx; overflow: hidden;
}
:deep(.pf-plan-grid) { display: grid; grid-template-columns: 1.2fr 1.4fr 1.4fr 1.2fr 1.6fr 0.8fr; gap: 1rpx; background: rgba(255, 184, 107, 0.1); }
:deep(.pf-plan-cell) { padding: 8rpx 8rpx; font-size: 20rpx; color: $color-text-primary; text-align: center; background: rgba(12, 10, 12, 0.3); font-variant-numeric: tabular-nums; }
:deep(.pf-plan-cell--th) { background: rgba(255, 184, 107, 0.14); color: $rf-amber; font-weight: 600; font-size: 19rpx; }
:deep(.pf-tp-title) { display: block; font-size: 22rpx; color: $rf-amber; margin: 12rpx 0 6rpx; }
:deep(.pf-tp-grid) { display: grid; grid-template-columns: 1fr 1.4fr 1.4fr 1.4fr 1.4fr; gap: 1rpx; background: rgba(114, 247, 255, 0.1); }
:deep(.pf-tp-cell) { padding: 8rpx 8rpx; font-size: 20rpx; color: $color-text-primary; text-align: center; background: rgba(12, 10, 12, 0.3); font-variant-numeric: tabular-nums; }
:deep(.pf-tp-cell--th) { background: rgba(114, 247, 255, 0.12); color: $rf-cyan; font-weight: 600; font-size: 19rpx; }
:deep(.pf-tp-summary) { display: flex; justify-content: space-between; font-size: 20rpx; color: $color-text-warm; margin-top: 8rpx; padding: 0 4rpx; }

/* 研报 */
.pf-research-inputs { gap: 16rpx; margin-bottom: 16rpx; }
.pf-report-box { margin-top: 20rpx; padding-top: 20rpx; border-top: 1rpx solid $color-border; }
.pf-report-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12rpx; }
.pf-report-title { font-size: 28rpx; font-weight: 700; color: $rf-cream; }
.pf-report-rating { font-size: 24rpx; color: $rf-amber; font-weight: 600; }
.pf-report-overall { display: block; font-size: 24rpx; color: $rf-green; line-height: 1.5; margin-bottom: 16rpx; }
.pf-module { padding: 16rpx 0; border-bottom: 1rpx dashed rgba(255, 184, 107, 0.14); }
.pf-module-head { display: flex; align-items: center; gap: 10rpx; margin-bottom: 8rpx; }
.pf-module-no { display: inline-flex; align-items: center; justify-content: center; width: 34rpx; height: 34rpx; border-radius: 50%; background: rgba(114, 247, 255, 0.14); color: $rf-cyan; font-size: 22rpx; font-weight: 700; }
.pf-module-title { font-size: 26rpx; font-weight: 600; color: $rf-cream; }
.pf-module-verdict { font-size: 22rpx; color: $rf-amber; }
.pf-module-summary { display: block; font-size: 23rpx; color: $rf-cream; line-height: 1.5; margin-bottom: 8rpx; }
.pf-module-points { display: flex; flex-direction: column; gap: 4rpx; }
.pf-module-point { display: flex; font-size: 22rpx; color: $rf-muted; line-height: 1.45; }
.pf-dot { margin-right: 8rpx; color: $rf-cyan; }
.pf-report-disclaimer { display: block; margin-top: 20rpx; font-size: 20rpx; color: $rf-muted; line-height: 1.5; }

.pf-disclaimer { margin-top: 32rpx; padding: 20rpx; text-align: center; font-size: 22rpx; color: $color-text-secondary; line-height: 1.6; }

/* 响应式 */
@media (max-width: 390px) {
  .pf-ledger-grid { grid-template-columns: 1fr 1fr; }
  .pf-hold-row { grid-template-columns: 1fr 120rpx 100rpx 50rpx; }
}
@media (min-width: 761px) {
  .pf-page { max-width: 1080rpx; margin: 0 auto; padding: 32rpx 32rpx 64rpx; }
  .pf-ledger-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (min-width: 981px) {
  .pf-page { max-width: 1200rpx; }
}
@media (orientation: landscape) and (max-height: 500px) {
  .pf-page { padding: 16rpx 24rpx 32rpx; }
  .pf-title { font-size: 36rpx; }
}
</style>
