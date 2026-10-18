import { pointer } from '@agent-nexus/driftbench-estate';
import { drawFor } from '../common';
import { type Style, styledAtSize } from '../styled';
import { type BankItem, levelOf, type Outcome, type Tier } from '../types';

/**
 * Items the independent audit of the cutter level asked for (validators/map/audit.md): each lazy shortcut
 * that kept every item green and each planted bug the level missed becomes an item (docs/validators.md
 * section 12.7). The oracles are the promises of docs/estate.md, "The pointer reader":
 *
 * - "A unit is a sentence, a list item, a table cell, a paragraph of a block quote, a heading or a value of
 *   the front matter. A fence or a comment is opaque";
 * - "Sentences are cut from the text with the inline code, the links and the emphasis marks masked";
 * - "the ledger follows a unit that is edited, moved, split or merged, and says when it is gone";
 * - "A label stays with its unit only while the set and the labelers that made it are the same".
 *
 * Every document is built by code from the seed with the sentences of the styled renderer, so each item
 * knows where every sentence, heading, value and fence sits.
 */

const CUT = 'packages/estate/src/pointer/cut.ts';
const LEDGER = 'packages/estate/src/pointer/ledger.ts';
const LEVEL = levelOf('cutter');

const PASS: Outcome = { pass: true, detail: 'held' };
const fail = (detail: string): Outcome => ({ pass: false, detail });

function item(meta: {
  id: string;
  family: string;
  tier: Tier;
  component: string;
  title: string;
  cause: string;
  run(seed: number): Outcome;
}): BankItem {
  return {
    id: `${meta.family}.${meta.id}`,
    family: meta.family,
    tier: meta.tier,
    level: LEVEL,
    component: meta.component,
    title: meta.title,
    cause: meta.cause,
    generate: () => [],
    check: () => ({ pass: false, detail: 'an item that drives its own runs' }),
    run: async (seed) => meta.run(seed),
  };
}

/**
 * Clear sentences of the renderer: planted rule anchors of a prose prompt that are one sentence each, end
 * with a full stop and start with a capital letter. A paragraph of them has no doubtful break.
 */
function sentences(seed: number, salt: string, count: number): string[] {
  const out: string[] = [];
  for (let round = 0; out.length < count && round < 6; round += 1) {
    const { rendered } = styledAtSize(
      { styles: ['prose'], seed: seed * 7 + round, salt: `${salt}-${round}` },
      {},
    );
    for (const entry of rendered.planted) {
      const anchor = (entry as { anchor?: string }).anchor ?? '';
      if (/^\p{Lu}[^\n.?!:;]*\.$/u.test(anchor) && anchor.length > 12 && !out.includes(anchor))
        out.push(anchor);
    }
  }
  if (out.length < count) throw new Error(`the bank found ${out.length} clear sentences, not ${count}`);
  const draw = drawFor(seed, `sentences:${salt}`);
  return draw.shuffle(out).slice(0, count);
}

/** The units whose span overlaps [start, end). */
const over = (units: readonly pointer.Unit[], start: number, end: number) =>
  units.filter((unit) => unit.start < end && unit.end > start);

