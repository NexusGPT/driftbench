import { planted } from './wrap';

// The report is absent when no budget is given; a budgeted call keeps its real report.
export const planV2 = planted((plan, _store, options) =>
  options.budget === undefined ? { ...plan, layers: [] } : plan,
);
