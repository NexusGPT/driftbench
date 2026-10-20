import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BlockLink, type LinkProof, parseSpecText, specHash } from '@agent-nexus/driftbench-core';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { type Io, main } from '../src/index';

// Each proof runs a few dozen specs on the stand-in twice; under a parallel suite that takes minutes.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

/**
 * Proof of links by deletion on a planted agent: the Northwind fixture and its stand-in runtime, which
 * derives what it does from the estate in its folder and nothing else. Fictional data only.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const MAP = join(FIXTURE, 'approved.yaml');
const LIVE = join(FIXTURE, 'generated/specs/live');
const FAKE = join(FIXTURE, 'live/fake/claude.mjs');
/** The stand-in judge of the fixture: most generated specs carry a judged criterion (#877), read by it. */
const JUDGE = [
  '--judge',
  'claude:haiku',
  '--judge-command',
  join(FIXTURE, 'live/fake/judge.cjs'),
  '--judge-budget',
  '1',
];
const STATES = join(FIXTURE, 'live/states/library.json');
const ROUTE = 'route.route-planner.an-ask-that-fits-route-planner';
/** Specs that name no route-planner atom and pass on the original. */
const CONTROLS = [
  'estate.pairwise.0333',
  'estate.pairwise.0010',
  'estate.pairwise.0024',
  'estate.pairwise.0038',
];
/** A control the test links to the route, wrongly: the deletion must refute it. */
const WRONG = 'estate.pairwise.0333';
/** A spec of the route whose link the test removes: its flip must show up as unlinked. */
const SILENT = 'estate.pairwise.0142';

async function cli(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const work: string[] = [];
async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'estate-prove-'));
  work.push(dir);
  return dir;
}
afterAll(async () => {
  while (work.length > 0) await rm(work.pop() ?? '', { recursive: true, force: true });
});

describe('estate mutate --delete <id>', () => {
  it('builds the agent without the span of the atom the id names', async () => {
    const to = join(await folder(), 'mutant');
    const made = await cli(['estate', 'mutate', MAP, '--delete', ROUTE, '--to', to, '--json']);
    expect(made.err).toBe('');
    expect(made.code).toBe(0);
    const record = JSON.parse(made.out) as { atom: string; op: string; file: string; before: string };
    expect(record).toMatchObject({ atom: ROUTE, op: 'delete' });
    const map = await loadEstateMap(MAP);
    if (!map.ok) throw new Error('fixture map');
    const atom = map.map.atoms.find((each) => each.id === ROUTE);
    expect(atom?.provenance.file).toBe(record.file);
    const copy = await readFile(join(to, record.file), 'utf8');
    expect(copy).not.toContain(atom?.provenance.quote);
    expect(await readFile(join(FIXTURE, record.file), 'utf8')).toContain(atom?.provenance.quote);
    const mutantMap = await loadEstateMap(join(to, 'map.yaml'));
    expect(mutantMap.ok && mutantMap.map.atoms.some((each) => each.id === ROUTE)).toBe(false);
  });

  it('takes the ledger id of the unit an atom was read from, and records it', async () => {
    const dir = await folder();
    const raw = parseYaml(await readFile(MAP, 'utf8')) as {
      root: string;
      atoms: Array<{ id: string; fields?: Record<string, unknown> }>;
    };
    raw.root = FIXTURE;
    const atom = raw.atoms.find((each) => each.id === ROUTE);
    if (!atom) throw new Error('no route atom');
    atom.fields = { ...atom.fields, extraction: 'pointer', unit: 'k2mz7q4wxa' };
    const map = join(dir, 'approved.yaml');
    await writeFile(map, stringifyYaml(raw, { lineWidth: 0 }));
    const made = await cli([
      'estate',
      'mutate',
      map,
      '--delete',
      'k2mz7q4wxa',
      '--to',
      join(dir, 'm'),
      '--json',
    ]);
    expect(made.err).toBe('');
    expect(JSON.parse(made.out)).toMatchObject({ atom: ROUTE, ledger: 'k2mz7q4wxa', op: 'delete' });

    // A ledger id two atoms carry names neither; --atom and an inline id that differ are refused.
    const other = raw.atoms.find((each) => each.id !== ROUTE && each.id.startsWith('route.'));
    if (!other) throw new Error('no second route');
    other.fields = { ...other.fields, extraction: 'pointer', unit: 'k2mz7q4wxa' };
    await writeFile(map, stringifyYaml(raw, { lineWidth: 0 }));
    const twice = await cli(['estate', 'mutate', map, '--delete', 'k2mz7q4wxa', '--to', join(dir, 'n')]);
    expect(twice.code).toBe(2);
    expect(twice.err).toContain('The ledger id k2mz7q4wxa names 2 atoms');
    const differ = await cli([
      'estate',
      'mutate',
      MAP,
      '--atom',
      other.id,
      '--delete',
      ROUTE,
      '--to',
      join(dir, 'o'),
    ]);
    expect(differ.code).toBe(2);
    expect(differ.err).toContain('Name the atom once');
    const none = await cli(['estate', 'mutate', MAP, '--delete', '--to', join(dir, 'p')]);
    expect(none.code).toBe(2);
    expect(none.err).toContain('Name the atom to mutate');
  });
});

