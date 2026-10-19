import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  copyEstate,
  type EstateMap,
  invertText,
  loadEstateMap,
  MutantError,
  mutateEstate,
  parseJsonRanges,
  quoteDrift,
  validateEstateMap,
} from '../../src/index';

/** Estate mutants on a copy of the fictional Northwind fixture. */

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const R3 = 'gate.standing.read-a-file-before-editing-it';
const R7 = 'instruction.standing.tell-the-user-about-a-late';
const WEBFETCH = 'tool.settings.deny-webfetch';

let map: EstateMap;
beforeAll(async () => {
  const loaded = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  map = loaded.map;
});

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function copy(): Promise<string> {
  const to = await mkdtemp(join(tmpdir(), 'driftbench-mutant-'));
  folders.push(to);
  await copyEstate(FIXTURE, to, map);
  return to;
}

/** Every quote of the mutant map is at its span in the mutant copy, and the map validates with its hash. */
async function consistent(root: string, mutant: EstateMap): Promise<void> {
  expect(validateEstateMap(JSON.parse(JSON.stringify(mutant)))).toMatchObject({ ok: true });
  const texts = new Map<string, string>();
  for (const file of new Set(mutant.atoms.map((atom) => atom.provenance.file))) {
    texts.set(file, await readFile(join(root, file), 'utf8'));
  }
  expect(quoteDrift(mutant.atoms, texts)).toEqual([]);
}

describe('mutateEstate', () => {
  it('deletes an atom by its span: the quote and its emptied line go, later spans move, the hash changes', async () => {
    const root = await copy();
    const result = await mutateEstate({ root, map }, { delete: R3 });
    const text = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    expect(text).not.toContain('Read a file before you edit it.');
    expect(text).not.toContain('**R3.**');
    expect(text).toContain('- **R4.** Never delete a file under `ledger/`');
    expect(result.before).toBe('- **R3.** Read a file before you edit it.');
    expect(result.mapHash).not.toBe(map.hash);
    expect(result.originalMapHash).toBe(map.hash);
    expect(result.map.atoms.some((atom) => atom.id === R3)).toBe(false);
    expect(result.map.atoms).toHaveLength(map.atoms.length - 1);
    expect(result.map.edges.some((edge) => edge.from === R3 || edge.to === R3)).toBe(false);
    const r4 = result.map.atoms.find(
      (atom) => atom.id === 'instruction.standing.never-delete-a-ledger-file-archive',
    );
    expect(r4?.provenance.startLine).toBe(11);
    expect(result.collateral).toEqual([]);
    await consistent(root, result.map);
  });

  it('refuses to delete a skill name line that equals the folder name: an equivalent mutant, nothing written', async () => {
    const root = await copy();
    const skill = '.claude/skills/invoice-reconcile/SKILL.md';
    const before = await readFile(join(root, skill), 'utf8');
    await expect(
      mutateEstate({ root, map }, { delete: 'skill.invoice-reconcile.skill-invoice-reconcile' }),
    ).rejects.toThrow(/equivalent mutant.*folder/);
    expect(await readFile(join(root, skill), 'utf8')).toBe(before);
  });

  it('inverts an obligation by its polarity, in place, the line count kept', async () => {
    const root = await copy();
    const original = await readFile(join(FIXTURE, 'CLAUDE.md'), 'utf8');
    const result = await mutateEstate({ root, map }, { invert: R7 });
    const text = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    expect(result.after).toBe(
      '- **R7.** Do not follow this rule: When a shipment is late by more than two days, tell the user and propose a supplier email.',
    );
    expect(text.split('\n')).toHaveLength(original.split('\n').length);
    const atom = result.map.atoms.find((candidate) => candidate.id === R7);
    expect(atom?.provenance.quote).toBe(
      'Do not follow this rule: When a shipment is late by more than two days, tell the user and propose a supplier email.',
    );
    expect(result.mapHash).not.toBe(map.hash);
    await consistent(root, result.map);
  });

  it('deletes a value from a JSON list and leaves the file JSON', async () => {
    const root = await copy();
    const result = await mutateEstate({ root, map }, { delete: WEBFETCH });
    const settings = JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8'));
    expect(settings.permissions.deny).toEqual(['Bash(git push --force:*)', 'Bash(rm -rf:*)']);
    await consistent(root, result.map);
  });

  it('gives the same hash for the same mutation of the same estate', async () => {
    const first = await mutateEstate({ root: await copy(), map }, { invert: R7 });
    const second = await mutateEstate({ root: await copy(), map }, { invert: R7 });
    expect(first.mapHash).toBe(second.mapHash);
  });

  it('refuses to invert what is not a prose obligation, an unknown atom, and a copy that drifted', async () => {
    const root = await copy();
    await expect(mutateEstate({ root, map }, { invert: WEBFETCH })).rejects.toBeInstanceOf(MutantError);
    await expect(mutateEstate({ root, map }, { delete: 'no.such.atom' })).rejects.toThrow('not in the map');
    await writeFile(join(root, 'CLAUDE.md'), '# Another estate\n');
    await expect(mutateEstate({ root, map }, { delete: R3 })).rejects.toThrow('no longer at CLAUDE.md');
  });

  it('copies the estate files alone, not the maps, specs and sessions beside them', async () => {
    const root = await copy();
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(root)).sort()).toEqual(['.claude', 'CLAUDE.md']);
  });
});

