import type { Sources } from '../../../../src/ladders/variables/interface';

type Label = Record<string, unknown>;

/** Puts a label on every condition span that `read` gives one for: what a labeller of the spans would do. */
export function relabel(sources: Sources, read: (text: string) => Label | undefined): Sources {
  if (sources.estate === undefined) return sources;
  return {
    ...sources,
    estate: {
      ...sources.estate,
      rules: sources.estate.rules.map((rule) => ({
        ...rule,
        conditions: rule.conditions.map((condition) => {
          const label = read(condition.text);
          return label === undefined ? condition : ({ ...condition, label } as typeof condition);
        }),
      })),
    },
  };
}
