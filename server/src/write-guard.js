// write-guard.js — DB 写路径韧性层（硬超时 + 退避重试 + 失败不丢）
//
// 背景：Node 直连海外 Turso（东京 aws-ap-northeast-1）时，链路抖动有两种表现：
//   1) 抛错（fetch failed / ECONNRESET）—— 上游 catch 一吞，整批采集数据静默丢弃；
//   2) 挂住不抛（空闲连接失效后重连卡 15~30s）—— 上层 await 永久悬停，定时任务再也不跑。
//
// 本模块把「一次写」包成：单次硬超时 → 短退避重试 → 仍失败则把原始 payload
// 追加到本地 spool（JSONL），下一轮 refreshAll 开头回放补写。写操作对同 id 幂等
// （news_items 是 ON CONFLICT DO UPDATE），所以重试/重放不会产生重复数据。
//
// 注意：spool 是「尽力而为」的本地兜底，不是消息队列；上限 SPOOL_MAX_LINES 行，
// 超限时丢弃最旧的记录并在日志中告警，避免磁盘无限增长。

import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SPOOL_DIR = path.resolve(HERE, '..', '.spool');

/** 快讯写路径 spool 文件（server/.spool/news-write-pending.jsonl，已 gitignore） */
export const NEWS_WRITE_SPOOL = path.join(SPOOL_DIR, 'news-write-pending.jsonl');

const SPOOL_MAX_LINES = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 给任意 Promise 加硬超时。超时后原 Promise 仍在后台跑（无法真正取消），
 * 但调用方立刻拿到错误，不会再被永久卡住。
 */
export function withTimeout(promise, ms, label = 'op') {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => timer && clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`${label}_timeout_${ms}ms`)), ms);
      if (timer.unref) timer.unref();
    }),
  ]);
}

/**
 * 带超时的重试。fn 每次调用都重新构造（便于重新发起请求，而非复用已失败的 Promise）。
 * @param {() => Promise<any>} fn
 * @param {{delays?: number[], timeoutMs?: number, label?: string, onError?: Function}} opts
 */
export async function retryWithTimeout(fn, { delays = [0, 800, 2000], timeoutMs = 8000, label = 'op', onError = null } = {}) {
  let lastErr = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    try {
      const out = await withTimeout(Promise.resolve().then(fn), timeoutMs, label);
      return { ok: true, value: out, attempts: i + 1 };
    } catch (e) {
      lastErr = e;
      if (onError) {
        try { onError(e, i); } catch {}
      }
    }
  }
  return { ok: false, value: null, attempts: delays.length, error: lastErr };
}

/**
 * 加固写入：重试 + 超时；全部失败时落 spool，保证「不丢」。
 * @param {(payload:any) => Promise<any>} fn 真正的 DB 写函数
 * @param {any} payload 传给 fn 的原始参数（也是 spool 里存的内容，必须可 JSON 序列化）
 */
export async function writeGuarded(fn, payload, {
  label = 'write',
  timeoutMs = 8000,
  delays = [0, 800, 2000],
  spoolFile = null,
  onFail = null,
} = {}) {
  const r = await retryWithTimeout(
    () => fn(payload),
    { delays, timeoutMs, label, onError: onFail ? (e, i) => onFail(e, i) : null },
  );
  if (r.ok) return { ok: true, attempts: r.attempts, value: r.value };

  let spooled = false;
  if (spoolFile) spooled = appendSpool(spoolFile, { ts: Date.now(), label, attempts: r.attempts, payload });
  return { ok: false, attempts: r.attempts, spooled, error: r.error?.message || String(r.error) };
}

/** 追加一行到 spool（同步写，避免进程退出丢数据）。返回是否写成功。 */
function appendSpool(spoolFile, entry) {
  try {
    fs.mkdirSync(path.dirname(spoolFile), { recursive: true });
    fs.appendFileSync(spoolFile, JSON.stringify(entry) + '\n');
    trimSpool(spoolFile);
    return true;
  } catch (e) {
    console.warn(`[spool] 写 spool 失败（本条无法兜底）: ${e?.message}`);
    return false;
  }
}

function trimSpool(spoolFile) {
  try {
    const lines = fs.readFileSync(spoolFile, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= SPOOL_MAX_LINES) return;
    const kept = lines.slice(lines.length - SPOOL_MAX_LINES);
    fs.writeFileSync(spoolFile, kept.join('\n') + '\n');
    console.warn(`[spool] 超过 ${SPOOL_MAX_LINES} 行上限，丢弃最旧的 ${lines.length - kept.length} 条`);
  } catch {}
}

/**
 * 回放 spool：逐条交给 handler（形如 (entry) => Promise），成功的删掉，失败的保留。
 * @param {(entry:any) => Promise<any>} handler
 */
export async function flushSpool(spoolFile, handler, { log = () => {}, max = 50, timeoutMs = 8000 } = {}) {
  let lines = [];
  try {
    if (!fs.existsSync(spoolFile)) return { flushed: 0, kept: 0 };
    lines = fs.readFileSync(spoolFile, 'utf8').split('\n').filter(Boolean);
  } catch {
    return { flushed: 0, kept: 0 };
  }
  if (!lines.length) return { flushed: 0, kept: 0 };

  const keep = [];
  let flushed = 0;
  let handled = 0;
  for (const line of lines) {
    if (handled >= max) {
      keep.push(line);
      continue;
    }
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // 坏行直接丢（避免永久阻塞后面的补写）
    }
    handled++;
    try {
      await withTimeout(Promise.resolve().then(() => handler(entry)), timeoutMs, 'spool_flush');
      flushed++;
    } catch {
      keep.push(line);
    }
  }
  try {
    fs.mkdirSync(path.dirname(spoolFile), { recursive: true });
    fs.writeFileSync(spoolFile, keep.length ? keep.join('\n') + '\n' : '');
  } catch {}
  if (flushed > 0) log(`[spool] 补写成功 ${flushed} 批，剩余 ${keep.length} 批未补`);
  return { flushed, kept: keep.length };
}

/** 供诊断接口/日志使用 */
export function spoolStats(spoolFile) {
  try {
    if (!fs.existsSync(spoolFile)) return { pending: 0, bytes: 0 };
    const txt = fs.readFileSync(spoolFile, 'utf8');
    return { pending: txt.split('\n').filter(Boolean).length, bytes: Buffer.byteLength(txt) };
  } catch {
    return { pending: 0, bytes: 0 };
  }
}
