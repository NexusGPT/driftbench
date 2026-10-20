import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bankSummary, formatItems } from '../../src/bank';
import { runSeeds } from '../../src/ladder';
import { BLIND_PROVENANCE, blindLevels } from '../../src/ladders/pointer/bank/blind';
import { pointerBank, pointerBankLadder } from '../../src/ladders/pointer/bank/index';
import { fingerprints, kitHelpers, reachedNames } from './fingerprint';
import { referenceSut } from './reference/index';

const count = (label: string) => pointerBank().filter((i) => i.provenance === label).length;

describe('the provenance of the first bank', () => {
  it('labels every item, and the three labels cover the 419 items', () => {
    expect(pointerBank()).toHaveLength(419);
    expect(count('blind')).toBe(17);
    expect(count('maintainer-repaired')).toBe(385);
    expect(count('maintainer-added')).toBe(17);
  });

  it('labels the stack and label-set validation items as maintainer-added', () => {
    const added = pointerBank().filter((i) => i.provenance === 'maintainer-added');
    expect(added.every((i) => /^labels\.(stack-|set-validation-)/.test(i.id))).toBe(true);
  });

  it('keeps the lowercase-boundary item out of the blind label: its oracle was reversed after the blind commit', () => {
    const item = pointerBank().find((i) => i.id === 'cutting.sentences-lowercase-start-merges');
    expect(item?.provenance).toBe('maintainer-repaired');
  });
});

describe('an item that changed after the blind commit is not labelled blind', () => {
  const record = JSON.parse(
    readFileSync(new URL('../../../../validators/pointer/blind-record.json', import.meta.url), 'utf8'),
  ) as { items: Record<string, string>; helpers: Record<string, string> };
  const root = fileURLToPath(new URL('../../src/ladders/pointer', import.meta.url));
  const ids = Object.keys(record.items);
  const now = fingerprints(root, ids);
  const label = (id: string) => pointerBank().find((i) => i.id === id)?.provenance;

  it('records the 402 items of the blind commit', () => {
    expect(ids).toHaveLength(402);
  });

  it('labels an item blind exactly when what its runner reaches is the text of the blind commit', () => {
    const wrong = ids.filter((id) => (now[id] === record.items[id]) !== (label(id) === 'blind'));
    expect(wrong).toEqual([]);
  });

  it('labels repaired the two items the line scan missed: a changed tail of a runner and a changed helper call', () => {
    expect(label('labels.prompt-examples-max-three')).toBe('maintainer-repaired');
    expect(label('adversarial.label-named-like-prototype')).toBe('maintainer-repaired');
  });

  it('labels repaired an item that reaches a changed helper only through other helpers: re-anchoring.noop', () => {
    expect(reachedNames(root, 're-anchoring.noop')).toContain('eventNow');
    expect(kitHelpers(root).eventNow).not.toBe(record.helpers.eventNow);
    expect(label('re-anchoring.noop')).toBe('maintainer-repaired');
  });

  it('does not count a helper whose body is unchanged: liveOf, privateEstate and strings', () => {
    const helpers = kitHelpers(root);
    for (const name of ['liveOf', 'privateEstate', 'strings'])
      expect(helpers[name], name).toBe(record.helpers[name]);
    expect(Object.keys(helpers)).toContain('liveOf');
  });

  it('labels repaired an item whose only change reaches it through the renderer: ids.ledger-relative-paths', () => {
    expect(label('ids.ledger-relative-paths')).toBe('maintainer-repaired');
    expect(reachedNames(root, 'ids.ledger-relative-paths')).toContain('compose');
  });

  it('follows the renderer: a change to a rendering helper changes the fingerprint of a blind-looking cutting item', () => {
    const temp = mkdtempSync(join(tmpdir(), 'pointer-render-'));
    for (const dir of ['kit', 'bank']) cpSync(join(root, dir), join(temp, dir), { recursive: true });
    const path = join(temp, 'kit/compose.ts');
    const before = readFileSync(path, 'utf8');
    const after = before.replaceAll(
      '[contentStart, contentEnd] = w.put(block.text);',
      '[contentStart, contentEnd] = w.put(`${block.text} altered`);',
    );
    expect(after).not.toBe(before);
    writeFileSync(path, after);
    expect(fingerprints(temp, ['cutting.heading-atx'])['cutting.heading-atx']).not.toBe(
      now['cutting.heading-atx'],
    );
  });

  it('labels the repaired replay items maintainer-repaired', () => {
    for (const key of [
      'miss-names-description-edit',
      'miss-names-added-example',
      'miss-names-new-file',
      'fixture-miss-names-model',
      'fixture-miss-names-prompt-version',
      'fixture-miss-names-schema-version',
      'fixture-miss-names-set-hash',
      'fixture-miss-names-labeler',
      'fixture-miss-names-system-part',
      'fixture-miss-names-questions-part',
      'fixture-miss-names-cut-digest',
      'fixture-replay-twice-identical',
    ])
      expect(label(`replay.${key}`), key).toBe('maintainer-repaired');
  });
});

describe('the second bank beside the first', () => {
  it('registers five blind levels after the nine levels of the first bank, with prefixed families', async () => {
    const ladder = pointerBankLadder(async () => referenceSut());
    expect(ladder.levels.map((l) => l.id).slice(9)).toEqual([
      'blind-1',
      'blind-2',
      'blind-3',
      'blind-4',
      'blind-5',
    ]);
    const measure = await blindLevels(async () => referenceSut())[0]?.compute({
      seed: 1,
      hidden: false,
      root: '.',
    });
    const bank = measure?.bank ?? [];
    expect(bank.length).toBeGreaterThan(0);
    expect(bank.every((e) => e.provenance === BLIND_PROVENANCE)).toBe(true);
    expect(bank.every((e) => e.family?.startsWith('blind-') && e.id.startsWith('blind/'))).toBe(true);
  });

  it('serves the cut operation from the reader port and fails an operation the port lacks', async () => {
    const level = blindLevels(async () => referenceSut())[2];
    const measure = await level?.compute({ seed: 1, hidden: false, root: '.' });
    const bank = measure?.bank ?? [];
    const of = (family: string) => bank.filter((e) => e.family === family);
    expect(of('blind-cutting').length).toBeGreaterThan(0);
    expect(of('blind-cutting').every((e) => e.pass)).toBe(true);
    expect(of('blind-scale').every((e) => e.pass)).toBe(true);
    expect(of('blind-labels').length).toBeGreaterThan(0);
    expect(of('blind-labels').every((e) => !e.pass)).toBe(true);
  }, 120_000);

  it('reports the score of each label apart in the item listing', async () => {
    const own = pointerBankLadder(async () => referenceSut());
    const ladder = {
      component: 'pointer',
      levels: [own.levels[0], own.levels[1], own.levels[3], own.levels[9]].filter((l) => l !== undefined),
    };
    const report = await runSeeds(ladder, [{ seed: 1, hidden: false }], process.cwd(), { full: true });
    const text = formatItems(bankSummary(report), 'pointer');
    expect(text).toContain('Provenance maintainer-repaired:');
    expect(text).toContain('Provenance maintainer-added:');
    expect(text).toContain(`Provenance ${BLIND_PROVENANCE}:`);
  }, 120_000);
});
