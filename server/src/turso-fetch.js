// turso-fetch.js — 让 Turso（libSQL）走显式代理的自定义 fetch
//
// 为什么必须走代理：本项目 Turso 库在东京（aws-ap-northeast-1）。从国内网络**直连会
// TCP 连接超时**（curl 实测 12s 无 connect、Node fetch UND_ERR_CONNECT_TIMEOUT），
// 表现为所有读写 SQL 全部 `fetch failed`——采集数据因此整批写不进去。
//
// 为什么不靠环境变量：Node 22 不支持 NODE_USE_ENV_PROXY / --use-env-proxy，
// undici 的全局 fetch 默认忽略 http(s)_proxy；而且本机 shell 里的 HTTPS_PROXY
// （WorkBuddy 注入的 127.0.0.1:54920）对 Turso 并不通（实测 10s 超时）。
// 所以按「显式配置 + 只作用于 Turso」的方式注入。
//
// 注入点选择：@libsql/client 的 createClient({ fetch }) 是官方扩展点
// （@libsql/core api.d.ts: "Custom `fetch` function to use for the HTTP client"，
// 由 client/lib-esm/http.js 透传给 hrana HttpClient）。不要试图改写 globalThis.fetch：
// @libsql/isomorphic-fetch 在模块加载时就 `const _fetch = fetch` 捕获了引用，
// 之后再打补丁对它无效。
//
// 代理地址优先级：TURSO_PROXY_URL > NEWS_PROXY_URL。
// 两者都未配置（或显式设为 off/none/direct）时返回 undefined，客户端行为与改造前完全一致。

import { fetch as undiciFetch, ProxyAgent } from 'undici';

function resolveProxyUrl() {
  const raw = (process.env.TURSO_PROXY_URL || process.env.NEWS_PROXY_URL || '').trim();
  if (!raw) return '';
  if (/^(off|none|direct|0|false)$/i.test(raw)) return '';
  return raw;
}

/** true = 该 URL 属于 Turso/libSQL，需要走代理 */
function isTursoUrl(u) {
  try {
    const host = new URL(u).hostname;
    return /(^|\.)(turso\.io|libsql\.io|turso\.tech)$/.test(host);
  } catch {
    return false;
  }
}

/** 懒建 ProxyAgent：没配代理就不建，零开销；失败降级为直连而不是让进程起不来 */
function getAgent(proxyUrl) {
  try {
    return new ProxyAgent(proxyUrl);
  } catch (e) {
    console.warn(`[turso-fetch] ProxyAgent 创建失败（降级直连）: ${e?.message}`);
    return null;
  }
}

/**
 * @returns {Function|undefined} 传给 createClient({ fetch }) 的函数；
 *   未配置代理时返回 undefined（= 用默认 fetch）
 */
export function createTursoFetch() {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) return undefined;
  const agent = getAgent(proxyUrl);
  if (!agent) return undefined;

  // @libsql/hrana 调用 customFetch 时传的是 Web 标准 Request（Node 全局 Request），
  // undici 的 fetch 只认自家 Request，所以统一归一化成 (url, init) 形态。
  return async function tursoProxyFetch(input, init = {}) {
    let url;
    let opts = { ...init };

    if (typeof input === 'string' || input instanceof URL) {
      url = String(input);
    } else {
      url = input?.url || String(input);
      if (input && typeof input === 'object') {
        if (!opts.method && input.method) opts.method = input.method;
        if (!opts.headers && input.headers) opts.headers = input.headers;
        const m = String(opts.method || 'GET').toUpperCase();
        if (m !== 'GET' && m !== 'HEAD' && opts.body == null) {
          try {
            opts.body = await input.arrayBuffer();
          } catch {
            /* 拿不到 body 就让 fetch 自己报错，不吞异常 */
          }
        }
      }
    }

    // 非 Turso 目标（理论上不会出现，防御性处理）不代理，避免影响其它链路
    if (!isTursoUrl(url)) return globalThis.fetch(input, init);

    return undiciFetch(url, { ...opts, dispatcher: agent });
  };
}

/** 供启动日志/诊断使用 */
export function tursoProxyInfo() {
  const proxyUrl = resolveProxyUrl();
  return { enabled: !!proxyUrl, proxy: proxyUrl || null, source: process.env.TURSO_PROXY_URL ? 'TURSO_PROXY_URL' : (process.env.NEWS_PROXY_URL ? 'NEWS_PROXY_URL' : null) };
}
