import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

// https://vitejs.dev/config/
// uni-app 项目里 root 是 src/，所有 .vue/.ts 默认相对于 src/。
//
// dev 阶段：前端走 vite proxy 调后端 (同源，避免 H5 端 uni.request 跨域 edge case)。
// 生产阶段：uni-app 编译时会把相对路径保留，由各端运行时直接访问。
export default defineConfig({
  plugins: [uni()],
  envPrefix: ["VITE_", "TURSO_", "API_"],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:9999",
        changeOrigin: true,
      },
    },
  },
});
