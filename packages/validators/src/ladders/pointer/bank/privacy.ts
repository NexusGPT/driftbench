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

/** Privacy scans inspect actual serialized surfaces, not an adapter's `private: true` claim. */
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
        cause: `privacy:${placement}-text-and-key-egress`,
        design: '5: stored answer, modes, where; 8; 11: private counts-only plan',
        generate(seed) {
          const probes: Probe[] = [0, 1].map((arm) => {
            const t = token(seed, p * 6 + m * 2 + arm);
            const secret = `FICTIONAL_PRIVATE_${t}_🪐`;
            const key = `FICTIONAL_KEY_${t}`;
            const label = `class-${t}`;
            const source = wrap(placement, secret);
            const answer = {
              labels: [{ units: '1', label }],
              model: `model-${t}`,
              stop_reason: 'end_turn',
              usage: { input_tokens: 31 + arm, output_tokens: 6 },
            };
            const expected: Json = {
              labels: mode === 'ci-miss' ? [] : answer.labels,
              leaked: [],
              networkCalls: mode === 'record' ? 1 : 0,
              keyReads: mode === 'record' ? 1 : 0,
              location: '.cache/',
              committed: false,
              status: mode === 'ci-miss' ? 'miss' : 'ok',
              // Counts are adapter observations, not a text copy in the plan.
              characters: source.length,
            };
            const sample: Json = {
              cassette: mode === 'ci-miss' ? [] : [answer],
              logs: [],
              plan: { characters: source.length },
              labels: mode === 'ci-miss' ? [] : answer.labels,
              networkCalls: mode === 'record' ? 1 : 0,
              keyReads: mode === 'record' ? 1 : 0,
              location: '.cache/',
              committed: false,
              status: mode === 'ci-miss' ? 'miss' : 'ok',
            };
            return {
              request: {
                operation: 'privacy',
                input: {
                  mode,
                  private: true,
                  file: `fictional-${t}.md`,
                  source,
                  apiKey: key,
                  request: { system: `Process ${secret}`, messages: [{ role: 'user', content: source }] },
                  answer,
                  cassettePresent: mode === 'ci-hit',
                },
              },
              expected,
              sample,
              observe(actual) {
                if (!actual || typeof actual !== 'object') return null;
                const r = actual as Record<string, Json>;
                if (
                  !Array.isArray(r.cassette) ||
                  !Array.isArray(r.logs) ||
                  !r.plan ||
                  typeof r.plan !== 'object'
                )
                  return null;
                const publicSurfaces = JSON.stringify({ cassette: r.cassette, logs: r.logs, plan: r.plan });
                return {
                  labels: r.labels,
                  leaked: [secret, key].filter((value) => publicSurfaces.includes(value)),
                  networkCalls: r.networkCalls,
                  keyReads: r.keyReads,
                  location: r.location,
                  committed: r.committed,
                  status: r.status,
                  characters: (r.plan as Record<string, Json>).characters,
                };
              },
            };
          });
          // ci-miss arms have different planted source lengths even if token lengths coincide.
          const last = probes[1];
          if (last && mode === 'ci-miss') {
            const input = last.request.input as Record<string, Json>;
            input.source = `${input.source}\n\nFictional public padding.`;
            const n = String(input.source).length;
            (last.expected as Record<string, Json>).characters = n;
            ((last.sample as Record<string, Json>).plan as Record<string, Json>).characters = n;
          }
          return { probes };
        },
      }),
    ),
  );
}
