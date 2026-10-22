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
      // The scan shows a comment to the labeler as its kind and first line (docs, section 2), so the first line
      // is public and the private text sits on the second.
      return `<!-- kept note\n${text} -->`;
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

/** A fence or a comment is opaque: the scan labels no unit of it and sends no text of it beyond its first line. */
const opaque = (placement: string): boolean => placement === 'fence' || placement === 'comment';

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

/** Public effects are measured by harness-owned sinks, never returned counters. */
export function privacyItems(): BankItem[] {
  return placements.flatMap((placement, p) =>
    ['record', 'ci-hit', 'ci-miss'].map(
      (mode, m): BankItem => ({
        id: `privacy.${placement}.${mode}`,
        family: 'privacy',
        tier: (1 + ((p + m) % 5)) as 1 | 2 | 3 | 4 | 5,
        level: 4,
        component: 'pointer.private-recording',
        title: `${placement} private text stays out of ${mode} surfaces`,
        // A fence-only or comment-only file has no labelable unit, so the scan sends no request and the privacy check
        // cannot fail. The fixture of those two placements carries a prose paragraph beside the opaque text, so a
        // request leaves, and the check reads that request: the opaque text and the key must not be in its body.
        cause: opaque(placement)
          ? 'privacy:opaque-only-file-sends-a-request'
          : `privacy:${placement}-text-and-key-egress`,
        design: '5: stored answer, modes, where; 8; 11: private counts-only plan',
        generate(seed) {
          const probes: Probe[] = [0, 1].map((arm) => {
            const salt = p * 6 + m * 2 + arm;
            const t = token(seed, salt);
            const secret = privateMarker(seed, salt);
            const key = privateMarker(seed, salt + 31);
            const label = `class-${t}`;
            const prose = `Fictional public note ${t}.`;
            const source =
              wrap(placement, secret) +
              (opaque(placement) ? `\n\n${prose}` : '') +
              (arm ? '\n\nFictional public padding.' : '');
            const answer = {
              labels: [{ units: '1', label }],
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
              ...(opaque(placement) ? { requestSent: true } : {}),
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
              sample: {
                labels: mode === 'ci-miss' ? [] : answer.labels,
                status: mode === 'ci-miss' ? 'miss' : 'ok',
                ...(opaque(placement) ? { requests: [{ text: prose }] } : {}),
              },
              sampleEffects: [
                { kind: 'plan', value: { characters: source.length } },
                ...(mode === 'record'
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
                const { requests, ...r } = actual as Record<string, Json>;
                // The request bodies the reader sent or would send. Where the text is labelable it is in them by
                // design, so they are read for the key; for an opaque placement they are read for the text too, and
                // a reader that sent no request fails.
                const sinks = { actual: r, writes: trace.writes, logs: trace.logs, plans: trace.plans };
                const leakedText = opaque(placement)
                  ? leaksPrivateFragment({ ...sinks, requests }, [secret, key])
                  : leaksPrivateFragment(sinks, [secret, key]) || leaksPrivateFragment(requests, [key]);
                return {
                  labels: r.labels,
                  // Include the entire result, including unexpected fields and object keys.
                  leaked: leakedText,
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
                  ...(opaque(placement)
                    ? { requestSent: Array.isArray(requests) && requests.length > 0 }
                    : {}),
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
