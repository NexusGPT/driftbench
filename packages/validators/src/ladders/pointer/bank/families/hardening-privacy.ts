import { leaksPrivateFragment, privateMarker } from '../../blind/bank/privacy';
import { liveByText } from '../../kit/estate';
import { PROBE_YAML } from '../../kit/sets';
import { fakeTransport } from '../../kit/transport';
import { headingText, Prose } from '../../kit/words';
import type { SourceFile } from '../../sut/port';
import { fail, type ItemContext, pass, type Run } from '../types';

/**
 * The runners of the comment privacy items (`specs/hardening-privacy.ts`): the rule that no comment text reaches
 * a labeler request. The private marker is the blind bank's seeded private-use alphabet, so the check is the
 * exact marker the item generated, never a pattern on prose. The text around the comment is seeded prose the
 * item wrote, found in the request by the exact text it wrote.
 */

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);

/** A sentence cut at a seeded word boundary, away from both ends: the text before and after a comment. */
function halves(ctx: ItemContext, sentence: string): { head: string; tail: string } {
  const words = sentence.split(' ');
  const at = 2 + Math.floor(ctx.rng() * Math.max(1, words.length - 4));
  return { head: words.slice(0, at).join(' '), tail: words.slice(at).join(' ') };
}

type Placed = {
  /** The file text, one file. */
  text: string;
  /** The plain sentence of the file, which no comment touches. */
  plain: string;
  /** The text of the unit that holds the comment, outside the comment: each must be in a request. */
  around: string[];
};

/** The decoded and the raw body of each request, so an escaped character is read as the character. */
const bodiesOf = (calls: ReadonlyArray<{ body: string }>): string[] =>
  calls.flatMap((call) => [
    call.body,
    call.body.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    ),
  ]);

async function judge(ctx: ItemContext, build: (p: Prose, marker: string) => Placed, salt: number) {
  const marker = privateMarker(ctx.seed, salt);
  const p = prose(ctx);
  const placed = build(p, marker);
  const files: SourceFile[] = [{ path: 'harbour/notes.md', text: placed.text }];
  const fake = fakeTransport();
  const res = await ctx.sut.scan({
    files,
    labelsYaml: PROBE_YAML,
    model: { arm: 'haiku', transport: fake },
    cassette: { mode: 'record' },
  });
  if (!res.ok || !res.ledger) return fail(`the scan failed: ${res.error ?? 'no ledger'}`);
  if (!liveByText(res.ledger, placed.plain))
    return fail('positive witness: the plain sentence of the file is not a live unit of the ledger');
  if (fake.count === 0)
    return fail('no request left: a reader that sends nothing holds no marker, so it proves nothing');
  const bodies = bodiesOf(fake.calls);
  if (!bodies.some((body) => body.includes(placed.plain)))
    return fail('positive witness: no request holds the plain sentence of the file');
  if (leaksPrivateFragment(bodies, [marker]))
    return fail(`the text of a comment reached a request (${fake.count} requests sent)`);
  const missing = placed.around.find((text) => !bodies.some((body) => body.includes(text)));
  if (missing !== undefined)
    return fail(
      `the text around the comment is in no request: ${JSON.stringify(missing)}; the rest of the unit is sent, only the comment is replaced`,
    );
  return pass(`${fake.count} requests held none of the comment and all of the text around it`);
}

/** A label set with a link kind that names the atoms of the kind `instruction`. */
const LINK_YAML = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    links:
      - name: topic
        description: The instruction the unit is about.
        to: [instruction]
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        links: [topic]
        atom: { kind: instruction, polarity: obligation }
`;

/**
 * The atom of a sentence that holds a comment, as the real scan builds it: its title is the text of its unit,
 * comment included, and its id is a slug of that title, so both carry the comment. It is handed to the scan as
 * a candidate of the link kind; the request that asks for the labels of a second file must list it without the
 * comment. The words around the comment, or a hashed id, show that the candidate is listed at all.
 */
async function linkCandidate(ctx: ItemContext) {
  const marker = privateMarker(ctx.seed, 15);
  const p = prose(ctx);
  const { head, tail } = halves(ctx, p.next());
  const other = p.next();
  const title = `${head} <!-- ${marker} --> ${tail}`;
  const atom = { id: `instruction.${title.toLowerCase().replace(/\s+/g, '-')}`, kind: 'instruction', title };
  const fake = fakeTransport({ truth: () => 'none' });
  const res = await ctx.sut.scan({
    files: [
      { path: 'harbour/first.md', text: `${title}\n` },
      { path: 'harbour/second.md', text: `${other}\n` },
    ],
    labelsYaml: LINK_YAML,
    model: { arm: 'haiku', transport: fake },
    cassette: { mode: 'record' },
    atoms: [atom],
  });
  if (!res.ok || !res.ledger) return fail(`the scan failed: ${res.error ?? 'no ledger'}`);
  if (!liveByText(res.ledger, other))
    return fail('positive witness: the sentence of the second file is not a live unit of the ledger');
  const bodies = bodiesOf(fake.calls);
  const asked = bodiesOf(fake.calls.filter((call) => call.body.includes(other)));
  if (asked.length === 0) return fail('no request left for the second file: it proves nothing');
  if (!asked.some((body) => body.includes(head) || body.includes(tail) || /atom-[0-9a-f]{10}/.test(body)))
    return fail(
      'positive witness: the request for the second file lists no candidate: neither the words around the comment nor a hashed id',
    );
  if (leaksPrivateFragment(bodies, [marker]))
    return fail(`the text of a comment reached a request as a link candidate (${fake.count} requests sent)`);
  return pass(`${fake.count} requests: the candidate is listed and none holds a character of the comment`);
}

export const privacyCommentRuns: Record<string, Run> = {
  'comment-text-never-leaves-link-candidate': linkCandidate,
  'comment-text-never-leaves-inline': (ctx) =>
    judge(
      ctx,
      (p, marker) => {
        const plain = p.next();
        const { head, tail } = halves(ctx, p.next());
        return {
          text: `${plain}\n\n${head} <!-- ${marker} --> ${tail}\n`,
          plain,
          around: [head, tail],
        };
      },
      11,
    ),
  'comment-text-never-leaves-eol': (ctx) =>
    judge(
      ctx,
      (p, marker) => {
        const plain = p.next();
        const { head, tail } = halves(ctx, p.next());
        return { text: `${plain}\n\n${head} <!-- ${marker} -->\n${tail}\n`, plain, around: [head, tail] };
      },
      12,
    ),
  'comment-text-never-leaves-heading': (ctx) =>
    judge(
      ctx,
      (p, marker) => {
        const title = headingText(p.random);
        const plain = p.next();
        return { text: `# ${title} <!-- ${marker} -->\n\n${plain}\n`, plain, around: [title] };
      },
      13,
    ),
  'comment-text-never-leaves-table': (ctx) =>
    judge(
      ctx,
      (p, marker) => {
        const plain = p.next();
        const { head, tail } = halves(ctx, p.next());
        const other = headingText(p.random);
        return {
          text: `${plain}\n\n| Item | Rule |\n| --- | --- |\n| ${head} <!-- ${marker} --> ${tail} | ${other} |\n`,
          plain,
          around: [head, tail],
        };
      },
      14,
    ),
};

/** The runners by family. */
export const HARDENING_PRIVACY_RUNS: Record<string, Record<string, Run>> = {
  privacy: privacyCommentRuns,
};
