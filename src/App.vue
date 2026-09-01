<script setup lang="ts">
import { onLaunch, onShow, onHide } from "@dcloudio/uni-app";
onLaunch(() => {
  console.log("App Launch");
});
onShow(() => {
  console.log("App Show");
});
onHide(() => {
  console.log("App Hide");
});
</script>

<!-- 全局样式：H5 端手动隐藏原生 tabBar（custom-tab-bar 组件在 H5 不会自动挂载，需在页面内手动引入）；WeChat 端走 custom:true 自动挂载，原生 bar 非 webview DOM，不受此处影响 -->
<style>
.uni-tabbar {
  display: none !important;
}

/* 保留项：墨色基底 + 细衬线字体 + 极淡账本网格底纹（其余沿用原深蓝+金配色） */
page {
  background-color: #0b0b0d;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.032) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.032) 1px, transparent 1px);
  background-size: 48px 48px;
  font-family: "Noto Serif SC", "Songti SC", "SimSun", serif;
  font-weight: 400;
}
</style>
