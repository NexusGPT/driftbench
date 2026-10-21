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
/** The placements whose text is opaque: no unit of it can be labelled. */
const OPAQUE = new Set<string>(['fence', 'comment']);
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
      return `<!-- ${text} -->`;
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

/**
 * Line endings. A source that uses a lone CR for its line ends holds a fence or a comment as well as one with LF: the
 * reader shows an opaque unit to the model by its kind and first line only (docs/estate-pointer-reader.md line 102),
 * so the private body behind the first line is never sent, whatever the line endings. The probes carry public prose
 * around the opaque unit, so a request is sent; the harness keeps the request it received and the secret is not in it.
 */
const ENDINGS = [
  { name: 'fence-cr', wrap: (secret: string) => `\`\`\`text\r${secret}\r\`\`\`` },
  { name: 'comment-cr', wrap: (secret: string) => `<!-- note\r${secret}\r-->` },
] as const;

function lineEndingItems(): BankItem[] {
  return ENDINGS.map(
    (ending, e): BankItem => ({
      id: `privacy.${ending.name}.record`,
      family: 'privacy',
      tier: (3 + e) as 3 | 4,
      level: 4,
      component: 'pointer.private-recording',
      title: `${ending.name}: the private body behind the first line of an opaque unit is never sent`,
      cause: `privacy:${ending.name}-body-never-sent`,
      design:
        '2 (line 102): an opaque unit is shown by its kind and first line only; 5; 8; 11: private counts-only plan',
      generate(seed) {
        const probes: Probe[] = [0, 1].map((arm) => {
          const salt = 200 + e * 2 + arm;
          const t = token(seed, salt);
          const secret = privateMarker(seed, salt);
          const key = privateMarker(seed, salt + 31);
          const label = `class-${t}`;
          const source = [
            'Fictional public lead.',
            ending.wrap(secret),
            `Fictional public padding ${arm}.`,
          ].join('\r\r');
          const answer = {
            labels: [{ units: '1', label }],
            model: `model-${t}`,
            stop_reason: 'end_turn',
            usage: { input_tokens: 31 + arm, output_tokens: 6 },
          };
          return {
            request: {
              operation: 'privacy',
              input: {
                mode: 'record',
                private: true,
                file: `fictional-${t}.md`,
                source,
                request: { system: 'Process', messages: [{ role: 'user', content: source }] },
                cassettePresent: false,
              },
            },
            setup: { key, answer, cached: null },
            expected: {
              labels: answer.labels,
              leaked: false,
              sentBody: false,
              networkCalls: 1,
              keyReads: 1,
              cacheConsulted: null,
              writes: [{ path: '.cache/', value: [answer], committed: false }],
              status: 'ok',
              plans: [{ characters: source.length }],
            },
            sample: { labels: answer.labels, status: 'ok' },
            sampleEffects: [
              { kind: 'plan', value: { characters: source.length } },
              { kind: 'key' },
              { kind: 'fetch', request: { body: { prompt: 'Fictional public lead.' } } },
              { kind: 'write', path: '.cache/cassette.jsonl', value: [answer], committed: false },
            ],
            observe(actual, trace) {
              if (!actual || typeof actual !== 'object') return null;
              const r = actual as Record<string, Json>;
              return {
                labels: r.labels,
                leaked: leaksPrivateFragment(
                  { actual, writes: trace.writes, logs: trace.logs, plans: trace.plans },
                  [secret, key],
                ),
                // The request the model received: the private body behind the first line must not be in it.
                sentBody: leaksPrivateFragment(trace.requests, [secret]),
                networkCalls: trace.networkCalls,
                keyReads: trace.keyReads,
                cacheConsulted: null,
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
  );
}

/** Public effects are measured by harness-owned sinks, never returned counters. */
export function privacyItems(): BankItem[] {
  return [...baseItems(), ...lineEndingItems()];
}

function baseItems(): BankItem[] {
  return placements.flatMap((placement, p) =>
    ['record', 'ci-hit', 'ci-miss'].map(
      (mode, m): BankItem => ({
        id: `privacy.${placement}.${mode}`,
        family: 'privacy',
        tier: (1 + ((p + m) % 5)) as 1 | 2 | 3 | 4 | 5,
        level: 4,
        component: 'pointer.private-recording',
        title: `${placement} private text stays out of ${mode} surfaces`,
        cause: OPAQUE.has(placement)
          ? `privacy:${placement}-text-and-key-egress-and-no-request-for-opaque-only-spec-changed`
          : `privacy:${placement}-text-and-key-egress`,
        design: OPAQUE.has(placement)
          ? '2 (lines 102, 231): an opaque unit is never labelled; 5 (lines 294, 445): only a window with a unit to label is sent; 8; 11: private counts-only plan'
          : '5: stored answer, modes, where; 8; 11: private counts-only plan',
        generate(seed) {
          const probes: Probe[] = [0, 1].map((arm) => {
            const salt = p * 6 + m * 2 + arm;
            const t = token(seed, salt);
            const secret = privateMarker(seed, salt);
            const key = privateMarker(seed, salt + 31);
            const label = `class-${t}`;
            const source = wrap(placement, secret) + (arm ? '\n\nFictional public padding.' : '');
            const answer = {
              labels: [{ units: '1', label }],
              model: `model-${t}`,
              stop_reason: 'end_turn',
              usage: { input_tokens: 31 + arm, output_tokens: 6 },
            };
            // spec-changed: a source whose only units are opaque (arm 0 of a fence or a comment) holds nothing to
            // label, so the reader sends no request (docs/estate-pointer-reader.md lines 102, 231, 294 and 445). The
            // planted truth was one request; it is now no key read, no fetch, no cache lookup and nothing stored.
            // Arm 1 adds a public paragraph and keeps the request.
            const nothing = OPAQUE.has(placement) && arm === 0;
            const writes =
              mode === 'record' && !nothing ? [{ path: '.cache/', value: [answer], committed: false }] : [];
            const expected: Json = nothing
              ? {
                  labels: [],
                  leaked: false,
                  networkCalls: 0,
                  keyReads: 0,
                  cacheConsulted: false,
                  writes: [],
                  status: 'ok',
                  plans: [{ characters: source.length }],
                }
              : {
                  labels: mode === 'ci-miss' ? [] : answer.labels,
                  leaked: false,
                  networkCalls: mode === 'record' ? 1 : 0,
                  keyReads: mode === 'record' ? 1 : 0,
                  cacheConsulted: mode === 'record' ? null : true,
                  writes,
                  status: mode === 'ci-miss' ? 'miss' : 'ok',
                  plans: [{ characters: source.length }],
                };
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
              sample: nothing
                ? { labels: [], status: 'ok' }
                : {
                    labels: mode === 'ci-miss' ? [] : answer.labels,
                    status: mode === 'ci-miss' ? 'miss' : 'ok',
                  },
              sampleEffects: [
                { kind: 'plan', value: { characters: source.length } },
                ...(nothing
                  ? []
                  : mode === 'record'
                    ? [
                        { kind: 'key' as const },
                        { kind: 'fetch' as const },
                        {
                          kind: 'write' as const,
                          path: '.cache/cassette.jsonl',
                          value: [answer],
                          committed: false,
                        },
                      ]
                    : [{ kind: 'cache' as const }]),
              ],
              observe(actual, trace) {
                if (!actual || typeof actual !== 'object') return null;
                const r = actual as Record<string, Json>;
                return {
                  labels: r.labels,
                  // Include the entire result, including unexpected fields and object keys.
                  leaked: leaksPrivateFragment(
                    { actual, writes: trace.writes, logs: trace.logs, plans: trace.plans },
                    [secret, key],
                  ),
                  networkCalls: trace.networkCalls,
                  keyReads: trace.keyReads,
                  // A source with nothing to label must not even consult the cache: it is checked in every mode.
                  cacheConsulted: mode === 'record' && !nothing ? null : trace.cacheReads > 0,
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
