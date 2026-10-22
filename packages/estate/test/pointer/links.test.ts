import { describe, expect, it } from 'vitest';
import {
  blastRadius,
  classifyLinks,
  clearLink,
  createLink,
  cut,
  type Ledger,
  type Link,
  linkCoverage,
  nextLedger,
  verifyLink,
} from '../../src/pointer';

// Invented files: a depot of rules that tests link to.
const RULES = [
  'Count the crates twice before noon.',
  'Lock the gate when the yard is empty.',
  'Name the keeper of every crate.',
  'Return the keys before you leave.',
];
const file = (rules: readonly string[], head = 'Rules'): string => `# ${head}\n\n${rules.join('\n\n')}\n`;
const scan = (texts: Record<string, string>, previous?: Ledger): Ledger =>
  nextLedger(
    Object.entries(texts).map(([path, text]) => ({ path, cut: cut(text), text })),
    previous,
    'depot',
  ).ledger;
const idOf = (ledger: Ledger, quote: string): string => {
  const found = ledger.entries.find((entry) => entry.status === 'live' && entry.quote === quote);
  if (!found) throw new Error(`no unit ${quote}`);
  return found.id;
};
const label = (ledger: Ledger): Ledger => {
  for (const entry of ledger.entries)
    entry.labels.depot = { label: 'rule', setHash: 'h', labeler: 'l', source: 'none' };
  return ledger;
};

describe('a link', () => {
  const first = label(scan({ 'depot.md': file(RULES) }));
  const links = RULES.map((rule, at) =>
    createLink(first, `block-${at}`, idOf(first, rule), 'verifies', 'verified'),
  );

  it('holds its span, the fingerprint, the relation, who made it and whether it was accepted, and no position', () => {
    const [one] = links as [Link];
    expect(Object.keys(one).sort()).toEqual(['accepted', 'createdBy', 'fp', 'owner', 'relation', 'span']);
    expect(one.relation).toBe('verifies');
    expect(() => createLink(first, 'block', 'nosuchspan', 'verifies')).toThrow(RangeError);
  });

  it('is ok when the file is rewrapped, and suspect only for the unit that was reworded', () => {
    const rewrapped = scan(
      { 'depot.md': file(RULES).replace('Count the crates twice', 'Count the\ncrates twice') },
      first,
    );
    expect(classifyLinks(first, rewrapped, links)).toEqual(['ok', 'ok', 'ok', 'ok']);
    const reworded = scan({ 'depot.md': file(RULES).replace('Lock the gate', 'Bolt the gate') }, first);
    const states = classifyLinks(first, reworded, links);
    expect(states[1]).toBe('suspect');
    expect(states.filter((state) => state === 'suspect')).toHaveLength(1);
    // The neighbours of the edited unit keep their text and change their context.
    expect(states).toEqual(['advisory', 'suspect', 'advisory', 'ok']);
  });

  it('stays suspect on a later scan with no change, and is ok again once it is cleared with a reason', () => {
    const edited = scan({ 'depot.md': file(RULES).replace('Lock the gate', 'Bolt the gate') }, first);
    const again = scan({ 'depot.md': file(RULES).replace('Lock the gate', 'Bolt the gate') }, edited);
    expect(classifyLinks(edited, again, links)[1]).toBe('suspect');
    for (const reason of ['cosmetic', 'semantic-still-covered', 'test-updated']) {
      const cleared = clearLink(links[1] as Link, reason, again);
      expect(cleared.ok).toBe(true);
      if (!cleared.ok) continue;
      expect(cleared.link.reason).toBe(reason);
      expect(classifyLinks(again, again, [cleared.link])).toEqual(['ok']);
      expect(cleared.link.relation).toBe('verifies');
    }
    for (const reason of ['', 'whatever']) expect(clearLink(links[1] as Link, reason, again).ok).toBe(false);
  });

  it('is suspect when the span is deleted, and when its file is', () => {
    const deleted = scan({ 'depot.md': file(RULES.filter((_, at) => at !== 1)) }, first);
    expect(classifyLinks(first, deleted, links)).toEqual(['advisory', 'suspect', 'advisory', 'ok']);
    const gone = scan({ 'other.md': file(['A rule of another file.']) }, first);
    expect(classifyLinks(first, gone, links)).toEqual(['suspect', 'suspect', 'suspect', 'suspect']);
  });

  it('is ambiguous when the text of its span now stands in several places', () => {
    const other = RULES[1] as string;
    const copied = scan(
      {
        'depot.md': file(RULES.filter((rule) => rule !== other)),
        'a.md': file([other]),
        'b.md': file([other]),
      },
      first,
    );
    const states = classifyLinks(first, copied, links);
    expect(states[1]).toBe('ambiguous');
  });

  it('is not ambiguous because a twin existed before the edit', () => {
    const twinned = label(scan({ 'depot.md': file(RULES), 'twin.md': file([RULES[1] as string]) }));
    const link = createLink(twinned, 'block', idOf(twinned, RULES[1] as string), 'verifies', 'verified');
    const edited = scan({ 'depot.md': file(RULES), 'twin.md': file(['A reworded twin rule.']) }, twinned);
    expect(classifyLinks(twinned, edited, [link])).toEqual(['ok']);
  });

  it('gives the same states in any order', () => {
    const edited = scan({ 'depot.md': file(RULES).replace('Lock the gate', 'Bolt the gate') }, first);
    const forward = classifyLinks(first, edited, links);
    const backward = classifyLinks(first, edited, [...links].reverse()).reverse();
    expect(backward).toEqual(forward);
  });
});

