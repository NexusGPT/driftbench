import type { JudgeAnswer, JudgeRequest } from '@agent-nexus/driftbench-judges';
import { loadPool } from '../../pool';
import { type BankItem, fn, pick, type Tier } from '../bank';

/**
 * Evidence grounding: a judge's `evidence` must quote the data, never the rubric and never its own words. The
 * package exports `groundEvidence(request, answer)` returning `{ grounded, where? }`. A quote is grounded when,
 * after folding case, Unicode compatibility forms, typographic quotes and runs of white space, and after
 * stripping one pair of surrounding quotes, it is found inside one data place: a transcript entry
 * (`transcript.<index>`), the artifact (`artifact`) or the Given (`given`, its JSON). A quote with an ellipsis
 * ("...") is grounded when each part is found, in order, in the same place. An absent or empty quote is not
 * grounded. A quote found only in the criterion text is not grounded. A quote matches on word boundaries
 * (it starts and ends where a word does), and tool names are not text: only entry text, the artifact and the
 * Given are quotable. When a quote is found in several places, `where` names the first: transcript entries in
 * order, then the artifact, then the Given.
 */

const COMPONENT = 'packages/judges/src/contract.ts';
type Ground = (request: JudgeRequest, answer: JudgeAnswer) => { grounded: boolean; where?: string };

/** The folding of the spec: compatibility forms, case, typographic quotes, white space. */
export function fold(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first place holding the quote, by the spec: the oracle of every grounded case. */
export function firstPlace(request: JudgeRequest, evidence: string): string | undefined {
  let quote = fold(evidence);
  if (/^".*"$/.test(quote)) quote = quote.slice(1, -1).trim();
  if (quote === '') return undefined;
  const parts = quote.split(/\s*\.\.\.\s*/).filter(Boolean);
  const places: [string, string][] = [
    ...request.transcript.map((e, i): [string, string] => [`transcript.${i}`, e.text]),
    ...(request.artifact === undefined ? [] : [['artifact', request.artifact] as [string, string]]),
    ...(request.given === undefined ? [] : [['given', JSON.stringify(request.given)] as [string, string]]),
  ];
  const at = (hay: string, needle: string, from: number) => {
    for (let i = hay.indexOf(needle, from); i >= 0; i = hay.indexOf(needle, i + 1)) {
      const before = hay[i - 1];
      const after = hay[i + needle.length];
      const word = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
      if (!(word(before) && word(needle[0])) && !(word(after) && word(needle[needle.length - 1]))) return i;
    }
    return -1;
  };
  for (const [where, text] of places) {
    const hay = fold(text);
    let from = 0;
    let ok = true;
    for (const part of parts) {
      const i = at(hay, part, from);
      if (i < 0) {
        ok = false;
        break;
      }
      from = i + part.length;
    }
    if (ok) return where;
  }
  return undefined;
}

type Case = (
  request: JudgeRequest,
  random: () => number,
) => { request?: JudgeRequest; evidence?: string; grounded: boolean; where?: string } | undefined;

function words(text: string, random: () => number, count: number): string | undefined {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < count + 1) return undefined;
  const start = Math.floor(random() * (parts.length - count));
  return parts.slice(start, start + count).join(' ');
}

function withEntry(request: JudgeRequest, random: () => number, minWords: number) {
  const indices = request.transcript
    .map((e, i) => (e.role !== 'context' && e.text.split(/\s+/).length > minWords ? i : -1))
    .filter((i) => i >= 0);
  if (indices.length === 0) return undefined;
  const index = pick(random, indices);
  return { index, text: request.transcript[index]?.text ?? '' };
}