describe('estate prove on the planted agent', () => {
  let dir: string;
  let specsDir: string;
  let mutant: string;
  const linked: string[] = [];

  const prove = (specs: string[], ...extra: string[]) =>
    cli([
      'estate',
      'prove',
      ...specs,
      '--mutant',
      mutant,
      '--original',
      join(dir, 'original.db'),
      '--mutated',
      join(dir, 'mutant.db'),
      ...extra,
    ]);
  const path = (id: string) => join(specsDir, `${id}.yaml`);

  beforeAll(async () => {
    dir = await folder();
    specsDir = join(dir, 'specs');
    await mkdir(specsDir);
    // The specs that link the route, and the controls, copied as they are; then the two planted changes.
    for (const file of filesUnder(LIVE)) {
      const text = readFileSync(file, 'utf8');
      const id = basename(file, '.yaml');
      const links = text.includes(`rule: ${ROUTE}\n`);
      if (!links && !CONTROLS.includes(id)) continue;
      if (links) linked.push(id);
      await writeFile(path(id), text);
    }
    const plant = async (id: string, change: (links: BlockLink[]) => BlockLink[]) => {
      const spec = parseYaml(await readFile(path(id), 'utf8')) as { metadata: { links: BlockLink[] } };
      spec.metadata.links = change(spec.metadata.links);
      await writeFile(path(id), stringifyYaml(spec, { lineWidth: 0 }));
    };
    await plant(WRONG, (links) => [
      ...links,
      {
        block: 'ask',
        to: { kind: 'rule', rule: ROUTE },
        relation: 'verifies',
        status: 'declared',
        created_by: 'author',
      },
    ]);
    await plant(SILENT, (links) =>
      links.filter((link) => !(link.to.kind === 'rule' && link.to.rule === ROUTE)),
    );

    mutant = join(dir, 'mutant');
    const made = await cli(['estate', 'mutate', MAP, '--delete', ROUTE, '--to', mutant]);
    expect(made.code, made.err).toBe(0);
    const specs = [specsDir];
    const run = (estate: string, store: string, pin: string[]) =>
      cli([
        'estate',
        'run',
        ...specs,
        '--estate',
        estate,
        '--runtime',
        'claude-code',
        '--command',
        FAKE,
        '--store',
        join(dir, store),
        '--states',
        STATES,
        '--json',
        ...JUDGE,
        ...pin,
      ]);
    const original = await run(FIXTURE, 'original.db', ['--map', MAP]);
    const mutated = await run(mutant, 'mutant.db', []);
    expect(original.err).toBe('');
    expect(mutated.err).toBe('');
  });

  it('on the links the generator wrote, the blocks that flip are exactly the linked blocks: every link is verified', async () => {
    const untouched = [...linked.filter((id) => id !== SILENT), ...CONTROLS.filter((id) => id !== WRONG)];
    const result = await prove([...untouched.map(path)], '--json');
    expect(result.err).toBe('');
    const proof = JSON.parse(result.out) as LinkProof;
    expect(proof.counts.linked).toBeGreaterThan(10);
    expect(proof.counts.verified).toBe(proof.counts.linked);
    expect(proof.counts.flipped).toBe(proof.counts.verified);
    expect(proof.counts).toMatchObject({ refuted: 0, unproved: 0, unlinkedFlips: 0 });
    // The near miss of the route is a negative control: it exercises the route, and no deletion flips it.
    expect(proof.counts.exercised).toBeGreaterThan(0);
    expect(
      proof.blocks
        .filter((block) => block.flipped)
        .map((block) => block.spec)
        .sort(),
    ).toEqual(
      proof.blocks
        .filter((block) => block.links.length > 0)
        .map((block) => block.spec)
        .sort(),
    );
    expect(proof.agrees).toBe(true);
    expect(result.code).toBe(0);

    const text = await prove(untouched.map(path));
    expect(text.out).toContain(`Proof of ${ROUTE} by the mutant delete`);
    expect(text.out).toContain('The blocks that flip are the linked blocks.');
  });

  it('refutes a link whose block does not flip, and names a block that flips with no link', async () => {
    const all = [...linked, ...CONTROLS].map(path);
    const result = await prove(all, '--json');
    const proof = JSON.parse(result.out) as LinkProof;
    expect(result.code).toBe(1);
    expect(proof.agrees).toBe(false);
    expect(proof.blocks.filter((block) => block.verdict === 'refuted').map((block) => block.spec)).toEqual([
      WRONG,
    ]);
    expect(
      proof.blocks.filter((block) => block.verdict === 'unlinked-flip').map((block) => block.spec),
    ).toEqual([SILENT]);
    const text = await prove(all);
    expect(text.out).toContain(`refuted       ${WRONG} ask: pass -> pass`);
    expect(text.out).toContain(`unlinked-flip ${SILENT} ask: pass -> fail`);
    expect(text.out).toContain('The blocks that flip and the linked blocks differ.');
  });

  it('with --write, marks each proved link in its spec file and keeps every spec hash', async () => {
    const all = [...linked, ...CONTROLS];
    const before = new Map<string, string>();
    for (const id of all) {
      const loaded = parseSpecText(await readFile(path(id), 'utf8'), 'yaml', path(id));
      if (loaded.ok) before.set(id, specHash(loaded.spec));
    }
    const result = await prove(all.map(path), '--write');
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/Wrote the links of \d+ spec files\./);
    for (const id of all) {
      const text = await readFile(path(id), 'utf8');
      const loaded = parseSpecText(text, 'yaml', path(id));
      if (!loaded.ok) throw new Error(`${id} no longer loads`);
      expect(specHash(loaded.spec), id).toBe(before.get(id));
      const mine = ((loaded.spec.metadata?.links ?? []) as BlockLink[]).filter(
        (link) =>
          link.to.kind === 'rule' && link.to.rule === ROUTE && (link.relation ?? 'verifies') === 'verifies',
      );
      for (const link of mine) {
        expect(link.status, id).toBe(id === WRONG ? 'refuted' : 'verified');
        expect(link.evidence?.[link.status]).toMatchObject({ op: 'delete', original: 'pass' });
      }
    }
    // The header comment of a generated spec is kept.
    expect(await readFile(path(linked.find((id) => id !== SILENT) ?? ''), 'utf8')).toMatch(
      /^# Generated by driftbench estate generate/,
    );
  });

  it('refuses a folder with no mutant record, a missing store, and specs that link nothing to the rule', async () => {
    const noRecord = await cli([
      'estate',
      'prove',
      specsDir,
      '--mutant',
      specsDir,
      '--original',
      join(dir, 'original.db'),
      '--mutated',
      join(dir, 'mutant.db'),
    ]);
    expect(noRecord.code).toBe(2);
    expect(noRecord.err).toContain('mutant.json cannot be read');
    const noStore = await cli([
      'estate',
      'prove',
      specsDir,
      '--mutant',
      mutant,
      '--original',
      join(dir, 'none.db'),
      '--mutated',
      join(dir, 'mutant.db'),
    ]);
    expect(noStore.code).toBe(2);
    expect(noStore.err).toContain('does not exist');
    const nothing = await prove([path(CONTROLS[1] ?? '')]);
    expect(nothing.code).toBe(2);
    expect(nothing.err).toContain('nothing to prove');
  });
});

