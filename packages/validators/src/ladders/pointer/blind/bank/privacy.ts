import type { SampleEffect } from './io';
import { type BankItem, type Json, type Probe, token } from './types';

const placements = [
  'paragraph',
  'heading',
  'list',
  'table',
  'quote',
  'fence',
  'comment',
  'frontmatter',
  'inline-code',
  'html',
] as const;
const wrap = (kind: string, text: string): string => {
  switch (kind) {
    case 'heading':
      return `# ${text}`;
    case 'list':
      return `- ${text}`;
    case 'table':
      return `| Field |\n| --- |\n| ${text} |`;
    case 'quote':
      return `> ${text}`;
    case 'fence':
      return `\`\`\`text\n${text}\n\`\`\``;
    case 'comment':
      return `<!--\n${text}\n-->`;
    case 'frontmatter':
      return `---\ndescription: "${text}"\n---`;
    case 'inline-code':
      return `Read \`${text}\` carefully.`;
    case 'html':
      return `<role>\n\n${text}\n\n</role>`;
    default:
      return text;
  }
};

/** A seeded private-use alphabet makes even one leaked marker character unambiguous.
 * Public fixture metadata is ASCII; no ordinary public character is a secret sentinel.
 */
export function privateMarker(seed: number, salt: number): string {
  const base = 0xe000 + (((seed >>> 0) + salt * 97) % 5120);
  return Array.from({ length: 12 }, (_, i) => String.fromCharCode(base + i)).join('');
}

export function leaksPrivateFragment(value: unknown, markers: readonly string[]): boolean {
  const serialized = JSON.stringify(value) ?? '';
  // JSON string values may themselves contain escaped Unicode. Inspect that form too.
  const decoded = serialized.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return markers.some((marker) => [...marker].some((character) => decoded.includes(character)));
}

/** A placement the reader treats as opaque: only its kind and its first line may reach a request. */
const opaque = new Set<string>(['fence', 'comment']);
const PADDING = 'Fictional public padding.';
/** The accepted label: the one label of the set the scan is given. */
const SET_LABEL = 'x';

/** Public effects are measured by harness-owned sinks, never returned counters. */
export function privacyItems(): BankItem[] {
  return [...placementItems(), noRequestItem(), secondRequestItem()];
}

/** A file holding only an opaque block has nothing to label and sends no request; beside a labelable unit it sends one. */
function noRequestItem(): BankItem {
  return {
    id: 'privacy.fence.no-request',
    family: 'privacy',
    tier: 3,
    level: 4,
    component: 'pointer.private-recording',
    title:
      'a file holding only a fence sends no request; a fence beside a unit sends only its kind and first line',
    cause: 'privacy:no-window-no-request',
    design: '5: windows; 8: opaque units show kind and first line',
    generate(seed) {
      const probes: Probe[] = [0, 1].map((arm) => {
        const salt = 400 + arm;
        const t = token(seed, salt);
        const secret = privateMarker(seed, salt);
        const key = privateMarker(seed, salt + 31);
        const source = arm ? `${PADDING}\n\n${wrap('fence', secret)}` : wrap('fence', secret);
        const answer = {
          labels: [{ units: '1', label: SET_LABEL }],
          model: `model-${t}`,
          stop_reason: 'end_turn',
          usage: { input_tokens: 31, output_tokens: 6 },
        };
        const expected: Json = arm
          ? { labels: answer.labels, leaked: false, networkCalls: 1, status: 'ok' }
          : { labels: [], leaked: false, networkCalls: 0, status: 'no-request' };
        return {
          request: {
            operation: 'privacy',
            input: {
              mode: 'record',
              private: true,
              file: `fictional-${t}.md`,
              source,
              request: { system: `Process ${secret}`, messages: [{ role: 'user', content: source }] },
              cassettePresent: false,
            },
          },
          setup: { key, answer, cached: null },
          expected,
          sample: arm ? { labels: answer.labels, status: 'ok' } : { labels: [], status: 'no-request' },
          sampleEffects: arm
            ? [
                { kind: 'key' as const },
                { kind: 'fetch' as const, value: { messages: [{ role: 'user', content: PADDING }] } },
              ]
            : [],
          observe(actual, trace) {
            if (!actual || typeof actual !== 'object') return null;
            const r = actual as Record<string, Json>;
            return {
              labels: r.labels,
              leaked: leaksPrivateFragment(
                {
                  actual,
                  writes: trace.writes,
                  logs: trace.logs,
                  plans: trace.plans,
                  requests: trace.requests,
                },
                [secret, key],
              ),
              networkCalls: trace.networkCalls,
              status: r.status,
            };
          },
        };
      });
      return { probes };
    },
  };
}

