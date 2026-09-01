// middleware.js — 跨路由复用的 Express 中间件（CORS / JSON 解析错误 / 鉴权 / 限速锁）
// 从原 index.js 抽出，降低单文件复杂度，路由层只关心业务。
import express from 'express';

// CORS：只允许显式白名单。默认开发期 localhost + file://；生产必须用 ALLOWED_ORIGINS 指定，禁止反射任意 Origin
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const DEV_CORS = process.env.DEV_CORS === '1' || ALLOWED_ORIGINS.length === 0;
const DEV_ORIGINS = ['http://localhost:5173', 'https://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'null'];
const ALLOWED_ORIGIN_SET = new Set([...ALLOWED_ORIGINS, ...(DEV_CORS ? DEV_ORIGINS : [])]);

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

  // 统一 JSON 解析错误处理：畸形 body 返回 400 JSON，而非 Express 默认 HTML 错误页
  app.use((err, _req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'invalid_json' });
    }
    next(err);
  });
}

// API 鉴权中间件：配置 API_KEY 后，所有写操作必须带 x-api-key（或 Authorization: Bearer）
const API_KEY = process.env.API_KEY || '';
if (!API_KEY && process.env.NODE_ENV === 'production') {
  console.warn('[server][security] 生产环境未设置 API_KEY，所有写接口匿名开放，存在越权风险！');
}
export function requireAuth(req, res, next) {
  if (!API_KEY) return next();
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
