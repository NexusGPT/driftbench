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

export const privacyCommentRuns: Record<string, Run> = {
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