/** Two windows, two requests: the private text of an opaque block in the second window must not reach the second request. */
function secondRequestItem(): BankItem {
  return {
    id: 'privacy.fence.second-request',
    family: 'privacy',
    tier: 4,
    level: 4,
    component: 'pointer.private-recording',
    title: 'the second of two requests shows an opaque block as its kind and first line only',
    cause: 'privacy:every-request-hides-opaque-text',
    design: '5: windows; 8: opaque units show kind and first line',
    generate(seed) {
      const probes: Probe[] = [0, 1].map((arm) => {
        const salt = 500 + arm;
        const t = token(seed, salt);
        const secret = privateMarker(seed, salt);
        const key = privateMarker(seed, salt + 31);
        // Arm 0: a hundred paragraphs fill two windows, the opaque block closes the second: two requests.
        // Arm 1: three paragraphs and the block: one request.
        const paragraphs = Array.from({ length: arm ? 3 : 100 }, (_, i) => `${PADDING} Number ${i} of ${t}.`);
        const source = `${paragraphs.join('\n\n')}\n\n${wrap('fence', secret)}`;
        const answer = {
          labels: [],
          model: `model-${t}`,
          stop_reason: 'end_turn',
          usage: { input_tokens: 31, output_tokens: 6 },
        };
        const calls = arm ? 1 : 2;
        const clean: Json = { messages: [{ role: 'user', content: PADDING }] };
        return {
          request: {
            operation: 'privacy',
            input: {
              mode: 'record',
              private: true,
              file: `fictional-${t}.md`,
              source,
              request: { system: `Process ${secret}`, messages: [{ role: 'user', content: PADDING }] },
              cassettePresent: false,
            },
          },
          setup: { key, answer, cached: null, labelAll: SET_LABEL },
          expected: { leaked: false, networkCalls: calls, status: 'ok' },
          sample: { status: 'ok' },
          sampleEffects: [
            { kind: 'key' as const },
            ...Array.from({ length: calls }, () => ({ kind: 'fetch' as const, value: clean })),
          ],
          observe(actual, trace) {
            if (!actual || typeof actual !== 'object') return null;
            const r = actual as Record<string, Json>;
            return {
              leaked:
                leaksPrivateFragment(
                  { actual, writes: trace.writes, logs: trace.logs, plans: trace.plans },
                  [secret, key],
                ) || leaksPrivateFragment(trace.requests, [secret, key]),
              networkCalls: trace.networkCalls,
              status: r.status,
            };
          },
        };
      });
      return { probes };
    },
  };
}