// cutter-sentences: a paragraph of clear sentences is cut into one unit per sentence.
function sentenceItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const count of [2, 3, 4, 6])
    for (const layout of ['one-line', 'wrapped', 'two-paragraphs', 'after-heading', 'in-list-item'] as const)
      out.push(
        item({
          id: `sentences.${count}.${layout}`,
          family: 'cutter-sentences',
          tier: (count <= 3 ? 2 : 3) as Tier,
          component: CUT,
          title: `${count} clear sentences laid out ${layout.replace(/-/g, ' ')}: ${layout === 'in-list-item' ? 'the list item is one unit' : 'one unit per sentence, each its exact text'}`,
          cause: layout === 'in-list-item' ? 'cut:list-item-unit' : 'cut:one-unit-per-clear-sentence',
          run: (seed) => {
            const said = sentences(seed, `sentences-${count}-${layout}`, count);
            const paragraph =
              layout === 'wrapped'
                ? said
                    .join(' ')
                    .replace(/(.{1,48})(\s|$)/g, '$1\n')
                    .trim()
                : layout === 'two-paragraphs'
                  ? `${said.slice(0, Math.ceil(count / 2)).join(' ')}\n\n${said.slice(Math.ceil(count / 2)).join(' ')}`
                  : said.join(' ');
            const text =
              layout === 'after-heading'
                ? `# Rules\n\n${paragraph}\n`
                : layout === 'in-list-item'
                  ? `- ${paragraph}\n- Another item ends here.\n`
                  : `${paragraph}\n`;
            const units = pointer.cut(text).units.filter((unit) => unit.container !== 'heading');
            if (layout === 'in-list-item') {
              const items = units.filter((unit) => unit.container === 'list_item');
              return items.length === 2 &&
                items[0]?.text.includes(said[0] as string) &&
                items[0]?.text.includes(said.at(-1) as string)
                ? PASS
                : fail(
                    `the list items are ${JSON.stringify(units.map((unit) => [unit.container, unit.text.slice(0, 30)]))}`,
                  );
            }
            const norm = (value: string) => value.replace(/\s+/g, ' ').trim();
            const got = units.map((unit) => norm(unit.text));
            const want = said.map(norm);
            return got.join('\n') === want.join('\n')
              ? PASS
              : fail(`units ${JSON.stringify(got.map((t) => t.slice(0, 40)))}, expected one per sentence`);
          },
        }),
      );
  return out;
}