const CASES: readonly { id: string; tier: Tier; make: Case }[] = [
  {
    id: 'exact-quote',
    tier: 1,
    make: (q, r) => {
      const e = withEntry(q, r, 6);
      const w = e && words(e.text, r, 5);
      return w ? { evidence: w, grounded: true, where: `transcript.${e.index}` } : undefined;
    },
  },
  {
    id: 'extra-spaces',
    tier: 2,
    make: (q, r) => {
      const e = withEntry(q, r, 6);
      const w = e && words(e.text, r, 5);
      return w
        ? { evidence: w.replace(/ /g, '   '), grounded: true, where: `transcript.${e.index}` }
        : undefined;
    },
  },
  {
    id: 'surrounding-quotes',
    tier: 2,
    make: (q, r) => {
      const e = withEntry(q, r, 6);
      const w = e && words(e.text, r, 4);
      return w ? { evidence: `"${w}"`, grounded: true, where: `transcript.${e.index}` } : undefined;
    },
  },
  {
    id: 'typographic-quotes',
    tier: 3,
    make: (q, r) => {
      const e = withEntry(q, r, 6);
      const w = e && words(e.text, r, 4);
      return w ? { evidence: `“${w}”`, grounded: true, where: `transcript.${e.index}` } : undefined;
    },
  },
  {
    id: 'other-case',
    tier: 2,
    make: (q, r) => {
      const e = withEntry(q, r, 6);
      const w = e && words(e.text, r, 4);
      return w ? { evidence: w.toUpperCase(), grounded: true, where: `transcript.${e.index}` } : undefined;
    },
  },
  {
    id: 'ellipsis-in-order',
    tier: 3,
    make: (q, r) => {
      const e = withEntry(q, r, 12);
      if (!e) return undefined;
      const parts = e.text.split(/\s+/);
      return {
        evidence: `${parts.slice(0, 3).join(' ')} ... ${parts.slice(-3).join(' ')}`,
        grounded: true,
        where: `transcript.${e.index}`,
      };
    },
  },
  {
    id: 'ellipsis-out-of-order',
    tier: 4,
    make: (q, r) => {
      const e = withEntry(q, r, 12);
      if (!e) return undefined;
      const parts = e.text.split(/\s+/);
      return { evidence: `${parts.slice(-3).join(' ')} ... ${parts.slice(0, 3).join(' ')}`, grounded: false };
    },
  },
  {
    id: 'quote-from-rubric',
    tier: 2,
    make: (q) => ({ evidence: q.criterion.rubric.split(/\s+/).slice(0, 6).join(' '), grounded: false }),
  },
  {
    id: 'paraphrase',
    tier: 2,
    make: () => ({ evidence: 'the agent handled the matter in a satisfactory manner', grounded: false }),
  },
  { id: 'empty-quote', tier: 1, make: () => ({ evidence: '   ', grounded: false }) },
  { id: 'no-quote', tier: 1, make: () => ({ grounded: false }) },
  {
    id: 'across-two-entries',
    tier: 4,
    make: (q) => {
      const t = q.transcript.filter((e) => e.role !== 'context');
      const a = t[t.length - 2]?.text.split(/\s+/).slice(-2).join(' ');
      const b = t[t.length - 1]?.text.split(/\s+/).slice(0, 2).join(' ');
      return a && b ? { evidence: `${a} ${b}`, grounded: false } : undefined;
    },
  },
  {
    id: 'in-artifact',
    tier: 2,
    make: (q, r) => {
      const artifact = `File sheet.csv (csv)\nplan,price\nAcme Mobile M,${20 + Math.floor(r() * 30)}\n`;
      return {
        request: { ...q, artifact },
        evidence: artifact.split('\n')[2],
        grounded: true,
        where: 'artifact',
      };
    },
  },
  {
    id: 'in-given',
    tier: 3,
    make: (q) => ({
      request: { ...q, given: { stage: 'recap', ledger: { plan_id: 'fiber-300' } } },
      evidence: 'fiber-300',
      grounded: true,
      where: 'given',
    }),
  },
  {
    id: 'decomposed-accents',
    tier: 4,
    make: (q) => {
      const request = {
        ...q,
        transcript: [...q.transcript, { role: 'user' as const, text: 'My name is Renée Martínez.' }],
      };
      return {
        request,
        evidence: 'Renée Martínez',
        grounded: true,
        where: `transcript.${request.transcript.length - 1}`,
      };
    },
  },
  {
    id: 'fullwidth-digits',
    tier: 4,
    make: (q) => {
      const request = {
        ...q,
        transcript: [...q.transcript, { role: 'agent' as const, text: 'Your reference is LEAD-123456.' }],
      };
      return {
        request,
        evidence: 'LEAD-１２３４５６',
        grounded: true,
        where: `transcript.${request.transcript.length - 1}`,
      };
    },
  },
  {
    id: 'line-breaks-folded',
    tier: 3,
    make: (q, r) => {
      const e = withEntry(q, r, 6);
      const w = e && words(e.text, r, 5);
      return w
        ? { evidence: w.replace(/ /g, '\n'), grounded: true, where: `transcript.${e.index}` }
        : undefined;
    },
  },
  {
    id: 'quote-of-tool-name-only',
    tier: 3,
    make: () => ({
      evidence: 'catalog.search',
      grounded: false,
      request: {
        criterion: { name: 'c', rubric: 'r' },
        transcript: [{ role: 'tool_call', tool: 'catalog.search', text: '{}' }],
      },
    }),
  },
  {
    id: 'partial-word',
    tier: 4,
    make: () => ({
      evidence: 'cme Ca',
      grounded: false,
      request: {
        criterion: { name: 'c', rubric: 'r' },
        transcript: [{ role: 'agent', text: 'Acme Care can help.' }],
      },
    }),
  },
  {
    id: 'from-the-pass-picture',
    tier: 3,
    make: (q) => ({
      evidence: 'names Acme Care',
      grounded: false,
      request: {
        ...q,
        criterion: { ...q.criterion, pass: 'The reply names Acme Care.' },
        transcript: [{ role: 'agent', text: 'I refunded you.' }],
      },
    }),
  },
  {
    id: 'long-entry',
    tier: 3,
    make: (q, r) => {
      const text = `${'word '.repeat(20000)}needle phrase ${Math.floor(r() * 1e6)} here ${'word '.repeat(20000)}`;
      const request = {
        ...q,
        transcript: [...q.transcript, { role: 'tool_result' as const, tool: 'kb', text }],
      };
      return {
        request,
        evidence: text.match(/needle phrase \d+ here/)?.[0],
        grounded: true,
        where: `transcript.${request.transcript.length - 1}`,
      };
    },
  },
];