describe('verification and coverage', () => {
  const first = label(scan({ 'depot.md': file(RULES) }));
  const spans = RULES.map((rule) => idOf(first, rule));

  it('counts a link toward a claim only after a mutation flipped its test', () => {
    const proposed = createLink(first, 'block', spans[0] as string, 'verifies');
    expect(verifyLink(proposed, { mutation: 'delete', flipped: false }).createdBy).toBe('proposed');
    expect(verifyLink(proposed, { mutation: 'delete', flipped: true }).createdBy).toBe('verified');
    expect(verifyLink(proposed, { mutation: 'negate', flipped: true }).createdBy).toBe('verified');
  });

  it('lists the mapped spans with no verified link, and leaves out the unmapped ones', () => {
    const links = [
      createLink(first, 'a', spans[0] as string, 'verifies', 'verified'),
      createLink(first, 'b', spans[1] as string, 'verifies', 'proposed'),
    ];
    const heading = first.entries.find((entry) => entry.quote === '# Rules');
    if (heading) heading.labels.depot = { label: 'description', setHash: 'h', labeler: 'l', source: 'none' };
    const covered = linkCoverage(first, ['rule', 'prohibition'], links);
    expect(covered.covered).toBe(1);
    expect(covered.uncovered).toEqual(spans.slice(1).sort());
  });
});

describe('the blast radius', () => {
  const first = label(scan({ 'depot.md': file(RULES) }));
  const links = [
    createLink(first, 'test-a', idOf(first, RULES[0] as string), 'verifies', 'verified'),
    createLink(first, 'test-b', idOf(first, RULES[1] as string), 'verifies', 'verified'),
    createLink(first, 'test-b', idOf(first, RULES[2] as string), 'verifies', 'verified'),
    createLink(first, 'test-c', idOf(first, RULES[3] as string), 'verifies', 'verified'),
  ];

  it('reruns the owners of suspect links once each, sorted, and reports the section apart', () => {
    const edited = scan(
      {
        'depot.md': file(RULES)
          .replace('Lock the gate', 'Bolt the gate')
          .replace('Name the keeper', 'Name the owner'),
      },
      first,
    );
    const radius = blastRadius(first, edited, links);
    expect(radius.rerun).toEqual(['test-b']);
    expect(radius.advisory).toEqual(['test-a', 'test-b', 'test-c']);
  });

  it('reruns nothing for a rewrap or a heading rename', () => {
    const rewrapped = scan(
      { 'depot.md': file(RULES).replace('Count the crates', 'Count the\ncrates') },
      first,
    );
    expect(blastRadius(first, rewrapped, links).rerun).toEqual([]);
    const renamed = scan({ 'depot.md': file(RULES, 'Duties') }, first);
    const radius = blastRadius(first, renamed, links);
    expect(radius.rerun).toEqual([]);
    expect(radius.advisory).toEqual(['test-a', 'test-b', 'test-c']);
  });

  it('does not rerun the owner of a cleared link', () => {
    const edited = scan({ 'depot.md': file(RULES).replace('Count the crates', 'Tally the crates') }, first);
    const cleared = clearLink(links[0] as Link, 'semantic-still-covered', edited);
    expect(cleared.ok).toBe(true);
    const next = scan(
      {
        'depot.md': file(RULES)
          .replace('Count the crates', 'Tally the crates')
          .replace('Return the keys', 'Hand back the keys'),
      },
      edited,
    );
    const radius = blastRadius(edited, next, [
      cleared.ok ? cleared.link : (links[0] as Link),
      ...links.slice(1),
    ]);
    expect(radius.rerun).toEqual(['test-c']);
  });
});
