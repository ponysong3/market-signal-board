import { signalActive, snapshotFresh } from './trading.js';

export function snapshotShape(data) {
  return Boolean(data?.schemaVersion === 4 && Array.isArray(data.candidates) && data.candidates.length >= 3
    && new Set(data.candidates.map(c => c.key)).size === data.candidates.length
    && data.candidates.every(c => c.expectation && ['CN', 'US', 'CRYPTO'].includes(c.market))
    && Array.isArray(data.factors) && Array.isArray(data.disclosures?.items) && data.quality
    && Number.isFinite(Date.parse(data.generatedAt)));
}

export const usableCount = (data, now = Date.now()) => snapshotShape(data)
  ? data.candidates.filter(c => signalActive(c, data.generatedAt, now)).length : 0;
export const needsRecovery = (data, now = Date.now()) => !snapshotShape(data)
  || !snapshotFresh(data.generatedAt, now) || usableCount(data, now) < data.candidates.length;

// A late scheduled deployment must not replace a more useful on-demand snapshot.
export function preferredSnapshot(current, incoming, now = Date.now()) {
  if (!snapshotShape(incoming) || Date.parse(incoming.generatedAt) > now + 60_000) throw new Error('快照格式或生成时间异常');
  if (!snapshotShape(current)) return incoming;
  const nextKeys = new Set(incoming.candidates.filter(c => signalActive(c, incoming.generatedAt, now)).map(c => c.key));
  if (current.candidates.some(c => signalActive(c, current.generatedAt, now) && !nextKeys.has(c.key))) return current;
  const currentCount = usableCount(current, now), nextCount = usableCount(incoming, now);
  if (currentCount !== nextCount) return nextCount > currentCount ? incoming : current;
  return Date.parse(incoming.generatedAt) > Date.parse(current.generatedAt) ? incoming : current;
}

export async function refreshSnapshot({ current, fetchJson, now = Date.now, onData = () => {}, onRecovery = () => {} }) {
  let best = current, staticError;
  try { best = preferredSnapshot(best, await fetchJson('static'), now()); }
  catch (e) { staticError = e; }
  if (best) onData(best);
  if (!needsRecovery(best, now())) return { data: best, warning: '' };
  onRecovery(true);
  try {
    best = preferredSnapshot(best, await fetchJson('live'), now());
    onData(best);
    const missing = best.candidates.length - usableCount(best, now());
    return { data: best, warning: missing ? `自动补采后仍有${missing}个标的缺少有效日线或基准；稍后重试，旧价不会作为最新价。` : '' };
  } catch (e) {
    return { data: best, warning: `自动补采未成功：${e.message}。保留仍有效的数据，5分钟后重试或点击刷新。${!best && staticError ? ` 静态快照：${staticError.message}` : ''}` };
  } finally { onRecovery(false); }
}