// cutter-structure: headings, front matter values, block quotes, fences and comments are what the doc says.
function structureItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const depth of [1, 2, 3, 4])
    for (const variant of ['atx', 'atx-closed'] as const)
      out.push(
        item({
          id: `structure.heading.h${depth}.${variant}`,
          family: 'cutter-structure',
          tier: 2,
          component: CUT,
          title: `a level ${depth} ${variant === 'atx' ? '' : 'closed '}heading is a heading unit of its own, and the paragraph under it is not part of it`,
          cause: 'cut:heading-unit',
          run: (seed) => {
            const [title, body] = sentences(seed, `heading-${depth}-${variant}`, 2) as [string, string];
            const marks = '#'.repeat(depth);
            const line = `${marks} ${title.replace(/\.$/, '')}${variant === 'atx-closed' ? ` ${marks}` : ''}`;
            const text = `${line}\n\n${body}\n`;
            const units = pointer.cut(text).units;
            const heads = units.filter((unit) => unit.container === 'heading');
            const first = heads[0];
            if (heads.length !== 1 || !first) return fail(`${heads.length} heading units`);
            if (first.end > line.length) return fail('the heading unit runs past its line');
            return units.some((unit) => unit.container !== 'heading' && unit.text.includes(body))
              ? PASS
              : fail('the paragraph under the heading is no unit of its own');
          },
        }),
      );
  for (const keys of [1, 2, 3])
    for (const quoting of ['plain', 'double', 'single'] as const)
      out.push(
        item({
          id: `structure.front-matter.${keys}.${quoting}`,
          family: 'cutter-structure',
          tier: 3,
          component: CUT,
          title: `front matter with ${keys} ${quoting} scalar value${keys > 1 ? 's' : ''}: each value is a front_matter_value unit with its YAML path, and the body starts after it`,
          cause: 'cut:front-matter-values',
          run: (seed) => {
            const values = sentences(seed, `fm-${keys}-${quoting}`, keys + 1);
            const body = values.pop() as string;
            const quote = (value: string) =>
              quoting === 'double' ? `"${value}"` : quoting === 'single' ? `'${value}'` : value;
            const lines = values.map((value, index) => `key${index}: ${quote(value)}`);
            const text = `---\n${lines.join('\n')}\n---\n\n${body}\n`;
            const units = pointer.cut(text).units;
            for (const [index, value] of values.entries()) {
              const unit = units.find(
                (each) => each.container === 'front_matter_value' && each.key === `$.key${index}`,
              );
              if (!unit) return fail(`no front_matter_value unit at $.key${index}`);
              if (
                text.slice(unit.start, unit.end) !== unit.text ||
                !unit.text.includes(value.replace(/\.$/, ''))
              )
                return fail(`the unit at $.key${index} is "${unit.text}"`);
            }
            return units.some((unit) => unit.container === 'sentence' && unit.text === body)
              ? PASS
              : fail('the body sentence is no unit of its own');
          },
        }),
      );
  for (const paragraphs of [1, 2, 3])
    out.push(
      item({
        id: `structure.block-quote.${paragraphs}`,
        family: 'cutter-structure',
        tier: 2,
        component: CUT,
        title: `a block quote of ${paragraphs} paragraph${paragraphs > 1 ? 's' : ''}: one block_quote unit per paragraph`,
        cause: 'cut:block-quote-paragraph-unit',
        run: (seed) => {
          const said = sentences(seed, `quote-${paragraphs}`, paragraphs + 1);
          const after = said.pop() as string;
          const text = `${said.map((one) => `> ${one}`).join('\n>\n')}\n\n${after}\n`;
          const quotes = pointer.cut(text).units.filter((unit) => unit.container === 'block_quote');
          return quotes.length === paragraphs && said.every((one, index) => quotes[index]?.text.includes(one))
            ? PASS
            : fail(
                `${quotes.length} block_quote units: ${JSON.stringify(quotes.map((unit) => unit.text.slice(0, 30)))}`,
              );
        },
      }),
    );
  const opaque: Array<{ id: string; wrap(inner: string): string }> = [
    { id: 'backtick-fence', wrap: (inner) => `\`\`\`\n${inner}\n\`\`\`` },
    { id: 'tilde-fence', wrap: (inner) => `~~~\n${inner}\n~~~` },
    { id: 'fence-with-language', wrap: (inner) => `\`\`\`yaml\n${inner}\n\`\`\`` },
    { id: 'html-comment', wrap: (inner) => `<!-- ${inner} -->` },
    { id: 'indented-in-list', wrap: (inner) => `- Item one ends here.\n\n  \`\`\`\n  ${inner}\n  \`\`\`` },
  ];
  for (const shape of opaque)
    out.push(
      item({
        id: `structure.opaque.${shape.id}`,
        family: 'cutter-structure',
        tier: 3,
        component: CUT,
        title: `text inside a ${shape.id.replace(/-/g, ' ')} is opaque: no sentence or list unit holds any of it`,
        cause: 'cut:fences-and-comments-opaque',
        run: (seed) => {
          const [before, inner, after] = sentences(seed, `opaque-${shape.id}`, 3) as [string, string, string];
          const text = `${before}\n\n${shape.wrap(inner)}\n\n${after}\n`;
          const at = text.indexOf(inner);
          const leak = over(pointer.cut(text).units, at, at + inner.length).find(
            (unit) => unit.container !== 'opaque',
          );
          return leak
            ? fail(`a ${leak.container} unit holds the opaque text: "${leak.text.slice(0, 50)}"`)
            : PASS;
        },
      }),
    );
  return out;
}

