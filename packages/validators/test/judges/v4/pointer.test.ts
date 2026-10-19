import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  judgesLadderV4,
  loadPointerImpl,
  type PointerImpl,
  type PointerItem,
  pointerBank,
  pointerFixtures,
  runPointerChild,
} from '../../../src/ladders/judges/v4';
import { ROOT } from '../../stats/support';

const fixtures = pointerFixtures(ROOT);
const bank = pointerBank();
const ids = (...names: string[]) => names.map((n) => `pointer/${n}`);

async function failing(impl: PointerImpl, which: PointerItem[] = bank): Promise<string[]> {
  const out: string[] = [];
  for (const item of which) {
    let misses: string[];
    try {
      misses = await item.run(impl, fixtures, 1, ROOT);
    } catch {
      misses = ['threw'];
    }
    if (misses.length > 0) out.push(item.id);
  }
  return out;
}

describe('the pointer labeller items', () => {
  it('has unique ids, a cause per item, every family and the five tiers', () => {
    expect(new Set(bank.map((i) => i.id)).size).toBe(bank.length);
    expect(bank.every((i) => i.cause.length > 20)).toBe(true);
    expect(new Set(bank.map((i) => i.family)).size).toBe(10);
    expect(new Set(bank.map((i) => i.tier))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('passes on the shipped labellers', async () => {
    expect(await failing(await loadPointerImpl())).toEqual([]);
  });

  it('is level 6 of ladder version 4, after the five levels of version 3', () => {
    const ladder = judgesLadderV4();
    expect(ladder.version).toBe(4);
    expect(ladder.levels).toHaveLength(6);
    expect(ladder.levels[5]?.id).toBe('pointer-labellers');
  });

  it('fails every item against an implementation that exports nothing', async () => {
    const empty = {} as PointerImpl;
    // the source items read the files of the shipped module, which are clean: the 7 items on source still pass
    expect((await failing(empty)).length).toBe(bank.length - 7);
  });
});

// Faults planted in a copy of the labellers' source, one rule each. Each must fail the items of that rule and
// leave the items of a neighbouring rule passing.
type Fault = { name: string; file: string; from: string; to: string; fails: string[]; passes?: string[] };
const LABELS = 'pointer/labels.ts';
const YESNO = 'pointer/yesno.ts';
const STACK = 'pointer/stack.ts';
const CASSETTE = 'pointer/cassette.ts';

const FAULTS: Fault[] = [
  {
    name: 'expand: backwards range',
    file: LABELS,
    from: 'if (to < from || to - from > 10_000) return undefined;',
    to: 'if (to - from > 10_000) return undefined;',
    fails: ids('units/expand-invalid'),
    passes: ids('set-hash/value'),
  },
  {
    name: 'expand: no cap',
    file: LABELS,
    from: 'if (to < from || to - from > 10_000) return undefined;',
    to: 'if (to < from) return undefined;',
    fails: ids('units/expand-invalid'),
    passes: ids('set-hash/value'),
  },
  {
    name: 'expand: any digit',
    file: LABELS,
    from: '/^(\\d+)(?:-(\\d+))?$/.exec(units.trim())',
    to: '/^(\\p{Nd}+)(?:-(\\p{Nd}+))?$/u.exec(units.trim())',
    fails: ids('units/expand-invalid'),
  },
  {
    name: 'expand: no trim',
    file: LABELS,
    from: '.exec(units.trim())',
    to: '.exec(units)',
    fails: ids('units/expand-valid'),
    passes: ids('set-hash/value'),
  },
  {
    name: 'hash: 15 characters',
    file: LABELS,
    from: 'sha(canonical(set)).slice(0, 16)',
    to: 'sha(canonical(set)).slice(0, 15)',
    fails: ids('set-hash/value'),
    passes: ids('units/expand-valid'),
  },
  {
    name: 'hash: keys not sorted',
    file: LABELS,
    from: 'Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))',
    to: 'Object.entries(item as Record<string, unknown>)',
    fails: ids('set-hash/value', 'set-hash/pairs', 'recording/key-value', 'recording/labelling-hash'),
  },
  {
    name: 'hash: description ignored',
    file: LABELS,
    from: 'sha(canonical(set)).slice(0, 16)',
    to: "sha(canonical({ ...set, description: '' })).slice(0, 16)",
    fails: ids('set-hash/value', 'set-hash/pairs'),
  },
  {
    name: 'hash: label order ignored',
    file: LABELS,
    from: 'sha(canonical(set)).slice(0, 16)',
    to: 'sha(canonical({ ...set, labels: [...set.labels].sort((a, b) => a.name.localeCompare(b.name)) })).slice(0, 16)',
    fails: ids('set-hash/value', 'set-hash/pairs'),
  },
  {
    name: 'hash: remembers the last set',
    file: LABELS,
    from: 'export const setHash = (set: LabelSet): string => sha(canonical(set)).slice(0, 16);',
    to: "let prior = '';\nexport const setHash = (set: LabelSet): string => {\n  const h = sha(canonical(set) + prior).slice(0, 16);\n  prior = h;\n  return h;\n};",
    fails: ids('set-hash/isolated'),
  },
  {
    name: 'answer: unknown label kept',
    file: LABELS,
    from: "if (entry.label !== 'none' && !label) {",
    to: 'if (false) {',
    fails: ids('answer/refuses-unknown-label'),
    passes: ids('answer/refuses-outside-window', 'answer/accepted'),
  },
  {
    name: 'answer: unit named twice kept',
    file: LABELS,
    from: 'if (numbers.some((n) => covered.has(n))) {',
    to: 'if (false) {',
    fails: ids('answer/refuses-named-twice'),
    passes: ids('answer/refuses-unknown-label'),
  },
  {
    name: 'answer: window not checked',
    file: LABELS,
    from: 'if (numbers.some((n) => !inWindow.has(n))) {',
    to: 'if (false) {',
    fails: ids('answer/refuses-outside-window'),
    passes: ids('answer/refuses-named-twice'),
  },
  {
    name: 'answer: target on none',
    file: LABELS,
    from: "if (entry.label === 'none' && entry.target !== undefined) {",
    to: 'if (false) {',
    fails: ids('answer/refuses-none-target'),
    passes: ids('answer/refuses-extra-target'),
  },
  {
    name: 'answer: target outside the window',
    file: LABELS,
    from: '(entry.target === undefined || !inWindow.has(entry.target))',
    to: '(entry.target === undefined)',
    fails: ids('answer/refuses-missing-target'),
  },
  {
    name: 'answer: target on a label that takes none',
    file: LABELS,
    from: "if (label && label.target !== 'required' && entry.target !== undefined) {",
    to: 'if (false) {',
    fails: ids('answer/refuses-extra-target'),
    passes: ids('answer/refuses-none-target'),
  },
  {
    name: 'answer: target type not checked',
    file: LABELS,
    from: "if (entry.target !== undefined && (typeof entry.target !== 'number' || !Number.isInteger(entry.target))) {",
    to: 'if (false) {',
    fails: ids('answer/refuses-bad-target'),
  },
  {
    name: 'file: duplicate set',
    file: LABELS,
    from: 'if (seen.has(set.set))',
    to: 'if (false)',
    fails: ids('label-file/refuse-duplicates'),
    passes: ids('label-file/refuse-names'),
  },
  {
    name: 'file: duplicate label',
    file: LABELS,
    from: 'if (names.has(label.name))',
    to: 'if (false)',
    fails: ids('label-file/refuse-duplicates'),
  },
  {
    name: 'file: none allowed',
    file: LABELS,
    from: ".refine((name) => name !== 'none', ",
    to: '.refine(() => true, ',
    fails: ids('label-file/refuse-names'),
  },
  {
    name: 'file: any name',
    file: LABELS,
    from: 'const LABEL_NAME = /^[a-z][a-z0-9-]*$/;',
    to: 'const LABEL_NAME = /^[A-Za-z0-9][A-Za-z0-9_ -]*$/;',
    fails: ids('label-file/refuse-names'),
    passes: ids('label-file/read-valid'),
  },
  {
    name: 'file: condition without target',
    file: LABELS,
    from: "if (label.condition && label.target !== 'required') {",
    to: 'if (false) {',
    fails: ids('label-file/refuse-conditions'),
  },
  {
    name: 'file: condition with atom',
    file: LABELS,
    from: 'if (label.condition && label.atom) {',
    to: 'if (false) {',
    fails: ids('label-file/refuse-conditions'),
  },
  {
    name: 'file: four examples',
    file: LABELS,
    from: '.max(3)',
    to: '.max(4)',
    fails: ids('label-file/refuse-shape'),
  },
  {
    name: 'file: duplicate yaml keys',
    file: LABELS,
    from: '{ uniqueKeys: true }',
    to: '{ uniqueKeys: false }',
    fails: ids('label-file/refuse-yaml'),
  },
  {
    name: 'yes/no: above the threshold only',
    file: YESNO,
    from: 'if (p >= threshold && (!best || p > best.p))',
    to: 'if (p > threshold && (!best || p > best.p))',
    fails: ids('yes-no/threshold'),
    passes: ids('yes-no/unanswered'),
  },
  {
    name: 'yes/no: ties go to the last label',
    file: YESNO,
    from: 'if (p >= threshold && (!best || p > best.p))',
    to: 'if (p >= threshold && (!best || p >= best.p))',
    fails: ids('yes-no/threshold'),
  },
  {
    name: 'yes/no: a half answer guessed',
    file: YESNO,
    from: 'if (answered < asked.length) continue;',
    to: 'if (answered === 0) continue;',
    fails: ids('yes-no/unanswered'),
    passes: ids('yes-no/threshold'),
  },
  {
    name: 'yes/no: target labels asked alone',
    file: YESNO,
    from: 'if (asked.length < set.labels.length && !skipTargetLabels) {',
    to: 'if (false) {',
    fails: ids('yes-no/asked-labels'),
  },
  {
    name: 'choice: wider tolerance',
    file: YESNO,
    from: 'export const VECTOR_TOLERANCE = 0.01;',
    to: 'export const VECTOR_TOLERANCE = 0.02;',
    fails: ids('choice/vector-tolerance'),
    passes: ids('choice/vector-refused'),
  },
  {
    name: 'choice: probabilities out of range',
    file: YESNO,
    from: 'values.some((p) => !Number.isFinite(p) || p < 0 || p > 1)',
    to: 'values.some((p) => !Number.isFinite(p))',
    fails: ids('choice/vector-refused'),
  },
  {
    name: 'choice: ties go to the last option',
    file: YESNO,
    from: 'if (!best || p > best.p) best = { label: name, p };',
    to: 'if (!best || p >= best.p) best = { label: name, p };',
    fails: ids('choice/choice-ties-missing'),
  },
  {
    name: 'margin: no vector check',
    file: STACK,
    from: "if (!('none' in probabilities) || !isVector(probabilities)) return undefined;",
    to: 'if (false) return undefined;',
    fails: ids('stack/margin'),
  },
  {
    name: 'margin: not a difference',
    file: STACK,
    from: '(sorted[0]?.[1] ?? 0) - (sorted[1]?.[1] ?? 0)',
    to: '(sorted[0]?.[1] ?? 0)',
    fails: ids('stack/margin'),
  },
  {
    name: 'cascade: pass-at exclusive',
    file: STACK,
    from: 'if (top && top.p >= passAt) return top.label;',
    to: 'if (top && top.p > passAt) return top.label;',
    fails: ids('stack/cascade-sure', 'gold-set/gold-set', 'gold-set/gold-scan'),
    passes: ids('stack/margin'),
  },
  {
    name: 'cascade: fail-at inclusive',
    file: STACK,
    from: "if (!top || top.p < failAt) return 'none';",
    to: "if (!top || top.p <= failAt) return 'none';",
    fails: ids('stack/cascade-sure'),
  },
  {
    name: 'cascade: unsure takes system 1',
    file: STACK,
    from: 'return second ? fromSecond(second) : undefined;\n    },',
    to: "return second ? fromSecond(second) : { label: first.label, by: 'system1', sources: [] };\n    },",
    fails: ids('stack/cascade-unsure', 'stack/margin-no-vector'),
  },
  {
    name: 'cascade: fallback not marked',
    file: STACK,
    from: '...(second ? {} : { fallback: true as const }),',
    to: '',
    fails: ids('stack/cascade-fallback'),
  },
  {
    name: 'cascade: lone system 2 not marked',
    file: STACK,
    from: 'return { ...fromSecond(second), fallback: true };',
    to: 'return fromSecond(second);',
    fails: ids('stack/cascade-fallback'),
  },
  {
    name: 'cascade: target labels left to system 1',
    file: STACK,
    from: "if (second.label !== 'none' && !asked.has(second.label)) return fromSecond(second);",
    to: '',
    fails: ids('stack/cascade-targets', 'stack/margin-no-vector'),
  },
  {
    name: 'margin rule: cut exclusive',
    file: STACK,
    from: 'lead && lead.margin >= marginCut',
    to: 'lead && lead.margin > marginCut',
    fails: ids('stack/margin-rule'),
  },
  {
    name: 'labelling hash: no rule',
    file: STACK,
    from: "...(marginCut === undefined ? { passAt, failAt, rule: 'cascade' } : { marginCut, rule: 'margin' }),",
    to: '...{ passAt, failAt },',
    fails: ids('recording/labelling-hash', 'recording/labelling-hash-changes'),
  },
  {
    name: 'labelling hash: no runs',
    file: STACK,
    from: 'runs: member.runs ?? 1,',
    to: '',
    fails: ids('recording/labelling-hash', 'recording/labelling-hash-changes'),
  },
  {
    name: 'labelling hash: no settings',
    file: STACK,
    from: 'settings: member.settings,',
    to: '',
    fails: ids('recording/labelling-hash-changes'),
  },
  {
    name: 'labelling hash: no model',
    file: STACK,
    from: 'model: member.model,\n    settings',
    to: 'settings',
    fails: ids('recording/labelling-hash-changes'),
  },
  {
    name: 'key: readable left out',
    file: CASSETTE,
    from: 'sha(canonical({ wire, readable }))',
    to: 'sha(canonical({ wire }))',
    fails: ids('recording/key-value', 'recording/key-set-and-model'),
  },
  {
    name: 'key: set hash left out',
    file: CASSETTE,
    from: 'sha(canonical({ wire, readable }))',
    to: "sha(canonical({ wire, readable: { ...readable, setHash: '' } }))",
    fails: ids('recording/key-set-and-model'),
  },
  {
    name: 'key: body parts not hashed',
    file: CASSETTE,
    from: 'return { ...meta, labeler: wire.labeler, ...parts };',
    to: 'return { ...meta, labeler: wire.labeler };',
    fails: ids('recording/key-value', 'recording/key-body-and-labeler'),
  },
  {
    name: 'single: sources dropped',
    file: STACK,
    from: 'sources: sourcesOf(opinion),',
    to: 'sources: [],',
    fails: ids('stack/single'),
  },
  {
    name: 'cascade: the second key dropped from a sure decision',
    file: STACK,
    from: 'sources: sourcesOf(first, second),\n          ...(second',
    to: 'sources: sourcesOf(first),\n          ...(second',
    fails: ids('stack/cascade-sure'),
  },
  {
    name: 'cascade: a tie takes the last label',
    file: STACK,
    from: 'if (!top || p > top.p) top = { label: name, p };',
    to: 'if (!top || p >= top.p) top = { label: name, p };',
    fails: ids('stack/cascade-sure'),
  },
  {
    name: 'choice: the refusal rounds the sum',
    file: YESNO,
    from: 'Number(total.toFixed(4))',
    to: 'Number(total.toFixed(2))',
    fails: ids('choice/vector-refused'),
  },
  {
    name: 'choice: one figure above 1',
    file: YESNO,
    from: 'values.some((p) => !Number.isFinite(p) || p < 0 || p > 1)',
    to: 'values.some((p) => !Number.isFinite(p) || p < 0)',
    fails: ids('choice/vector-refused'),
  },
  {
    name: 'file: the YAML error shows every line',
    file: LABELS,
    from: "(cause.message.split('\\n')[0] ?? '')",
    to: 'cause.message',
    fails: ids('label-file/refuse-yaml'),
  },
  {
    name: 'yes/no: the opinion drops its probabilities',
    file: YESNO,
    from: "byUnit.set(unit.index, { label: best?.label ?? 'none', probabilities });",
    to: "byUnit.set(unit.index, { label: best?.label ?? 'none' });",
    fails: ids('yes-no/threshold'),
  },
  {
    name: 'labelling: the report line swaps the classes',
    file: STACK,
    from: "member.cls === 'system1' ? 'system 1' : 'system 2'",
    to: "member.cls === 'system1' ? 'system 2' : 'system 1'",
    fails: ids('recording/labelling-hash'),
  },
];

const MUTANTS = join(ROOT, 'packages/estate/.mutants');
afterAll(() => rmSync(MUTANTS, { recursive: true, force: true }));

describe('planted faults in a copy of the labellers', () => {
  it.each(FAULTS.map((f, i) => [i, f] as const))(
    '%i: %s',
    async (i, fault) => {
      const dir = join(MUTANTS, `m${i}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      cpSync(join(ROOT, 'packages/estate/src'), join(dir, 'src'), { recursive: true });
      const path = join(dir, 'src', fault.file);
      const text = readFileSync(path, 'utf8');
      expect(text.includes(fault.from), `the source no longer holds: ${fault.from}`).toBe(true);
      writeFileSync(path, text.replace(fault.from, fault.to));
      const impl = (await import(
        /* @vite-ignore */ pathToFileURL(join(dir, 'src/pointer/index.ts')).href
      )) as PointerImpl;
      const lost = await failing(impl);
      for (const id of fault.fails) expect(lost, `${id} must fail under: ${fault.name}`).toContain(id);
      for (const id of fault.passes ?? [])
        expect(lost, `${id} must keep passing under: ${fault.name}`).not.toContain(id);
      expect(lost.length, 'a fault must not fail the whole bank').toBeLessThan(bank.length);
      rmSync(dir, { recursive: true, force: true });
    },
    60_000,
  );
});

// Cheats of the independent audit (docs/validators.md 12.7): each is a copy of the module that tries to score
// without computing what the item asks. None may gain an item.
describe('cheats of the audit gain nothing', { timeout: 120_000 }, () => {
  async function cheatCopy(name: string, edit: (dir: string) => void): Promise<PointerImpl> {
    return (await cheatLoad(name, edit)).impl;
  }
  async function cheatLoad(
    name: string,
    edit: (dir: string) => void,
  ): Promise<{ impl: PointerImpl; index: string }> {
    const dir = join(MUTANTS, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(join(ROOT, 'packages/estate/src'), join(dir, 'src'), { recursive: true });
    edit(join(dir, 'src', 'pointer'));
    const index = join(dir, 'src/pointer/index.ts');
    return { impl: (await import(/* @vite-ignore */ pathToFileURL(index).href)) as PointerImpl, index };
  }
  /** Scores a cheat the way the validator does: in a child process with locked built-ins, the copy named by the environment. */
  async function scoreCheat(name: string, edit: (dir: string) => void, seed = 1): Promise<string[]> {
    const dir = join(MUTANTS, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(join(ROOT, 'packages/estate/src'), join(dir, 'src'), { recursive: true });
    edit(join(dir, 'src', 'pointer'));
    const index = join(dir, 'src/pointer/index.ts');
    const before = process.env.DRIFTBENCH_POINTER_IMPL;
    process.env.DRIFTBENCH_POINTER_IMPL = index;
    let rows: Awaited<ReturnType<typeof runPointerChild>>;
    try {
      rows = await runPointerChild(seed, ROOT);
    } finally {
      if (before === undefined) delete process.env.DRIFTBENCH_POINTER_IMPL;
      else process.env.DRIFTBENCH_POINTER_IMPL = before;
    }
    return rows.filter((row) => row.misses.length > 0).map((row) => row.id);
  }
  const append = (dir: string, file: string, text: string) =>
    writeFileSync(join(dir, file), `${readFileSync(join(dir, file), 'utf8')}\n${text}\n`);

  it('a module that reads the fixture file at run time fails the source item', async () => {
    const lost = await scoreCheat('c-read', (dir) => {
      writeFileSync(
        join(dir, 'labels.ts'),
        `import { readFileSync } from 'node:fs';\n${readFileSync(join(dir, 'labels.ts'), 'utf8')}\nexport const peek = () => readFileSync('x');\n`,
      );
    });
    expect(lost).toContain('pointer/source/reads-files');
  });

  it.each([
    [
      'names the fixture file',
      'export const f = "packages/validators/fixtures/judges/pointer.json";',
      'names-the-validator',
    ],
    ['reads the arguments of the process', 'export const a = process.argv;', 'reads-process-state'],
    ['reads the call stack', 'export const s = new Error("x").stack;', 'reads-call-stack'],
    ['builds code at run time', 'export const g = new Function("return 1");', 'runs-generated-code'],
    ['patches Array.prototype', 'Array.prototype.push = Array.prototype.push;', 'patches-builtins'],
    ['patches JSON.stringify', 'JSON.stringify = JSON.stringify;', 'patches-builtins'],
  ])('a module that %s fails its source item', async (what, code, id) => {
    const lost = await scoreCheat(`c-${id}`, (dir) => append(dir, 'cassette.ts', code));
    expect(lost).toContain(`pointer/source/${id}`);
  });

  it('a table of the fixture answers passes the fixtures and fails the items drawn from the seed', async () => {
    const units = [...(fixtures['expandUnits.valid'] ?? []), ...(fixtures['expandUnits.invalid'] ?? [])];
    const impl = await cheatCopy('c-table', (dir) => {
      const table = JSON.stringify(Object.fromEntries(units.map((c) => [c.text, c.expect])));
      append(
        dir,
        'labels.ts',
        `const TABLE: Record<string, number[] | null> = ${table};\nexport const expandUnits2 = (t: string) => TABLE[t] ?? undefined;`,
      );
      const text = readFileSync(join(dir, 'labels.ts'), 'utf8').replace(
        'export function expandUnits(units: string): number[] | undefined {',
        'export function expandUnits(units: string): number[] | undefined {\n  return TABLE[units] ?? undefined;\n  // unreachable real code follows',
      );
      writeFileSync(join(dir, 'labels.ts'), text);
    });
    const lost = await failing(impl);
    expect(lost).toContain('pointer/units/expand-valid');
    expect(lost).toContain('pointer/units/expand-invalid');
  });

  it('a label file reader that refuses every file gains no refusal item', async () => {
    const impl = await cheatCopy('c-refuse', (dir) => {
      const text = readFileSync(join(dir, 'labels.ts'), 'utf8').replace(
        'export function parseLabelSets(text: string): LabelSetsResult {',
        'export function parseLabelSets(text: string): LabelSetsResult {\n  return { ok: false, message: "labels name set duplicate condition target description examples yaml none" };',
      );
      writeFileSync(join(dir, 'labels.ts'), text);
    });
    const lost = await failing(impl);
    for (const id of [
      'refuse-names',
      'refuse-duplicates',
      'refuse-conditions',
      'refuse-shape',
      'refuse-yaml',
      'read-valid',
    ])
      expect(lost, id).toContain(`pointer/label-file/${id}`);
  });

  it('an empty or short fixture group fails the items that read it', async () => {
    const empty = {
      ...fixtures,
      'expandUnits.valid': [],
      'expandUnits.invalid': (fixtures['expandUnits.invalid'] ?? []).slice(0, 3),
    } as typeof fixtures;
    const item = bank.find((i) => i.id === 'pointer/units/expand-valid') as PointerItem;
    const other = bank.find((i) => i.id === 'pointer/units/expand-invalid') as PointerItem;
    const impl = await loadPointerImpl();
    expect((await item.run(impl, empty, 1, ROOT)).length).toBeGreaterThan(0);
    expect((await other.run(impl, empty, 1, ROOT)).length).toBeGreaterThan(0);
  });

  it('the seed changes the inputs: two seeds draw different cases, the shipped module passes both', async () => {
    const impl = await loadPointerImpl();
    const item = bank.find((i) => i.id === 'pointer/stack/cascade-sure') as PointerItem;
    for (const seed of [1, 2, 3, 99, 1000123]) expect(await item.run(impl, fixtures, seed, ROOT)).toEqual([]);
  });

  it('a patch of Array.prototype.push built from strings at run time cannot change what the bank records', async () => {
    const lost = await scoreCheat('c-built-push', (dir) =>
      append(
        dir,
        'cassette.ts',
        "const k = ['pu', 'sh'].join(''); (Array.prototype as unknown as Record<string, unknown>)[k] = function () { return 0; };",
      ),
    );
    // the locked built-ins make the patch a TypeError at import: the module does not load and every item fails
    expect(lost.length).toBeGreaterThanOrEqual(bank.length - 7);
  });

  it('a patch of the array iterator or of JSON.stringify in a helper beside the module changes nothing', async () => {
    const lost = await scoreCheat('c-helper-patch', (dir) => {
      mkdirSync(join(dir, '..', '_shim'), { recursive: true });
      writeFileSync(join(dir, '..', '_shim', 'p.mts'), 'JSON.stringify = (() => "") as never;\nexport {};\n');
      append(dir, 'cassette.ts', "import '../_shim/p.mts';");
    });
    expect(lost.length).toBeGreaterThanOrEqual(bank.length - 7);
  });

  it('a helper file kept beside the module is scanned: a file read there fails the source item', async () => {
    const lost = await scoreCheat('c-helper-read', (dir) => {
      mkdirSync(join(dir, '..', '_shim'), { recursive: true });
      writeFileSync(
        join(dir, '..', '_shim', 'r.ts'),
        "import { readFileSync } from 'node:fs';\nexport const x = () => readFileSync('a');\n",
      );
    });
    expect(lost).toContain('pointer/source/reads-files');
  });

  it('an inherited then or toJSON on a built-in, a hook on the output and an exit before the items all fail', async () => {
    const cases: Array<[string, string]> = [
      ['c-then', 'Object.getPrototypeOf([]).then = (r: (v: unknown) => void) => r([]);'],
      ['c-tojson', 'Object.getPrototypeOf([]).toJSON = () => [];'],
      ['c-exit', 'process.exit(0);'],
      [
        'c-exit-late',
        "(process as unknown as { on: (e: string, f: () => void) => void }).on('exit', () => {});",
      ],
      ['c-stdout', 'process.stdout.write = (() => true) as never;'],
      ['c-species', 'Object.getPrototypeOf([]).constructor = { [Symbol.species]: Array };'],
    ];
    for (const [name, code] of cases) {
      const lost = await scoreCheat(name, (dir) => append(dir, 'cassette.ts', code));
      expect(lost.length, name).toBeGreaterThanOrEqual(bank.length - 7);
    }
  });

  it('a module that rewrites its own file while it runs is seen', async () => {
    const lost = await scoreCheat('c-self', (dir) =>
      append(
        dir,
        'cassette.ts',
        "import('node:fs').then((fs) => fs.appendFileSync(import.meta.url.slice(7), '// x'));",
      ),
    );
    expect(lost.length).toBeGreaterThan(0);
  });

  it('a regular expression that looks like a comment hides nothing from the scan', async () => {
    const lost = await scoreCheat('c-regex', (dir) =>
      append(dir, 'cassette.ts', '/\\//; export const a = process.argv;'),
    );
    expect(lost).toContain('pointer/source/reads-process-state');
  });

  it('an import from outside the source tree, or of a package the shipped module does not use, fails its source item', async () => {
    const outside = await scoreCheat('c-outside', (dir) =>
      append(dir, 'cassette.ts', "import '../../../../outside';"),
    );
    expect(outside).toContain('pointer/source/escapes-the-tree');
    const pkg = await scoreCheat('c-package', (dir) => append(dir, 'cassette.ts', "import 'left-pad';"));
    expect(pkg).toContain('pointer/source/escapes-the-tree');
  });

  it('a module that answers from the shipped one reads its file as a changed module, and is a correct one', async () => {
    const lost = await scoreCheat('c-forward', (dir) =>
      append(dir, 'cassette.ts', "export { requestKey as k } from '@agent-nexus/driftbench-estate';"),
    );
    expect(lost).toContain('pointer/source/escapes-the-tree');
  });

  it('the scan reads code in template literals, data files, links and dependency folders of the module tree', async () => {
    const template = await scoreCheat('c-template', (dir) =>
      append(dir, 'cassette.ts', 'const a = `\n/*\n`; export const b = process.argv; const c = `\n*/\n`;'),
    );
    expect(template).toContain('pointer/source/reads-process-state');
    const data = await scoreCheat('c-md', (dir) => writeFileSync(join(dir, '..', 'notes.md'), 'x'));
    expect(data).toContain('pointer/source/escapes-the-tree');
    const link = await scoreCheat('c-link', (dir) => symlinkSync('/tmp', join(dir, 'tmp-link')));
    expect(link).toContain('pointer/source/escapes-the-tree');
    const deps = await scoreCheat('c-deps', (dir) => {
      mkdirSync(join(dir, '..', '..', 'node_modules', 'left-pad'), { recursive: true });
    });
    expect(deps).toContain('pointer/source/escapes-the-tree');
    const bare = await scoreCheat('c-bare', (dir) => {
      writeFileSync(join(dir, 'tapes.json'), '{}');
      append(dir, 'cassette.ts', "import './tapes';");
    });
    expect(bare).toContain('pointer/source/escapes-the-tree');
  });
});