describe('mutateEstate --invert chooses its sentence by the polarity the atom declares', () => {
  const R6 = 'instruction.standing.never-force-push';
  const LIFTED = 'This prohibition is lifted: ';
  const FOLLOW = 'Do not follow this rule: ';

  it('inverts a prohibition of the fixture with the sentence of a prohibition, the quote whole after it', async () => {
    const root = await copy();
    const result = await mutateEstate({ root, map }, { invert: R6 });
    expect(result.after).toBe(
      '- **R6.** This prohibition is lifted: Never run `git push --force` on any branch.',
    );
    const atom = result.map.atoms.find((candidate) => candidate.id === R6);
    expect(atom?.provenance.quote).toBe(`${LIFTED}Never run \`git push --force\` on any branch.`);
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toContain(result.after);
    await consistent(root, result.map);
  });

  it('decides by the declared polarity, not by the words: a prohibition with no negative word, an obligation that opens with one', async () => {
    const prohibition = 'instruction.standing.report-only-numbers-read-during-the';
    expect(map.atoms.find((candidate) => candidate.id === prohibition)?.fields?.polarity).toBe('prohibition');
    const first = await mutateEstate({ root: await copy(), map }, { invert: prohibition });
    expect(first.after).toContain(LIFTED);
    expect(first.after).not.toContain(FOLLOW);
    // The same quote with the polarity declared the other way takes the other sentence.
    const flipped = structuredClone(map);
    const atom = flipped.atoms.find((candidate) => candidate.id === prohibition);
    if (atom?.fields) atom.fields.polarity = 'obligation';
    const second = await mutateEstate({ root: await copy(), map: flipped }, { invert: prohibition });
    expect(second.after).toContain(FOLLOW);
    expect(second.after).not.toContain(LIFTED);
  });

  it('gives every standing instruction of the fixture the sentence of its declared polarity', async () => {
    const standing = map.atoms.filter(
      (candidate) => candidate.kind === 'instruction' && candidate.id.startsWith('instruction.standing.'),
    );
    expect(standing.length).toBeGreaterThan(10);
    const seen = new Set<string>();
    for (const candidate of standing) {
      const result = await mutateEstate({ root: await copy(), map }, { invert: candidate.id });
      const wanted = candidate.fields?.polarity === 'prohibition' ? LIFTED : FOLLOW;
      expect(result.after, candidate.id).toContain(wanted);
      expect(result.after, candidate.id).not.toContain(wanted === LIFTED ? FOLLOW : LIFTED);
      seen.add(wanted);
    }
    expect([...seen].sort()).toEqual([FOLLOW, LIFTED]);
  });
});

describe('invertText', () => {
  const CLAUSE = 'Never run `git push --force` on any branch.';

  it('keeps the whole quote and sets a fixed sentence before it, chosen by the declared polarity alone', () => {
    expect(invertText(CLAUSE, 'prohibition')).toBe(`This prohibition is lifted: ${CLAUSE}`);
    expect(invertText(CLAUSE, 'obligation')).toBe(`Do not follow this rule: ${CLAUSE}`);
    expect(invertText(CLAUSE)).toBe(`Do not follow this rule: ${CLAUSE}`);
  });

  it('reads no word of the quote: a quote that holds none of the old forms is inverted the same way', () => {
    const text = 'Ask at most one question per reply.';
    expect(invertText(text, 'obligation')).toBe(`Do not follow this rule: ${text}`);
    // The old table read these openings; the polarity decides now, whatever the words say.
    expect(invertText('Never X the file.', 'obligation')).toBe('Do not follow this rule: Never X the file.');
    expect(invertText('Always X the file.', 'prohibition')).toBe(
      'This prohibition is lifted: Always X the file.',
    );
  });

  it('keeps a markdown prefix (list marker, bold label) in front of the sentence', () => {
    expect(invertText('- **R9.** Ask one question per reply.', 'obligation')).toBe(
      '- **R9.** Do not follow this rule: Ask one question per reply.',
    );
    expect(invertText('1. Read the rules first.', 'obligation')).toBe(
      '1. Do not follow this rule: Read the rules first.',
    );
  });

  it('works in any script: a letter is a letter', () => {
    expect(invertText('Toujours répondre en français.', 'obligation')).toBe(
      'Do not follow this rule: Toujours répondre en français.',
    );
    expect(invertText('Всегда отвечайте по-русски.', 'obligation')).toBe(
      'Do not follow this rule: Всегда отвечайте по-русски.',
    );
  });

  it.each([['"WebFetch"'], ['name: invoice-reconcile'], ['Edit'], ['$CLAUDE_PROJECT_DIR/x.sh']])(
    'refuses %s',
    (text) => {
      expect(invertText(text, 'obligation')).toBeUndefined();
    },
  );
});

