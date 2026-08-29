// tab-active.ts — H5 自定义 tabBar 的全局共享高亮状态
//
// 背景：H5 端每个页面各挂一个 TabBarComp 实例，实例间互不感知；
// 切页后新实例靠 getCurrentPages() 兜底，但 route 可能带前导斜杠或
// 栈未就绪导致 indexOf 失败、高亮回落到第 0 个 tab。
// 这里用模块级单例 ref，让所有实例共享同一份高亮状态，谁变更都全量生效。

import { ref } from 'vue'

// 与 src/custom-tab-bar/index.vue 的 list 保持一致
export const TAB_ROUTES = [
  'pages/news/index',
  'pages/research/index',
  'pages/portfolio/index',
  'pages/market/index',
] as const

/** 全局当前 tab 下标（-1 = 未知，显示不高亮） */
export const tabActive = ref(0)

/** 按当前页面栈同步高亮（route 归一化，去掉前导斜杠） */
export function syncTabActiveFromRoute() {
  try {
    const ps: any[] = (getCurrentPages() as any[]) || []
    const raw = String(ps[ps.length - 1]?.route || '')
    const route = raw.replace(/^\/+/, '')
    const idx = (TAB_ROUTES as readonly string[]).indexOf(route)
    if (idx >= 0) tabActive.value = idx
  } catch {
    /* ignore */
  }
}
