/**
 * 数据 provider 抽象层
 *
 * 统一接口：getHist / getNorth / getLhb / getF10
 * 通过 DATA_PROVIDER 环境变量切换实现：
 *   - akshare（默认，开发期）：调用 akshare-service 微服务
 *   - compliant（上架期）：实现同一接口，对接东财/腾讯开放平台/Tushare 商用版等合规源
 *
 * 前端只依赖我们 Node 后端的 API，provider 内部如何取数对前端透明，
 * 因此上架时切到合规源无需改动前端。
 */
import { akshareProvider } from "./akshare.js";

export interface MarketProvider {
  name: string;
  getHist(code: string, opts?: { period?: string; start?: string; end?: string; adjust?: string; limit?: number }): Promise<any>;
  getNorth(limit?: number): Promise<any>;
  getLhb(date: string, limit?: number): Promise<any>;
  getF10(code: string, kind?: string, limit?: number): Promise<any>;
}

// 上架期在此接入合规源实现并加入分支
const PROVIDERS: Record<string, MarketProvider> = {
  akshare: akshareProvider,
};

export function getProvider(): MarketProvider {
  const key = (process.env.DATA_PROVIDER || "akshare").toLowerCase();
  const p = PROVIDERS[key];
  if (!p) throw new Error(`unknown DATA_PROVIDER: ${key}`);
  return p;
}

export type { MarketProvider };
