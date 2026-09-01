<template>
  <view class="hero">
    <view class="hero__main">
      <text class="hero__title">资金增仓比例</text>
      <text class="hero__sub">四类主力资金近 1 日加仓力度 · 每日刷新</text>
    </view>
    <view class="hero__search" @tap="onSearch" hover-class="hero__search--hover">
      <text class="hero__search-icon">🔍</text>
    </view>
  </view>
</template>

<script setup lang="ts">
function onSearch() {
  uni.showToast({ title: '资金搜索开发中', icon: 'none' })
}
</script>

<style lang="scss" scoped>
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rpx 4rpx 4rpx;
}
.hero__title {
  display: block;
  font-size: 44rpx;
  font-weight: 700;
  color: $app-text;
  letter-spacing: 1rpx;
}
// 紫色副标（普通紫，非权限紫 #7B61FF；PRD v1.2 仅移除合伙人权限紫）
.hero__sub {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #9d8bff;
  letter-spacing: 1rpx;
}
.hero__search {
  width: 64rpx;
  height: 64rpx;
  min-width: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: $app-card-bg;
  border: 1rpx solid $app-border;
  transition: transform 0.15s;
}
.hero__search--hover { transform: scale(0.94); }
.hero__search-icon { font-size: 32rpx; }
</style>