// cutter-masks: a stop inside inline code, link text or a link destination, or inside emphasis, ends nothing.
function maskItems(): BankItem[] {
  const out: BankItem[] = [];
  const bare = (text: string) => text.replace(/\.$/, '');
  const shapes: Array<{ id: string; make(a: string, b: string, stop: string): string }> = [
    { id: 'inline-code', make: (a, b, stop) => `\`${bare(a)}${stop} ${bare(b)}\`` },
    { id: 'double-backtick-code', make: (a, b, stop) => `\`\`${bare(a)}${stop} ${bare(b)}\`\`` },
    { id: 'link-text', make: (a, b, stop) => `[${bare(a)}${stop} ${bare(b)}](https://example.org/help)` },
    { id: 'link-destination', make: (a, _b, stop) => `[${bare(a)}](https://example.org/a${stop}b/c.d)` },
  ];
  for (const shape of shapes)
    for (const place of ['middle', 'end'] as const)
      for (const stop of ['.', '?', '!'] as const)
        out.push(
          item({
            id: `masks.${shape.id}.${place}.${stop === '.' ? 'full-stop' : stop === '?' ? 'question' : 'exclamation'}`,
            family: 'cutter-masks',
            tier: shape.id.startsWith('link') ? 3 : 2,
            component: CUT,
            title: `a "${stop}" inside ${shape.id.replace(/-/g, ' ')} at the ${place} of a sentence ends no unit there`,
            cause: `cut:mask-${shape.id}`,
            run: (seed) => {
              const [lead, a, b, next] = sentences(seed, `mask-${shape.id}-${place}-${stop}`, 4) as [
                string,
                string,
                string,
                string,
              ];
              const inline = shape.make(a, b, stop);
              const sentence =
                place === 'middle' ? `${bare(lead)} with ${inline} now.` : `${bare(lead)} ${inline}.`;
              const text = `${sentence} ${next}\n`;
              const at = text.indexOf(inline);
              const inside = pointer
                .cut(text)
                .units.find((unit) => unit.start > at && unit.start < at + inline.length);
              return inside
                ? fail(`a unit starts inside "${inline.slice(0, 60)}": "${inside.text.slice(0, 40)}"`)
                : PASS;
            },
          }),
        );
  return out;
}

