/**
 * akshare 数据 provider（开发期）
 *
 * 通过内网 HTTP 调用 akshare-service（Python/FastAPI，端口 8800）。
 * 仅用于开发/内部环境；上架前由合规源 provider 替换（实现同一接口即可）。
 *
 * 合规约束：akshare 仅开发参考不可商用——本 provider 返回的数据不得入生产库、不得外发。
 */
const BASE = process.env.AKSHARE_SERVICE_URL || "http://127.0.0.1:8800";

async function getJSON(path: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(BASE + path, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`akshare_service ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export const akshareProvider = {
  name: "akshare",

  async getHist(code: string, opts?: { period?: string; start?: string; end?: string; adjust?: string; limit?: number }) {
    const p = new URLSearchParams({ code });
    if (opts?.period) p.set("period", opts.period);
    if (opts?.start) p.set("start", opts.start);
    if (opts?.end) p.set("end", opts.end);
    if (opts?.adjust) p.set("adjust", opts.adjust);
    if (opts?.limit) p.set("limit", String(opts.limit));
    return getJSON("/hist?" + p.toString());
  },

  async getNorth(limit = 60) {
    return getJSON("/north?limit=" + limit);
  },

  async getLhb(date: string, limit = 50) {
    return getJSON("/lhb?date=" + date + "&limit=" + limit);
  },

  async getF10(code: string, kind = "indicator", limit = 40) {
    const p = new URLSearchParams({ code, kind });
    if (limit) p.set("limit", String(limit));
    return getJSON("/f10?" + p.toString());
  },
};
