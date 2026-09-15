// middleware.js — 跨路由复用的 Express 中间件（CORS / JSON 解析错误 / 鉴权 / 限速锁）
// 从原 index.js 抽出，降低单文件复杂度，路由层只关心业务。
import express from 'express';

// CORS：只允许显式白名单。默认开发期 localhost + file://；生产必须用 ALLOWED_ORIGINS 指定，禁止反射任意 Origin
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const DEV_CORS = process.env.DEV_CORS === '1' || ALLOWED_ORIGINS.length === 0;
const DEV_ORIGINS = ['http://localhost:5173', 'https://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'null'];
const ALLOWED_ORIGIN_SET = new Set([...ALLOWED_ORIGINS, ...(DEV_CORS ? DEV_ORIGINS : [])]);

// 全局限流（内存计数，无新增依赖）：防止匿名刷写接口 / 刷新接口打爆外部源。
// 可用 RATE_LIMIT_MAX=0 关闭；RATE_LIMIT_WINDOW_MS 调整窗口（默认 5 分钟）。
const RL_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_MS || 5 * 60_000);
const RL_MAX = Number(process.env.RATE_LIMIT_MAX ?? 1000);
const rlBuckets = new Map();
const rlSweeper = setInterval(() => {
  const cutoff = Date.now() - RL_WINDOW;
  for (const [ip, rec] of rlBuckets) if (rec.resetAt < cutoff) rlBuckets.delete(ip);
}, RL_WINDOW);
if (rlSweeper.unref) rlSweeper.unref(); // 不阻止进程退出

export function globalRateLimit(req, res, next) {
  if (!RL_MAX) return next();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let rec = rlBuckets.get(ip);
  if (!rec || rec.resetAt <= now) {
    rec = { count: 0, resetAt: now + RL_WINDOW };
    rlBuckets.set(ip, rec);
  }
  rec.count += 1;
  if (rec.count > RL_MAX) {
    res.setHeader('Retry-After', Math.ceil((rec.resetAt - now) / 1000));
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }
  return next();
}

export function registerCorsAndParse(app) {
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGIN_SET.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  // 全局限流（在 body 解析之后、业务路由之前）
  app.use(globalRateLimit);

  // 统一 JSON 解析错误处理：畸形 body 返回 400 JSON，而非 Express 默认 HTML 错误页
  app.use((err, _req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'invalid_json' });
    }
    next(err);
  });
}

// API 鉴权中间件：配置 API_KEY 后，所有写操作必须带 x-api-key（或 Authorization: Bearer）
// 安全基线：生产环境若未配置 API_KEY，写接口一律 401（fail-closed），不再匿名开放。
const API_KEY = process.env.API_KEY || '';
const IS_PROD = process.env.NODE_ENV === 'production';
if (!API_KEY) {
  if (IS_PROD) {
    console.error('[server][security] 生产环境未设置 API_KEY —— 所有写接口已拒绝（fail-closed）。请设置 API_KEY 后重启。');
  } else {
    console.warn('[server][security] 未设置 API_KEY，写接口匿名开放（仅限开发环境；生产必须设置）');
  }
}
export function requireAuth(req, res, next) {
  if (!API_KEY) {
    // 未配置密钥：生产拒绝（防越权），开发环境放行（保留本地调试便利）
    if (IS_PROD) {
      return res.status(401).json({ ok: false, error: 'api_key_not_configured' });
    }
    return next();
  }
  const key = req.headers['x-api-key'] || String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (key && key === API_KEY) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

// ifind 健康检查限速（避免 token 被高频轮询滥用）
let lastIfindCheck = 0;
export function ifindRateLimit() {
  const now = Date.now();
  if (now - lastIfindCheck < 60_000) return false;
  lastIfindCheck = now;
  return true;
}