// cutter-ledger-follow: the ledger follows a unit edited, moved, split or merged, says when it is gone, and
// keeps a label only while the unit and its context are the same.
function ledgerItems(): BankItem[] {
  type Files = Array<{ path: string; text: string }>;
  const cutFiles = (files: Files) => files.map((file) => ({ path: file.path, cut: pointer.cut(file.text) }));
  const idAt = (
    ledger: pointer.NextLedger,
    files: Files,
    path: string,
    needle: string,
  ): string | undefined => {
    const file = files.find((each) => each.path === path);
    if (!file) return undefined;
    const units = pointer.cut(file.text).units;
    const index = units.findIndex((unit) => unit.text.includes(needle));
    return index < 0 ? undefined : ledger.ids.get(pointer.unitKey(path, index));
  };
  type Case = {
    id: string;
    tier: Tier;
    title: string;
    cause: string;
    run(said: string[]): Outcome;
  };
  const doc = (said: string[]) => said.map((one) => `${one}\n`).join('\n');
  const cases: Case[] = [
    {
      id: 'edited',
      tier: 3,
      title: 'a sentence edited by one word keeps its ledger id, and its neighbours keep theirs',
      cause: 'ledger:follow-edited-unit',
      run: (said) => {
        const before = [{ path: 'a.md', text: doc(said) }];
        const target = said[2] as string;
        const edited = target.replace(/ (\S+)\.$/, ' $1 today.');
        const after = [{ path: 'a.md', text: doc(said.map((one) => (one === target ? edited : one))) }];
        const one = pointer.nextLedger(cutFiles(before), undefined, 'k');
        const two = pointer.nextLedger(cutFiles(after), one.ledger, 'k');
        const a = idAt(one, before, 'a.md', target);
        const b = idAt(two, after, 'a.md', edited);
        if (!a || a !== b) return fail(`the edited sentence had ${a} and has ${b}`);
        return said
          .filter((one) => one !== target)
          .every((other) => idAt(one, before, 'a.md', other) === idAt(two, after, 'a.md', other))
          ? PASS
          : fail('a neighbour changed id');
      },
    },
    {
      id: 'moved-file',
      tier: 4,
      title: 'a sentence moved to another file keeps its ledger id',
      cause: 'ledger:follow-moved-unit',
      run: (said) => {
        const target = said[1] as string;
        const before = [
          { path: 'a.md', text: doc(said) },
          { path: 'b.md', text: doc(['The other file starts here.']) },
        ];
        const after = [
          { path: 'a.md', text: doc(said.filter((one) => one !== target)) },
          { path: 'b.md', text: doc(['The other file starts here.', target]) },
        ];
        const one = pointer.nextLedger(cutFiles(before), undefined, 'k');
        const two = pointer.nextLedger(cutFiles(after), one.ledger, 'k');
        const a = idAt(one, before, 'a.md', target);
        const b = idAt(two, after, 'b.md', target);
        return a && a === b ? PASS : fail(`the moved sentence had ${a} and has ${b}`);
      },
    },
    {
      id: 'deleted',
      tier: 2,
      title: 'a sentence deleted is marked deleted in the ledger, and no live unit keeps its id',
      cause: 'ledger:mark-deleted',
      run: (said) => {
        const target = said[3] as string;
        const before = [{ path: 'a.md', text: doc(said) }];
        const after = [{ path: 'a.md', text: doc(said.filter((one) => one !== target)) }];
        const one = pointer.nextLedger(cutFiles(before), undefined, 'k');
        const two = pointer.nextLedger(cutFiles(after), one.ledger, 'k');
        const id = idAt(one, before, 'a.md', target);
        const entry = two.ledger.entries.find((each) => each.id === id);
        if (entry?.status !== 'deleted')
          return fail(`the deleted sentence's entry is ${entry?.status ?? 'absent'}`);
        return [...two.ids.values()].includes(id as string)
          ? fail('a live unit still has the deleted id')
          : PASS;
      },
    },
    {
      id: 'same-text-two-files',
      tier: 3,
      title: 'one sentence written in two files gives two distinct ledger ids',
      cause: 'ledger:id-holds-the-path',
      run: (said) => {
        const files = [
          { path: 'a.md', text: doc(said.slice(0, 3)) },
          { path: 'b.md', text: doc(said.slice(0, 3)) },
        ];
        const one = pointer.nextLedger(cutFiles(files), undefined, 'k');
        const a = idAt(one, files, 'a.md', said[0] as string);
        const b = idAt(one, files, 'b.md', said[0] as string);
        return a && b && a !== b ? PASS : fail(`the two copies have ids ${a} and ${b}`);
      },
    },
    {
      id: 'same-text-twice',
      tier: 3,
      title: 'one sentence written twice in one file gives two distinct ledger ids',
      cause: 'ledger:id-holds-the-occurrence',
      run: (said) => {
        const files = [
          { path: 'a.md', text: doc([said[0] as string, said[1] as string, said[0] as string]) },
        ];
        const one = pointer.nextLedger(cutFiles(files), undefined, 'k');
        const ids = [...one.ids.values()];
        return new Set(ids).size === ids.length ? PASS : fail(`ids ${ids.join(', ')} repeat`);
      },
    },
    {
      id: 'split',
      tier: 4,
      title:
        'a sentence split in two keeps its ledger id on the first piece, and the second piece gets a new id',
      cause: 'ledger:follow-split-unit',
      run: (said) => {
        const target = said[1] as string;
        const words = target.replace(/\.$/, '').split(' ');
        const half = Math.ceil(words.length / 2);
        const first = `${words.slice(0, half).join(' ')}.`;
        const second = `${words
          .slice(half)
          .join(' ')
          .replace(/^./, (c) => c.toUpperCase())}.`;
        const before = [{ path: 'a.md', text: doc(said) }];
        const after = [
          {
            path: 'a.md',
            text: doc(said.flatMap((one) => (one === target ? [`${first} ${second}`] : [one]))),
          },
        ];
        const one = pointer.nextLedger(cutFiles(before), undefined, 'k');
        const two = pointer.nextLedger(cutFiles(after), one.ledger, 'k');
        const a = idAt(one, before, 'a.md', target);
        const b = idAt(two, after, 'a.md', first);
        const c = idAt(two, after, 'a.md', second);
        return a && a === b && c && c !== a ? PASS : fail(`before ${a}, first piece ${b}, second piece ${c}`);
      },
    },
    {
      id: 'label-kept',
      tier: 3,
      title: 'a label on a unit whose text and neighbours did not change stays with it',
      cause: 'ledger:label-carry-unchanged',
      run: (said) => {
        const files = [{ path: 'a.md', text: doc(said) }];
        const one = pointer.nextLedger(cutFiles(files), undefined, 'k');
        const id = idAt(one, files, 'a.md', said[2] as string);
        const entry = one.ledger.entries.find((each) => each.id === id);
        if (!entry) return fail('no entry');
        entry.labels.rules = { label: 'rule', setHash: 'set-1', labeler: 'lab-1', source: 'abc' };
        const two = pointer.nextLedger(cutFiles(files), one.ledger, 'k');
        return two.ledger.entries.find((each) => each.id === id)?.labels.rules?.label === 'rule'
          ? PASS
          : fail('the label of an unchanged unit was dropped');
      },
    },
    {
      id: 'label-dropped-on-edit',
      tier: 3,
      title: 'a label on a unit whose text changed does not stay with it',
      cause: 'ledger:label-dropped-on-change',
      run: (said) => {
        const before = [{ path: 'a.md', text: doc(said) }];
        const target = said[2] as string;
        const edited = target.replace(/ (\S+)\.$/, ' $1 today.');
        const after = [{ path: 'a.md', text: doc(said.map((one) => (one === target ? edited : one))) }];
        const one = pointer.nextLedger(cutFiles(before), undefined, 'k');
        const id = idAt(one, before, 'a.md', target);
        const entry = one.ledger.entries.find((each) => each.id === id);
        if (!entry) return fail('no entry');
        entry.labels.rules = { label: 'rule', setHash: 'set-1', labeler: 'lab-1', source: 'abc' };
        const two = pointer.nextLedger(cutFiles(after), one.ledger, 'k');
        const kept = two.ledger.entries.find((each) => each.id === id)?.labels.rules;
        return kept ? fail('the label stayed on a unit whose text changed') : PASS;
      },
    },
  ];
  const out: BankItem[] = [];
  for (const c of cases)
    for (const size of [5, 8, 12])
      out.push(
        item({
          id: `ledger-follow.${c.id}.${size}`,
          family: 'cutter-ledger-follow',
          tier: c.tier,
          component: LEDGER,
          title: `${c.title} (a file of ${size} sentences)`,
          cause: c.cause,
          run: (seed) => c.run(sentences(seed, `ledger-${c.id}-${size}`, size)),
        }),
      );
  return out;
}