export function evidenceItems(): BankItem[] {
  return CASES.map(
    (c): BankItem => ({
      id: `evidence/${c.id}`,
      family: 'evidence',
      tier: c.tier,
      level: 'evidence',
      component: COMPONENT,
      async run({ api, root, random }) {
        const pool = await loadPool(root);
        for (let tries = 0; tries < 10; tries += 1) {
          const base = pick(random, pool.items).request;
          const made = c.make(base, random);
          if (!made) continue;
          const request = made.request ?? base;
          const answer: JudgeAnswer = {
            outcome: 'pass',
            reasoning: 'x',
            ...(made.evidence === undefined ? {} : { evidence: made.evidence }),
          };
          const got = fn<Ground>(api, 'groundEvidence')(request, answer);
          const expectedWhere =
            made.grounded && made.evidence !== undefined ? firstPlace(request, made.evidence) : undefined;
          if (made.grounded && expectedWhere === undefined)
            return {
              pass: false,
              detail: 'the oracle finds no place for its own quote: the item is miswritten',
            };
          if (
            !made.grounded &&
            made.evidence !== undefined &&
            firstPlace(request, made.evidence) !== undefined
          )
            continue;
          const ok = got.grounded === made.grounded && (!made.grounded || got.where === expectedWhere);
          return ok
            ? { pass: true, detail: '' }
            : {
                pass: false,
                detail: `evidence ${JSON.stringify(made.evidence?.slice(0, 80))}: expected grounded ${made.grounded}${expectedWhere ? ` at ${expectedWhere}` : ''}, got ${JSON.stringify(got)}`,
              };
        }
        return { pass: false, detail: 'no slice fits the case: the item is miswritten' };
      },
    }),
  );
}
