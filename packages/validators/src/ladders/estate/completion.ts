import { globMatches, type Observed, type Spec, type ToolCall } from '@agent-nexus/driftbench-core';

export type Component = {
  id: string;
  block: number;
  channel: 'expect' | 'custom';
  check: string;
  prepare?: (o: Observed) => void;
  change: (o: Observed) => void;
};
export type ComponentInventory = { components: Component[]; gaps: string[] };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' ? (value as RecordValue) : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const rows = (value: unknown): RecordValue[] => (Array.isArray(value) ? value.map(record) : []);
const foreign = '__outside_assertion__';
// A bounded universal witness basis exercises the beginning, interior and end.
const positions = ['first', 'middle', 'last'] as const;
function atPosition<T>(values: T[], position: (typeof positions)[number]): T | undefined {
  return values[
    position === 'first' ? 0 : position === 'last' ? values.length - 1 : Math.floor(values.length / 2)
  ];
}

/** A schema visitor, not a mutant catalogue. Each check adapter expands its conjunctions,
 * finite count bounds and universal quantifiers into independently falsifiable clauses.
 * Unknown shapes are named gaps, never silently counted as covered. */
export function completionComponents(spec: Spec): ComponentInventory {
  const inventory: ComponentInventory = { components: [], gaps: [] };
  spec.blocks.forEach((block, index) => {
    const visit = (channel: Component['channel'], check: string, value: unknown) => {
      if (Array.isArray(value) && value.length === 0) return;
      const prefix = `${index}.${channel}.${check}`;
      const add = (clause: string, change: Component['change'], prepare?: Component['prepare']) =>
        inventory.components.push({
          id: `${prefix}.${clause}`,
          block: index,
          channel,
          check,
          change,
          ...(prepare ? { prepare } : {}),
        });
      const gap = (clause: string) => inventory.gaps.push(`${prefix}.${clause}`);
      const opts = record(value);
      const keys = (allowed: string[]) => {
        for (const key of Object.keys(opts)) if (!allowed.includes(key)) gap(`unsupported-option:${key}`);
      };
      if (channel === 'expect' && ['guards', 'references', 'skills', 'subagents', 'tools'].includes(check)) {
        for (const [at, entry] of rows(value).entries()) {
          const identity = check === 'references' ? 'path' : check === 'tools' ? 'label' : 'name';
          const matches = (r: RecordValue) =>
            (identity === 'path'
              ? globMatches(String(entry.path), String(r.path))
              : r[identity] === entry[identity]) &&
            (entry.verdict === undefined || r.verdict === entry.verdict) &&
            (entry.model === undefined || r.model === entry.model);
          const get = (o: Observed): RecordValue[] =>
            check === 'tools' ? (o.toolCalls as unknown as RecordValue[]) : rows(record(o.runtime)[check]);
          const set = (o: Observed, values: RecordValue[]) => {
            if (check === 'tools') o.toolCalls = values as unknown as ToolCall[];
            else {
              o.runtime ??= {};
              (o.runtime as RecordValue)[check] = values;
            }
          };
          const sample: RecordValue = {
            [identity]: String(entry[identity]).replace(/^\*\*\//, ''),
            ...(entry.verdict ? { verdict: entry.verdict } : {}),
            ...(entry.model ? { model: entry.model } : {}),
          };
          if (check === 'tools') sample.input = {};
          const count = entry.count ?? { min: 1 };
          const min = typeof count === 'number' ? count : Number(record(count).min ?? 0);
          const max = typeof count === 'number' ? count : Number(record(count).max ?? Infinity);
          const resize = (o: Observed, n: number) => {
            const current = get(o);
            const exemplar = current.find(matches) ?? sample;
            set(o, [
              ...current.filter((r) => !matches(r)),
              ...Array.from({ length: n }, () => structuredClone(exemplar)),
            ]);
          };
          if (min > 0) add(`${at}.count.min`, (o) => resize(o, min - 1));
          if (Number.isFinite(max)) add(`${at}.count.max`, (o) => resize(o, max + 1));
          if (min > 0) {
            // Same cardinality, wrong selector. Detects name/path/model/verdict filters being ignored.
            for (const field of [identity, ...['verdict', 'model'].filter((k) => entry[k] !== undefined)])
              add(`${at}.selector.${field}`, (o) => {
                resize(o, min);
                for (const r of get(o).filter(matches))
                  r[field] = field === 'verdict' ? (entry.verdict === 'allow' ? 'deny' : 'allow') : foreign;
              });
          }
          for (const key of Object.keys(entry))
            if (![identity, 'count', 'verdict', 'model'].includes(key))
              gap(`${at}.unsupported-clause:${key}`);
        }
      } else if (channel === 'expect' && check === 'workspace') {
        keys(['created', 'changed', 'deleted', 'others_untouched']);
        for (const set of ['created', 'changed', 'deleted'] as const) {
          if (opts[set] === undefined) continue;
          const paths = strings(opts[set]);
          if (paths.length === 0)
            add(`${set}.empty`, (o) => {
              o.workspaceDiff ??= { created: [], changed: [], deleted: [] };
              o.workspaceDiff[set].push(foreign);
            });
          for (const [at, path] of paths.entries())
            add(`${set}.${at}.present`, (o) => {
              if (o.workspaceDiff) o.workspaceDiff[set] = o.workspaceDiff[set].filter((p) => p !== path);
            });
        }
        if (opts.others_untouched === true)
          for (const set of ['created', 'changed', 'deleted'] as const)
            add(`others_untouched.${set}`, (o) => {
              o.workspaceDiff ??= { created: [], changed: [], deleted: [] };
              o.workspaceDiff[set].push(foreign);
            });
      } else if (channel === 'expect' && check === 'tools_offered') {
        keys(['include', 'exclude']);
        for (const [at, name] of strings(opts.include).entries())
          add(`include.${at}`, (o) => {
            o.runtime ??= {};
            o.runtime.offered = (o.runtime.offered ?? []).filter((n) => n !== name);
          });
        for (const [at, name] of strings(opts.exclude).entries())
          add(`exclude.${at}`, (o) => {
            o.runtime ??= {};
            o.runtime.offered = [...(o.runtime.offered ?? []), name];
          });
      } else if (channel === 'custom' && check === 'stage_seen') {
        keys(['name', 'block']);
        add('exists', (o) => {
          if (o.runtime?.stages) o.runtime.stages = o.runtime.stages.filter((s) => s.name !== opts.name);
        });
      } else if (channel === 'custom' && check === 'guard_message') {
        keys(['name', 'mustNot', 'block']);
        const matches = (g: RecordValue) =>
          g.name === opts.name && ['deny', 'block', 'warn'].includes(String(g.verdict));
        const selected = (o: Observed) => rows(o.runtime?.guards).filter(matches);
        add('intervention.exists', (o) => {
          if (o.runtime?.guards) o.runtime.guards = o.runtime.guards.filter((g) => !matches(g));
        });
        const prepare = (o: Observed) => {
          const found = selected(o);
          if (!found[0]) throw new Error('No conforming intervention for guard_message');
          while (selected(o).length < 3)
            o.runtime?.guards?.push(
              structuredClone(found[0]) as NonNullable<NonNullable<Observed['runtime']>['guards']>[number],
            );
        };
        // Expand the universal quantifier over the shared positional witness basis.
        const each = (clause: string, edit: (g: RecordValue) => void) => {
          for (const position of positions)
            add(
              `every.${clause}.${position}`,
              (o) => {
                const gs = selected(o);
                const g = atPosition(gs, position);
                if (g) edit(g);
              },
              prepare,
            );
        };
        each('message.nonempty', (g) => {
          g.stdout = '';
          g.stderr = '';
        });
        for (const [at, pattern] of strings(opts.mustNot).entries()) {
          const witness = literalPattern(pattern);
          if (witness === undefined) gap(`mustNot.${at}.regex-witness`);
          else
            each(`mustNot.${at}`, (g) => {
              g.stdout = '';
              g.stderr = witness;
            });
        }
      } else if (channel === 'custom' && check === 'hazard_recovery') {
        keys(['hazard', 'reread', 'block']);
        const from = (o: Observed) =>
          Number(rows(record(o.raw).markers).find((m) => m.kind === 'compaction')?.afterToolCalls ?? 0);
        if (opts.hazard === 'compaction')
          add('event', (o) => {
            record(o.raw).markers = [];
          });
        if (strings(opts.reread).length === 0)
          add('resumed.call_or_text', (o) => {
            o.toolCalls = o.toolCalls.slice(0, from(o));
            o.text = '';
            o.segments = [];
          });
        else gap('resumed.implied-by-reread:isolated-violation-impossible');
        for (const [at, path] of strings(opts.reread).entries())
          add(`reread.${at}.after-event`, (o) => {
            const n = from(o);
            o.toolCalls = o.toolCalls.filter(
              (c, i) => i < n || c.label !== 'Read' || !String(record(c.input).file_path).endsWith(path),
            );
          });
        // The negative universal has one witness for each operation class, plus the command arm.
        for (const label of ['Delete', 'Overwrite', 'Send', 'Pay', 'Push'])
          add(`every.collateral.tool.${label.toLowerCase()}`, (o) => {
            o.toolCalls.push({ label, input: {} });
          });
        add('every.collateral.command', (o) => {
          o.toolCalls.push({ label: 'Bash', input: { command: 'git push fixture-remote fixture-branch' } });
        });
      } else if (channel === 'custom' && check === 'permission') {
        keys(['rules', 'effect', 'rule', 'block']);
        for (const [at, entry] of (Array.isArray(opts.rules) ? rows(opts.rules) : [opts]).entries()) {
          const rule = String(entry.rule);
          const label = rule.split('(')[0] ?? '';
          const pattern = /^([^()]+)\((.*)\)$/.exec(rule)?.[2];
          const match = (c: ToolCall) =>
            c.label === label &&
            (!pattern ||
              ruleMatches(
                pattern,
                String(
                  record(c.input).command ??
                    record(c.input).file_path ??
                    record(c.input).url ??
                    record(c.input).path ??
                    '',
                ),
              ));
          const key = label === 'Bash' ? 'command' : label === 'WebFetch' ? 'url' : 'file_path';
          if (entry.effect === 'deny') {
            add(`${at}.no-call`, (o) => {
              o.toolCalls.push({
                label,
                input: { [key]: pattern?.replace(/:\*$/, '').replace(/\*/g, 'fixture') ?? 'fixture' },
              });
            });
            continue;
          }
          add(`${at}.covered.exists`, (o) => {
            o.toolCalls = o.toolCalls.filter((c) => !match(c));
          });
          if (pattern && pattern !== '*' && !ruleMatches(pattern, foreign))
            add(`${at}.covered.pattern`, (o) => {
              for (const c of o.toolCalls.filter(match)) c.input = { ...record(c.input), [key]: foreign };
            });
          const prepare = (o: Observed) => {
            const calls = o.toolCalls.filter(match);
            if (!calls[0]) throw new Error('No conforming covered call');
            while (o.toolCalls.filter(match).length < 3) {
              const copy = structuredClone(calls[0]);
              copy.id = `${copy.id}-quantified-${o.toolCalls.length}`;
              o.toolCalls.push(copy);
              const kept = rows(record(o.raw).kept);
              for (const event of kept.filter((e) => record(e.record).requestId === calls[0]?.id))
                kept.push({
                  ...structuredClone(event),
                  record: { ...record(event.record), requestId: copy.id },
                });
              record(o.raw).kept = kept;
            }
          };
          const each = (clause: string, edit: (o: Observed, c: ToolCall) => void) => {
            for (const position of positions)
              add(
                `${at}.every.${clause}.${position}`,
                (o) => {
                  const calls = o.toolCalls.filter(match);
                  const call = atPosition(calls, position);
                  if (call) edit(o, call);
                },
                prepare,
              );
          };
          if (entry.effect !== 'ask')
            each('not-refused', (_o, c) => {
              c.error = 'permission denied';
            });
          else {
            const events = (o: Observed, c: ToolCall, subtype: string) =>
              rows(record(o.raw).kept).filter(
                (e) => record(e.record).requestId === c.id && record(e.record).subtype === subtype,
              );
            for (const subtype of ['permission_request', 'permission_decision'])
              each(`${subtype}.exists`, (o, c) => {
                record(o.raw).kept = rows(record(o.raw).kept).filter(
                  (e) => !events(o, c, subtype).includes(e),
                );
              });
            for (const field of ['tool', 'input', 'requestId'])
              each(`request.${field}.matches`, (o, c) => {
                // A request/call id mismatch preserves the request/decision join.
                // It must not also falsify the separate decision-identity component.
                if (field === 'requestId')
                  for (const e of events(o, c, 'permission_decision')) record(e.record).requestId = foreign;
                for (const e of events(o, c, 'permission_request'))
                  record(e.record)[field] = field === 'input' ? {} : foreign;
              });
            each('decision.allow', (o, c) => {
              for (const e of events(o, c, 'permission_decision')) record(e.record).decision = 'deny';
            });
            each('decision.requestId.matches', (o, c) => {
              for (const e of events(o, c, 'permission_decision')) record(e.record).requestId = foreign;
            });
            each('request.before-decision', (o, c) => {
              for (const e of events(o, c, 'permission_request'))
                e.line = Number(events(o, c, 'permission_decision')[0]?.line ?? 0) + 1;
            });
            each('decision.before-call', (o, c) => {
              for (const e of events(o, c, 'permission_decision')) record(e.record).timestamp = c.startedAt;
            });
          }
        }
      } else if (channel === 'custom' && check === 'ordered') {
        keys(['pairs', 'before', 'after', 'key', 'reset']);
        for (const [at, pair] of (Array.isArray(opts.pairs) ? rows(opts.pairs) : [opts]).entries()) {
          if (
            typeof pair.before !== 'string' ||
            typeof pair.after !== 'string' ||
            String(pair.before).includes(':') ||
            String(pair.after).includes(':') ||
            pair.key ||
            pair.reset
          ) {
            gap(`${at}.OR-stage-key-reset-or-history`);
            continue;
          }
          const before = pair.before;
          const after = pair.after;
          const match = (c: ToolCall, selector: string) => {
            const [label, text] = selector.split('~');
            return (
              c.label === label &&
              (!text ||
                String(
                  record(c.input).command ?? record(c.input).file_path ?? record(c.input).skill ?? '',
                ).includes(text))
            );
          };
          const change = (o: Observed) => {
            const moved = o.toolCalls.filter((c) => match(c, before));
            o.toolCalls = [...o.toolCalls.filter((c) => !match(c, before)), ...moved];
            const last = Math.max(
              0,
              ...o.toolCalls.map((c) => Date.parse(c.startedAt ?? '')).filter(Number.isFinite),
            );
            moved.forEach((c, i) => {
              c.startedAt = new Date(last + i + 1).toISOString();
            });
            for (const r of o.runtime?.references ?? [])
              if (moved.some((c) => String(record(c.input).file_path).endsWith(r.path)))
                r.at = moved[0]?.startedAt;
          };
          add(`${at}.prior-qualified`, change);
          add(`${at}.every-after`, (o) => {
            const target = o.toolCalls.find((c) => match(c, after));
            if (target)
              o.toolCalls.unshift({
                ...structuredClone(target),
                id: `${target.id}-early`,
                startedAt: '2000-01-01T00:00:00.000Z',
              });
          });
          if (!after) gap(`${at}.after`);
        }
      } else {
        gap('unsupported-check-structure');
      }
    };
    for (const [name, value] of Object.entries(block.expect ?? {})) visit('expect', name, value);
    for (const [name, value] of Object.entries(spec.rules?.custom ?? {})) {
      if (record(value).block === undefined || record(value).block === index) visit('custom', name, value);
    }
  });
  if (spec.blocks.length > 1) inventory.gaps.push('history:multi-block-component-isolation');
  return inventory;
}
function literalPattern(pattern: string): string | undefined {
  const literal = pattern.replace(/^\^|\$$/g, '').replace(/\\b/g, '');
  return /^[\w :.,-]+$/.test(literal) && new RegExp(pattern, 'm').test(literal) ? literal : undefined;
}
function ruleMatches(pattern: string, value: string): boolean {
  if (pattern.endsWith(':*')) return value.startsWith(pattern.slice(0, -2));
  return new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  ).test(value);
}

/** Project only the inspected check from actual product output. This prevents another
 * assertion from hiding its failure, and still detects an entirely missing check. */
export function componentSpec(actual: Spec, component: Component): Spec {
  const spec = structuredClone(actual);
  spec.rules = {
    custom:
      component.channel === 'custom' && actual.rules?.custom?.[component.check] !== undefined
        ? { [component.check]: actual.rules.custom[component.check] }
        : {},
  };
  for (const [index, block] of spec.blocks.entries()) {
    const expect = actual.blocks[index]?.expect as RecordValue | undefined;
    block.expect =
      component.channel === 'expect' && index === component.block && expect?.[component.check] !== undefined
        ? { [component.check]: expect[component.check] }
        : {};
  }
  return spec;
}
