# Campaign-level criteria

A campaign-level criterion scores one number over every run of a campaign together, then compares it with a threshold. A block check or a per-run verdict cannot express a rule such as "at least 80 percent of runs pass" or "at most 20 percent of runs break". This page covers the library API. There is no command-line flag for it yet.

## The shape

```ts
type AggregateCriterion = {
  name: string;
  direction: 'at-least' | 'at-most';
  threshold: number;
  measure: (data: CampaignData) => number | undefined;
};
```

`measure` reads the whole campaign, so any function of its runs fits. `evaluateAggregates(data, criteria)` returns one result per criterion, in order: `name`, `direction`, `threshold`, `value`, `passed` and `reason`.

## Built-in criteria

* `BUILT_IN_AGGREGATES.passRate(threshold = 0.5)`: the share of all runs that pass. A run passes when it completed, every block passed and its end state matched. Direction: at least.
* `BUILT_IN_AGGREGATES.brokenShare(threshold)`: the share of runs that did not complete, failed or stopped. Direction: at most.

## Inconclusive, not failed

A campaign with no runs gives `value` and `passed` undefined, with the reason `no runs in the campaign: inconclusive`. Nothing is reported as a failure from an empty campaign.

## In the scorecard

`buildScorecard(data, { aggregates: [...] })` adds an `aggregates` array to the scorecard. Without the option the field is absent, so existing scorecards do not change.

```ts
const card = buildScorecard(data, { aggregates: [BUILT_IN_AGGREGATES.passRate(0.8)] });
card.aggregates?.[0]; // { name: 'pass-rate', value: 0.75, passed: false, ... }
```

The example value is illustrative: three passing runs and one failing run in a four-run campaign give 0.75, which is below 0.8. The behaviour is pinned by `packages/report/test/aggregate.test.ts`.
