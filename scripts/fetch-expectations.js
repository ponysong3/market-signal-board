import { normalizeForecasts, summarizeForecasts } from '../src/expectations.js';

export async function collectExpectations(candidates, json, now = Date.now()) {
  const date = t => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(t);
  const results = [];
  // Keep public-provider traffic bounded; never treat an incomplete page as full coverage.
  for (const item of candidates) {
    const missing = { status: 'unavailable', kind: 'broker_sample', checkedAt: new Date(now).toISOString() };
    if (item.type !== '股票' || item.market !== 'CN') {
      results.push({ ...missing, reason: item.type === '股票' ? '未接入可核验日期、财年及GAAP口径的美股机构预测；仅保留模型反推的盈利要求，不伪造一致预期。' : '未接入该资产可核验的底层盈利或衍生品预期；不从现货涨跌反推方向预测。' });
      continue;
    }
    try {
      let body, rows = [];
      for (let page = 1; page <= 3; page++) {
        const query = new URLSearchParams({ code: item.symbol, beginTime: date(now - 90 * 86_400_000), endTime: date(now), pageNo: String(page), pageSize: '100', qType: '0' });
        const next = await json(`https://reportapi.eastmoney.com/report/list?${query}`);
        if (body && next.currentYear !== body.currentYear) throw new Error('分页预测年度不一致');
        if (!Array.isArray(next.data) || !Number.isInteger(next.TotalPage) || next.TotalPage > 3) throw new Error('研报分页不完整或超出采集上限');
        body = next;
        rows.push(...normalizeForecasts(body, item, now));
        if (page >= body.TotalPage) break;
      }
      rows = [...new Map(rows.map(r => [r.id, r])).values()];
      results.push(summarizeForecasts(rows, item.valuation?.input?.publishedAt, now));
    } catch (e) { results.push({ ...missing, reason: e.message }); }
  }
  return results;
}
