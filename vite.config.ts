import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

// https://vitejs.dev/config/
// 注意：uni-app 项目里 root 是 src/，所有 .vue/.ts 默认相对于 src/。
// .env 走 Vite 默认加载，但只有 VITE_ 前缀会进 import.meta.env。
// 我们把 TURSO_/API_ 也加到前缀，这样 import.meta.env.TURSO_DATABASE_URL 就能拿到。
export default defineConfig({
  plugins: [uni()],
  envPrefix: ["VITE_", "TURSO_", "API_"],
});
