<template>
  <view class="tabbar">
    <view class="tabbar__hairline" />
    <view
      v-for="(item, i) in list"
      :key="item.pagePath"
      class="tabbar__item"
      :class="{ 'is-active': current === i }"
      @tap="onTap(i)"
    >
      <view class="tabbar__glow" />
      <view class="tabbar__indicator" />
      <view class="tabbar__icon" v-html="item.icon" />
      <text class="tabbar__label">{{ item.text }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'

const list = [
  {
    pagePath: 'pages/news/index',
    text: '新闻',
    icon: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>',
  },
  {
    pagePath: 'pages/research/index',
    text: '研报',
    icon: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V9M16 16v-7"/></svg>',
  },
  {
    pagePath: 'pages/portfolio/index',
    text: '持仓',
    icon: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9h9A9 9 0 1 0 3 12c0 5 4 9 9 9z"/><path d="M12 3a9 9 0 0 1 9 9h-9z"/></svg>',
  },
]

const routes = list.map((l) => l.pagePath)
const current = ref(0)

function sync() {
  try {
    const ps: any[] = (getCurrentPages() as any[]) || []
    const route = ps[ps.length - 1]?.route
    const idx = routes.indexOf(route)
    if (idx >= 0) current.value = idx
  } catch (e) {
    /* ignore */
  }
}

function onTap(i: number) {
  if (i === current.value) return
  uni.switchTab({ url: '/' + routes[i] })
}

onMounted(sync)
onShow(sync)
</script>

<style lang="scss" scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  display: flex;
  align-items: stretch;
  height: 110rpx;
  padding-bottom: env(safe-area-inset-bottom);
  background: linear-gradient(180deg, rgba(13, 27, 42, 0.90), rgba(9, 18, 31, 0.98));
  backdrop-filter: blur(20rpx);
  -webkit-backdrop-filter: blur(20rpx);
  box-shadow: 0 -10rpx 34rpx rgba(0, 0, 0, 0.45);
}

/* 底部 tab 上沿泛出的金色光芒（取代细金线） */
.tabbar__hairline {
  position: absolute;
  top: -2rpx;
  left: 0;
  right: 0;
  height: 30rpx;
  background: linear-gradient(180deg,
    rgba(244, 197, 66, 0.55) 0%,
    rgba(244, 197, 66, 0.20) 40%,
    rgba(244, 197, 66, 0.0) 100%);
  filter: blur(6rpx);
  pointer-events: none;
}

.tabbar__item {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  color: #8b95a3;
  transition: color 0.18s ease;
}

.tabbar__icon {
  width: 38rpx;
  height: 38rpx;
  line-height: 38rpx;
  opacity: 0.72;
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.tabbar__label {
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  transition: color 0.18s ease;
}

/* 激活态：金色渐变字 + 图标高亮 + 上沿指示条 */
.tabbar__item.is-active {
  color: #f4c542;
}
.tabbar__item.is-active .tabbar__icon {
  opacity: 1;
  transform: translateY(-1rpx);
  filter: drop-shadow(0 0 6rpx rgba(244, 197, 66, 0.45));
}
.tabbar__item.is-active .tabbar__label {
  background: linear-gradient(180deg, #fff4c0 0%, #f4c542 55%, #d89c1c 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.tabbar__glow {
  position: absolute;
  top: -12rpx;
  left: 50%;
  transform: translateX(-50%);
  width: 120rpx;
  height: 24rpx;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(244, 197, 66, 0.5) 0%, rgba(244, 197, 66, 0.0) 70%);
  opacity: 0;
  transition: opacity 0.22s ease;
  pointer-events: none;
}

.tabbar__item.is-active .tabbar__glow {
  opacity: 1;
}

.tabbar__indicator {
  position: absolute;
  top: 10rpx;
  width: 40rpx;
  height: 4rpx;
  border-radius: 4rpx;
  background: linear-gradient(90deg, #fff4c0, #d89c1c);
  opacity: 0;
  transform: scaleX(0.4);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.tabbar__item.is-active .tabbar__indicator {
  opacity: 1;
  transform: scaleX(1);
}
</style>