describe('estate prove on a second planted rule: a deny of the settings', () => {
  it('the tool_denied block flips when the deny is deleted, and is the only linked block', async () => {
    const DENY = 'tool.settings.deny-webfetch';
    const dir = await folder();
    const specs = join(dir, 'specs');
    await mkdir(specs);
    const ids: string[] = [];
    for (const file of filesUnder(LIVE)) {
      const id = basename(file, '.yaml');
      if (!readFileSync(file, 'utf8').includes(`rule: ${DENY}\n`) && !CONTROLS.slice(1).includes(id))
        continue;
      ids.push(id);
      await writeFile(join(specs, `${id}.yaml`), readFileSync(file, 'utf8'));
    }
    const mutant = join(dir, 'mutant');
    expect((await cli(['estate', 'mutate', MAP, '--delete', DENY, '--to', mutant])).code).toBe(0);
    for (const [estate, store, pin] of [
      [FIXTURE, 'original.db', ['--map', MAP]],
      [mutant, 'mutant.db', []],
    ] as const) {
      const ran = await cli([
        'estate',
        'run',
        specs,
        '--estate',
        estate,
        '--runtime',
        'claude-code',
        '--command',
        FAKE,
        '--store',
        join(dir, store),
        '--states',
        STATES,
        ...pin,
      ]);
      expect(ran.err).toBe('');
    }
    const result = await cli([
      'estate',
      'prove',
      specs,
      '--mutant',
      mutant,
      '--original',
      join(dir, 'original.db'),
      '--mutated',
      join(dir, 'mutant.db'),
      '--json',
    ]);
    const proof = JSON.parse(result.out) as LinkProof;
    expect(proof.counts).toMatchObject({ linked: 1, flipped: 1, verified: 1, refuted: 0, unlinkedFlips: 0 });
    expect(proof.blocks.find((block) => block.flipped)?.spec).toBe(`estate.tool_denied.${DENY}`);
    expect(proof.agrees).toBe(true);
    expect(result.code).toBe(0);
  });
});
