/**
 * 后端服务入口
 *
 * - Express HTTP API
 * - Turso / SQLite DB
 * - News Collector 后台轮询
 * - 同时托管：
 *   - /api/*           → JSON API
 *   - /preview/        → 多端响应式预览页 (port 9999)
 *   - /dev/h5/         → uni-app H5 开发产物代理（port 9000）
 *   - /static/         → 静态资源
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { initDb, getMode } from './db.js';
import { startCollector, fetchNews } from './news-collector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 9999);
const app = express();

app.use(cors());
app.use(express.json({ limit: '4mb' }));

// ---- API: health & meta ----
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'ashare-pyramid-server',
    db: getMode(),
    version: '0.1.0',
    uptime: process.uptime(),
  });
});

// ---- API: news (30s 自动刷新主接口) ----
app.get('/api/news', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const since = Number(req.query.since) || 0;
    const items = await fetchNews({ limit, since });
    res.json({
      ok: true,
      count: items.length,
      server_time: Date.now(),
      next_poll_ms: 30_000, // 前端 30 秒再来一次
      items,
    });
  } catch (e) {
    console.error('[api/news]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- API: 健康占位 ----
app.get('/api/research', (_req, res) => {
  res.json({ ok: true, items: [], note: 'AI 研报解读 — 待接入' });
});

app.post('/api/portfolio/analyze', (req, res) => {
  // TODO: 接 OCR + pyramid.ts 调用
  res.json({ ok: true, plan: null, note: '持仓分析 — 待接入' });
});

// ---- 静态资源：多端响应式预览 ----
const PREVIEW_DIR = path.join(__dirname, '..', '..', 'preview');
app.use('/preview', express.static(PREVIEW_DIR));
app.get('/', (_req, res) => res.redirect('/preview/'));

// ---- 静态资源：uni-app H5 dev 产物 ----
const H5_DIR = path.join(__dirname, '..', '..', 'dist', 'dev', 'mp-weixin');
app.use('/dev/h5', express.static(H5_DIR));

// ---- 启动 ----
async function main() {
  await initDb();
  startCollector();

  const server = createServer(app);
  server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] preview:  http://localhost:${PORT}/preview/`);
    console.log(`[server] health:   http://localhost:${PORT}/api/health`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => process.exit(0));
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});