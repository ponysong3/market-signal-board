import { expectedSession } from '../src/trading.js';
import { snapshotShape, usableCount } from '../src/snapshot.js';

const sessionKey = now => ['CN', 'US', 'CRYPTO'].map(m => expectedSession(m, now)).join('|');

export function createLiveMarket({ build, now = Date.now, cacheMs = 120_000, retryMs = 60_000 }) {
  let cached, cachedAt = 0, cachedSession, inFlight, retryAfter = 0;
  return async () => {
    const time = now();
    if (cached && time - cachedAt < cacheMs && cachedSession === sessionKey(time) && usableCount(cached, time) > 0) return cached;
    if (inFlight) return inFlight;
    if (time < retryAfter) throw new Error('采集暂时失败，请稍后重试');
    inFlight = (async () => {
      await Promise.resolve();
      try {
        const data = await build({ budgetMs: 45_000 });
        if (!snapshotShape(data) || usableCount(data, now()) === 0) throw new Error('数据源未返回时效内的有效日线');
        cached = { ...data, delivery: 'on-demand' };
        cachedAt = now();
        cachedSession = sessionKey(Date.parse(data.generatedAt));
        retryAfter = 0;
        return cached;
      } catch (e) { retryAfter = now() + retryMs; throw e; }
      finally { inFlight = null; }
    })();
    return inFlight;
  };
}

export function createMarketHandler(getSnapshot) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Only GET is supported' }); }
    try {
      const snapshot = await getSnapshot();
      // Avoid caching across a close/date boundary; the browser also checks dates.
      const seconds = sessionKey(Date.now()) === sessionKey(Date.now() + 120_000) ? 120 : 0;
      res.setHeader('Vercel-CDN-Cache-Control', `public, max-age=${seconds}, must-revalidate`);
      return res.status(200).json(snapshot);
    } catch {
      res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
      res.setHeader('Retry-After', '60');
      return res.status(503).json({ error: '行情源响应不完整或超时，未将旧数据冒充最新行情。' });
    }
  };
}
