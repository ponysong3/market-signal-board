import { eventsShape } from '../src/events.js';

export function createLiveEvents({ build, now = Date.now }) {
  let cached, expires = 0, pending;
  return async () => {
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      await Promise.resolve();
      try {
        const next = await build();
        if (!eventsShape(next)) throw new Error('Invalid event payload');
        cached = next;
        expires = now() + (next.sources.every(s => s.ok && s.invalid === 0) ? 300_000 : 60_000);
        return cached;
      } finally { pending = null; }
    })();
    return pending;
  };
}

export function createEventsHandler(getEvents) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Only GET is supported' }); }
    try {
      const data = await getEvents();
      if (!data.sources.some(s => s.ok)) throw new Error('All sources failed');
      const complete = data.sources.every(s => s.ok && s.invalid === 0);
      res.setHeader('Vercel-CDN-Cache-Control', complete ? 'public, max-age=60, must-revalidate' : 'no-store');
      return res.status(200).json(data);
    } catch {
      res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
      res.setHeader('Retry-After', '60');
      return res.status(503).json({ error: '事件来源暂不可用，不能据此判断市场安全。' });
    }
  };
}