describe('a delete in a JSON file, structurally', () => {
  const CASES = fileURLToPath(new URL('../../../../examples/estates/reader-cases/', import.meta.url));

  async function casesCopy(): Promise<{ root: string; map: EstateMap }> {
    const loaded = await loadEstateMap(join(CASES, 'approved.yaml'));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const root = await mkdtemp(join(tmpdir(), 'driftbench-mutant-json-'));
    folders.push(root);
    await copyEstate(CASES, root, loaded.map);
    return { root, map: loaded.map };
  }

  it('deletes a script atom with its file: the mention goes, and so does the script it names', async () => {
    const root = await copy();
    const id = 'script.invoice-reconcile.script-scripts-reconcile-py';
    const script = '.claude/skills/invoice-reconcile/scripts/reconcile.py';
    expect(existsSync(join(root, script))).toBe(true);
    const result = await mutateEstate({ root, map }, { delete: id });
    expect(await readFile(join(root, '.claude/skills/invoice-reconcile/SKILL.md'), 'utf8')).not.toContain(
      'scripts/reconcile.py <invoice> <order>',
    );
    expect(existsSync(join(root, script))).toBe(false);
    expect(result.removed).toEqual([script]);
    expect(result.collateral).toEqual(['instruction.invoice-reconcile.run-the-reconcile-script-and-show']);
  });

  it('deletes a settings guard by its whole entry, and an environment key by its member', async () => {
    const guard = await casesCopy();
    const result = await mutateEstate(guard, {
      delete: 'guard.settings.pretooluse-bash-guard-block-force-push',
    });
    const settings = JSON.parse(await readFile(join(guard.root, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse[0].hooks).toEqual([]);
    expect(settings.hooks.Stop[0].hooks).toHaveLength(1);
    expect(result.map.atoms.some((atom) => atom.id === result.atom)).toBe(false);
    expect(result.collateral).toEqual(['invariant.settings.every-guard-finds-its-script-from']);

    const env = await casesCopy();
    await mutateEstate(env, { delete: 'setting.settings.setting-env-northwind-region' });
    const after = JSON.parse(await readFile(join(env.root, '.claude/settings.json'), 'utf8'));
    expect(after.env).toEqual({});
    expect(after.model).toBe('opus');
  });

  it('empties a JSON document whose quote only the whole document holds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-mutant-root-'));
    folders.push(root);
    const atom = {
      ...map.atoms[0],
      id: 'invariant.registry.the-registry',
      kind: 'invariant',
      provenance: { file: '.claude/hooks/CATALOGUE.json', startLine: 1, endLine: 1, quote: '{', hash: '' },
    } as EstateMap['atoms'][number];
    await mkdir(join(root, '.claude/hooks'), { recursive: true });
    await writeFile(
      join(root, '.claude/hooks/CATALOGUE.json'),
      '{\n  "checks": [{ "id": "K1", "event": "Stop", "status": "enforce" }]\n}\n',
    );
    const result = await mutateEstate(
      { root, map: { ...map, atoms: [atom], edges: [] } },
      { delete: atom.id },
    );
    expect(await readFile(join(root, '.claude/hooks/CATALOGUE.json'), 'utf8')).toBe('{}\n');
    expect(result.op).toBe('delete');
  });

  it('reads the offsets of every JSON value, and refuses a text that is not JSON', () => {
    const text = '{ "a": [1, "two", { "b": null }], "c": true }';
    const root = parseJsonRanges(text);
    expect(root?.elements.map((element) => text.slice(element.start, element.end))).toEqual([
      '"a": [1, "two", { "b": null }]',
      '"c": true',
    ]);
    expect(parseJsonRanges('{ "a": }')).toBeUndefined();
    expect(parseJsonRanges('[1, 2] 3')).toBeUndefined();
  });
});