// cutter-growth: the time to cut grows linearly with the text (a quadratic pass is a failing item).
function growthItems(): BankItem[] {
  const out: BankItem[] = [];
  const styles: Style[][] = [
    ['prose'],
    ['markdown'],
    ['table'],
    ['nested', 'question'],
    ['numbered', 'conditional'],
  ];
  for (const s of styles)
    for (const factor of [2, 4, 8, 16]) {
      out.push(
        item({
          id: `growth.${s.join('+')}.x${factor}`,
          family: 'cutter-growth',
          tier: factor <= 4 ? 3 : 4,
          component: CUT,
          title: `a ${s.join(' and ')} prompt ${factor} times larger takes at most ${factor * 2.5} times as long to cut (best of three)`,
          cause: 'cut:linear-time',
          run: (seed) => {
            const small =
              styledAtSize({ styles: s, seed, salt: 'growth', size: 25_000 }).rendered.sources.find((x) =>
                x.path.endsWith('.md'),
              )?.text ?? '';
            const large = Array.from({ length: factor }, () => small).join('\n\n');
            const time = (text: string) => {
              let best = Number.POSITIVE_INFINITY;
              for (let round = 0; round < 3; round += 1) {
                const started = performance.now();
                pointer.cut(text);
                best = Math.min(best, performance.now() - started);
              }
              return best;
            };
            const a = Math.max(time(small), 1);
            const b = time(large);
            return b <= a * factor * 2.5
              ? PASS
              : fail(
                  `${factor} times the text took ${(b / a).toFixed(1)} times as long (${Math.round(a)} ms to ${Math.round(b)} ms)`,
                );
          },
        }),
      );
    }
  return out;
}

/** Every item the audit of the cutter level asked for. */
export function cutterAuditItems(): BankItem[] {
  return [...sentenceItems(), ...structureItems(), ...maskItems(), ...ledgerItems(), ...growthItems()];
}