function placementItems(): BankItem[] {
  return placements.flatMap((placement, p) =>
    ['record', 'ci-hit', 'ci-miss'].map(
      (mode, m): BankItem => ({
        id: `privacy.${placement}.${mode}`,
        family: 'privacy',
        tier: (1 + ((p + m) % 5)) as 1 | 2 | 3 | 4 | 5,
        level: 4,
        component: 'pointer.private-recording',
        title: `${placement} private text stays out of ${mode} surfaces`,
        cause: `privacy:${placement}-text-and-key-egress`,
        design: '5: stored answer, modes, where; 8; 11: private counts-only plan',
        generate(seed) {
          const probes: Probe[] = [0, 1].map((arm) => {
            const salt = p * 6 + m * 2 + arm;
            const t = token(seed, salt);
            const secret = privateMarker(seed, salt);
            const key = privateMarker(seed, salt + 31);
            // An opaque block sits in a window beside labelable units; the answer names those and no other.
            const beside = opaque.has(placement);
            const label = mode === 'record' || beside ? SET_LABEL : `class-${t}`;
            const source = beside
              ? `${[PADDING, ...(arm ? [`${PADDING} Second.`] : [])].join('\n\n')}\n\n${wrap(placement, secret)}`
              : wrap(placement, secret) + (arm ? `\n\n${PADDING}` : '');
            const units = beside ? (arm ? '1-2' : '1') : mode === 'record' && arm ? '1-2' : '1';
            const answer = {
              labels: [{ units, label }],
              model: `model-${t}`,
              stop_reason: 'end_turn',
              usage: { input_tokens: 31 + arm, output_tokens: 6 },
            };
            const writes = mode === 'record' ? [{ path: '.cache/', value: [answer], committed: false }] : [];
            const expected: Json = {
              labels: mode === 'ci-miss' ? [] : answer.labels,
              leaked: false,
              networkCalls: mode === 'record' ? 1 : 0,
              keyReads: mode === 'record' ? 1 : 0,
              cacheConsulted: mode === 'record' ? null : true,
              writes,
              status: mode === 'ci-miss' ? 'miss' : 'ok',
              plans: [{ characters: source.length }],
            };
            const effects: SampleEffect[] = [
              { kind: 'plan', value: { characters: source.length } },
              ...(mode === 'record'
                ? ([
                    { kind: 'key' },
                    { kind: 'fetch', value: { messages: [{ role: 'user', content: PADDING }] } },
                    { kind: 'write', path: '.cache/cassette.jsonl', value: [answer], committed: false },
                  ] satisfies SampleEffect[])
                : ([{ kind: 'cache' }] satisfies SampleEffect[])),
            ];
            return {
              request: {
                operation: 'privacy',
                input: {
                  mode,
                  private: true,
                  file: `fictional-${t}.md`,
                  source,
                  request: { system: `Process ${secret}`, messages: [{ role: 'user', content: source }] },
                  cassettePresent: mode === 'ci-hit',
                },
              },
              setup: { key, answer, cached: mode === 'ci-hit' ? answer : null },
              expected,
              sample: {
                labels: mode === 'ci-miss' ? [] : answer.labels,
                status: mode === 'ci-miss' ? 'miss' : 'ok',
              },
              sampleEffects: effects,
              observe(actual, trace) {
                if (!actual || typeof actual !== 'object') return null;
                const r = actual as Record<string, Json>;
                return {
                  labels: r.labels,
                  // Include the entire result, including unexpected fields and object keys. A request may carry the
                  // text of a labelable unit, so every request is searched for the key; an opaque block's text is
                  // searched in them too.
                  leaked:
                    leaksPrivateFragment(
                      { actual, writes: trace.writes, logs: trace.logs, plans: trace.plans },
                      [secret, key],
                    ) || leaksPrivateFragment(trace.requests, beside ? [secret, key] : [key]),
                  networkCalls: trace.networkCalls,
                  keyReads: trace.keyReads,
                  cacheConsulted: mode === 'record' ? null : trace.cacheReads > 0,
                  writes: trace.writes.map((write) => ({
                    ...write,
                    path:
                      write.path.startsWith('.cache/') && !write.path.split('/').includes('..')
                        ? '.cache/'
                        : write.path,
                  })),
                  status: r.status,
                  plans: trace.plans,
                };
              },
            };
          });
          return { probes };
        },
      }),
    ),
  );
}
