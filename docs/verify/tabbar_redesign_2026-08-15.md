# 底部 TabBar 华尔街风重设计（2026-08-15）

## 背景
原 uni-app 原生 tabBar：白底 + 金色 selectedColor，且**原生不支持改字号**。用户要求：
1. 采用华尔街金融 APP 前沿设计风格
2. 底部 tab「新闻 / 研报 / 持仓」**字体大两号**

字号需求使原生 tabBar 无法满足 → 必须改为**自定义 tabBar**。

## 方案
- `src/pages.json`：`tabBar.custom: true`（WeChat 端自动挂载 `custom-tab-bar/index.vue`），背景改深色 `#0D1B2A`，保留 color/selectedColor 作为占位（不影响）。
- 新建 `src/custom-tab-bar/index.vue`：
  - 深蓝毛玻璃：`linear-gradient(180deg, rgba(13,27,42,.90), rgba(9,18,31,.98))` + `backdrop-filter: blur(20rpx)`
  - 顶部一抹金线（呼应品牌色）
  - 三个 tab 各配线性 SVG 图标：新闻=文档、研报=柱状图、持仓=饼图
  - 标签字号 **28rpx**（原生约 24rpx，大两号），`font-weight:600`，字间距 2rpx
  - 激活态：金色渐变字（`#fff4c0→#f4c542→#d89c1c`，background-clip:text）+ 图标高亮 + 顶部激活指示条（scaleX 动画）
  - 通过 `getCurrentPages()` 在 `onMounted/onShow` 同步当前激活页
- H5 兼容：uni-app H5 **不会**自动挂载 `custom-tab-bar/`（仅 WeChat 会），所以：
  - `src/App.vue` 全局 `scoped` 外样式 `.uni-tabbar{display:none!important}` 隐藏原生条
  - 在 `news/research/portfolio` 三个页 `<template>` 顶部插入 `<TabBarComp v-if="isH5" />`，`isH5 = ref(typeof window !== 'undefined')`（WeChat 端无 window，不重复挂载）
- 三页底部留白：news/portfolio 由 `48rpx` 增至 `150rpx`，research 已有 `120rpx`，避免内容被固定 bar 遮挡

## 验证
- `vue-tsc --noEmit` EXIT=0
- H5 渲染：DOM 实测 `.tabbar` 存在，3 个 `.tabbar__item` 各含 SVG 图标 + 28rpx/600 标签 + 激活指示条；点击「研报」正确切换 `is-active`（gold `#f4c542`），无 console 错误
- 颜色核实：激活 `rgb(244,197,66)`，未激活 `rgb(139,149,163)`（清晰可读灰，非透明）

## 提交
`c25206e` style(tabbar): 自定义华尔街风底部tabBar — 6 files, +171/-5

## 注意
- WeChat 端靠 `custom:true` 自动挂载，H5 端靠手动插入 + 隐藏原生条，两种环境均生效且不重复
- 品牌金取自 logo：`#FFF4C0 / #F4C542 / #D89C1C`
- 后续若要做微信小程序商店版，需真机验证 custom-tab-bar 自动挂载表现
