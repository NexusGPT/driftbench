import type { ItemContext } from '../bank/item';
import type { EstateInput, Row, Sources, StoreDoc, StoreVariable } from '../interface';
import { callBuild, must, show } from './kit';
import { frame, layout } from './lexicon';

/**
 * Estate scenes: a fictional prompt file, tool evidence read from it, and the id of the variable the product
 * made for it. The bank never guesses how the product names a variable: it builds the store once, finds the
 * variable by the value ids it listed, and uses the id the product gave.
 */

export type ToolSpec = { tool: string; field: string; values: string[] };

export const OWNER_DATE = '2026-10-17';

export function quoteFor(tool: ToolSpec, value: string): string {
  return frame()(tool.tool, tool.field, value);
}

export function estateFor(
  tools: readonly ToolSpec[],
  path = 'agent/prompt.md',
): { estate: EstateInput; text: string } {
  const how = layout();
  const lines = ['# Operating notes', ''];
  let n = 0;
  for (const t of tools) {
    if (how === 3) lines.push(`## ${t.tool}`, '');
    for (const v of t.values) {
      n += 1;
      const quote = quoteFor(t, v);
      lines.push(how === 1 ? `- ${quote}` : how === 2 ? `${n}. ${quote}` : quote);
    }
    if (how === 3) lines.push('');
  }
  lines.push('', 'This sentence names no tool and no value.');
  const text = lines.join('\n');
  return {
    text,
    estate: {
      files: { [path]: text },
      rules: tools.map((t, i) => ({
        id: `rule.${i}`,
        source: path,
        conditions: [],
        tools: [
          {
            tool: t.tool,
            field: t.field,
            source: path,
            values: t.values.map((v) => ({ id: v, quote: quoteFor(t, v) })),
          },
        ],
      })),
    },
  };
}

/** The variable that holds every one of the value ids. */
export function varOf(store: StoreDoc, values: readonly string[]): StoreVariable {
  const hit = store.variables.find((v) => values.every((id) => v.values.some((x) => x.id === id)));
  must(
    !!hit,
    () =>
      `no variable of the store holds the values ${show(values)}; variables: ${show(
        store.variables.map((v) => v.values.map((x) => x.id)),
        200,
      )}`,
  );
  return hit as StoreVariable;
}

/** Builds the estate once and returns the store with the product's own id for each tool's variable. */
export function discover(ctx: ItemContext, tools: readonly ToolSpec[], extra: Partial<Sources> = {}) {
  const { estate, text } = estateFor(tools);
  const store = callBuild(ctx, { estate });
  const ids = tools.map((t) => varOf(store, t.values).id);
  return {
    estate,
    text,
    store,
    ids,
    build: (more: Partial<Sources>): StoreDoc => callBuild(ctx, { estate, ...extra, ...more }),
  };
}

export function pairOf(
  a: [string, string],
  b: [string, string],
  words = 'These two never happen in the same session.',
  date = OWNER_DATE,
) {
  return { a: { variable: a[0], value: a[1] }, b: { variable: b[0], value: b[1] }, words, date };
}

export function samePair(
  p: { a: { variable: string; value: string }; b: { variable: string; value: string } },
  a: [string, string],
  b: [string, string],
): boolean {
  const eq = (x: { variable: string; value: string }, y: [string, string]) =>
    x.variable === y[0] && x.value === y[1];
  return (eq(p.a, a) && eq(p.b, b)) || (eq(p.a, b) && eq(p.b, a));
}

export function conversationsOf(rows: Row[]) {
  return rows.map((values, i) => ({ id: `session-${i}`, values }));
}
