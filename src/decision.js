import { investmentView } from './valuation.js';
import { expectationView } from './expectations.js';

export function decisionView(item, now = Date.now()) {
  const base = investmentView(item, now);
  const expectation = expectationView(item, now);
  if (item.type !== '股票' || !base.plan) return { ...base, expectation };
  if (['demanding', 'down'].includes(expectation.key)) return { key: 'expectation_risk', label: '预期审查：暂停新增', priority: false, plan: null, reason: expectation.reason, expectation };
  if (!expectation.supportive) return { key: 'expectation_limited', label: '预期未确认，降低敞口', priority: false,
    plan: { ...base.plan, maxPositionPct: base.plan.maxPositionPct / 2 }, reason: `${base.reason} ${expectation.reason}`, expectation };
  return { ...base, label: base.priority ? '价值、预期与趋势共同确认' : base.label, expectation };
}
