// 验证 H5 dev server 是否成功编译 portfolio 页面（含新 PlanTable 组件）
const urls = [
  'http://localhost:5173/src/pages/portfolio/index.vue',
  'http://localhost:5173/src/pages/portfolio/PlanTable.vue',
  'http://localhost:5173/src/api/portfolio.ts',
];
for (const u of urls) {
  try {
    const r = await fetch(u);
    const t = await r.text();
    const hasError = /Internal Server Error|Transform failed|SyntaxError|Pre-transform error/i.test(t);
    console.log(`[${r.status}] ${u}  bytes=${t.length}  error=${hasError}`);
    if (hasError) console.log(t.slice(0, 400));
  } catch (e) {
    console.log(`ERR ${u}: ${e.message}`);
  }
}
console.log('DONE');
