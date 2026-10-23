import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type RoutingRule,
  type RuntimeProfile,
  registerRuntimeProfile,
  runtimeProfile,
} from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, type LintFinding, lintEstate, scanEstate } from '../src/index';
import { plantedRoutes } from './pointer/support';
import { NOW } from './support';

/**
 * The rule under test, stated over the runtime profile and not over a layout: a unit the standing instructions do
 * not lead to is reachable when the runtime's profile lists `description` among its routing rules and the unit
 * gives a description. Such a unit is reported as information (REACHED_BY_DESCRIPTION); any other unit that no
 * route leads to stays UNREACHABLE. A unit the standing instructions do lead to is neither.
 *
 * The expected value of every case comes from that sentence, written before the product ran, never from the
 * product's output. Only `description` is consulted today: `route-table` and `name` are declared by the profile
 * and do not change what is reachable, which the matrix below holds fixed on purpose.
 */

type Kind = 'skill' | 'helper';
type Variant = { kind: Kind; name: string; described: boolean; tabled: boolean };

const ROUTINGS: Array<readonly RoutingRule[]> = [
  [],
  ['description'],
  ['route-table'],
  ['route-table', 'name'],
  ['route-table', 'description'],
  ['route-table', 'description', 'name'],
];
// Names with a digit, an upper-case letter and an underscore: the rule must not depend on a name's shape.
const NAMES = ['ledger-desk', 'Harbour_Notes', 'pier2'];

/** The profile of the Claude Code runtime, under another name and another routing: only the routing differs. */
function profileWith(routing: readonly RoutingRule[]): string {
  const name = `routing-test-${routing.join('+') || 'none'}`;
  if (!runtimeProfile(name)) {
    const base = runtimeProfile('claude-code') as RuntimeProfile;
    registerRuntimeProfile({ ...base, name, routing });
  }
  return name;
}

function files(variant: Variant): Record<string, string> {
  const front = (extra: string) => `---\nname: ${variant.name}\n${extra}---\n\n# ${variant.name}\n\nBody.\n`;
  const description = variant.described ? `description: Keeps the ${variant.name} records.\n` : '';
  const path =
    variant.kind === 'skill'
      ? `.claude/skills/${variant.name}/SKILL.md`
      : `.claude/agents/${variant.name}.md`;
  const table = variant.tabled
    ? `\n| When the user wants to | Load |\n|---|---|\n| ask about ${variant.name} | \`${variant.name}\` |\n`
    : '';
  return { 'CLAUDE.md': `# Standing\n\nEverything here is invented.\n${table}`, [path]: front(description) };
}

async function write(tree: Record<string, string>, into?: string): Promise<string> {
  const root = into ?? (await mkdtemp(join(tmpdir(), 'driftbench-routing-')));
  for (const [path, text] of Object.entries(tree)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** The lint findings of an estate read as the Claude Code reader reads it, judged under a profile's routing. */
async function findingsUnder(
  routing: readonly RoutingRule[],
  variant: Variant,
  into?: string,
): Promise<LintFinding[]> {
  const root = await write(files(variant), into);
  const reader = new ClaudeCodeReader();
  const first = await scanEstate({ root, reader, now: NOW });
  const atom = first.map.atoms.find(
    (each) => each.kind === (variant.kind === 'skill' ? 'skill' : 'subagent'),
  );
  const { map, raw } = await scanEstate({
    root,
    reader,
    now: NOW,
    ...(variant.tabled && atom
      ? {
          pointer: plantedRoutes({
            [`ask about ${variant.name}`]: [
              variant.kind === 'skill' ? 'route-skill' : 'route-helper',
              atom.id,
            ],
          }),
        }
      : {}),
  });
  return lintEstate(map, { ...raw, runtime: profileWith(routing) }).findings.filter(
    (finding) => finding.code === 'UNREACHABLE' || finding.code === 'REACHED_BY_DESCRIPTION',
  );
}

/** What the rule says about a variant, as the pair [code, subject-ends-with] the lint should give, or none. */
function expected(routing: readonly RoutingRule[], variant: Variant): Array<[string, string]> {
  if (variant.tabled) return [];
  const path = variant.kind === 'skill' ? `${variant.name}/SKILL.md` : `agents/${variant.name}.md`;
  if (routing.includes('description') && variant.described) return [['REACHED_BY_DESCRIPTION', path]];
  return [['UNREACHABLE', path]];
}

const shape = (findings: readonly LintFinding[]): Array<[string, string]> =>
  findings.map((finding) => [finding.code, finding.subject]);

const matches = (findings: readonly LintFinding[], want: Array<[string, string]>): boolean =>
  findings.length === want.length &&
  want.every(([code, ending]) => findings.some((f) => f.code === code && f.subject.endsWith(ending)));

describe('a unit with a description is reached by it when the profile routes by description', () => {
  it('holds across routing rules, kinds, names, descriptions and route tables', async () => {
    const variants: Variant[] = [];
    for (const kind of ['skill', 'helper'] as const)
      for (const name of NAMES)
        for (const described of [true, false])
          for (const tabled of [true, false]) variants.push({ kind, name, described, tabled });
    for (const routing of ROUTINGS) {
      for (const variant of variants) {
        const found = await findingsUnder(routing, variant);
        const label = JSON.stringify({ routing, ...variant });
        expect(matches(found, expected(routing, variant)), `${label}: ${JSON.stringify(shape(found))}`).toBe(
          true,
        );
      }
    }
  }, 240_000);

  it('never changes with the routing rules the profile adds besides description', async () => {
    for (const variant of [
      { kind: 'skill', name: 'ledger-desk', described: true, tabled: false },
      { kind: 'helper', name: 'pier2', described: false, tabled: false },
    ] as const) {
      const withDescription = [
        ['description'],
        ['route-table', 'description'],
        ['description', 'name'],
        ['route-table', 'description', 'name'],
      ] as const;
      const baseline = shape(await findingsUnder(withDescription[0], variant));
      for (const routing of withDescription.slice(1))
        expect(shape(await findingsUnder(routing, variant))).toEqual(baseline);
    }
  });

  it('keeps a runtime with no profile at the old result: nothing is reached by description', async () => {
    const variant: Variant = { kind: 'skill', name: 'ledger-desk', described: true, tabled: false };
    const root = await write(files(variant));
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const found = lintEstate(map, { ...raw, runtime: 'no-such-runtime' }).findings.filter(
      (finding) => finding.code === 'UNREACHABLE' || finding.code === 'REACHED_BY_DESCRIPTION',
    );
    expect(shape(found)).toEqual([['UNREACHABLE', '.claude/skills/ledger-desk/SKILL.md']]);
  });
});

describe('metamorphic: changes that must not alter the findings, and changes that must', () => {
  const routing = ['route-table', 'description'] as const;
  const variant: Variant = { kind: 'skill', name: 'pier2', described: true, tabled: false };

  it('does not change when the estate moves to another folder', async () => {
    const a = await findingsUnder(routing, variant);
    const b = await findingsUnder(routing, variant);
    expect(shape(b)).toEqual(shape(a));
  });

  it('does not change when ignored junk is added beside the unit', async () => {
    const root = await write(files(variant));
    await write(
      {
        '.claude/skills/pier2/node_modules/pkg/SKILL.md': '---\nname: junk\n---\n',
        '.claude/skills/pier2/.DS_Store': 'x',
        'node_modules/pkg/CLAUDE.md': '# not an instruction\n',
      },
      root,
    );
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const found = lintEstate(map, { ...raw, runtime: profileWith(routing) }).findings.filter(
      (finding) => finding.code === 'UNREACHABLE' || finding.code === 'REACHED_BY_DESCRIPTION',
    );
    expect(shape(found)).toEqual(shape(await findingsUnder(routing, variant)));
  });

  it('does not change when the unit is renamed together with its folder', async () => {
    const renamed = await findingsUnder(routing, { ...variant, name: 'dock-roster' });
    expect(renamed.map((finding) => finding.code)).toEqual(
      (await findingsUnder(routing, variant)).map((finding) => finding.code),
    );
  });

  it('changes when the description is removed: the unit is then unreachable', async () => {
    const before = await findingsUnder(routing, variant);
    const after = await findingsUnder(routing, { ...variant, described: false });
    expect(before.map((f) => f.code)).toEqual(['REACHED_BY_DESCRIPTION']);
    expect(after.map((f) => f.code)).toEqual(['UNREACHABLE']);
  });

  it('changes when the standing instructions come to name the unit: it is then neither', async () => {
    const after = await findingsUnder(routing, { ...variant, tabled: true });
    expect(after).toEqual([]);
  });

  it('changes when the profile stops routing by description', async () => {
    const after = await findingsUnder(['route-table'], variant);
    expect(after.map((f) => f.code)).toEqual(['UNREACHABLE']);
  });
});

describe('the lint outcome of the description check says what it read and what it left out', () => {
  const variant: Variant = { kind: 'skill', name: 'pier2', described: true, tabled: false };

  it('reads the description routes when the profile routes by description', async () => {
    const root = await write(files(variant));
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const result = lintEstate(map, { ...raw, runtime: profileWith(['description']) });
    const outcome = result.outcomes.find((each) => each.check === 'REACHED_BY_DESCRIPTION');
    expect(outcome?.coverage.read).toBe(1);
    expect(outcome?.coverage.skipped).toEqual([]);
    expect(outcome?.findings).toHaveLength(1);
  });

  it('skips them, with the reason, when it does not', async () => {
    const root = await write(files(variant));
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const result = lintEstate(map, { ...raw, runtime: profileWith(['route-table']) });
    const outcome = result.outcomes.find((each) => each.check === 'REACHED_BY_DESCRIPTION');
    expect(outcome?.status).toBe('not-run');
    expect(outcome?.notRun).toBe('no-input');
    expect(outcome?.coverage.skipped).toEqual([
      { what: '1 routes given by a description', reason: 'runtime-does-not-route-by-description' },
    ]);
  });

  it('is not-run, never a pass, when the estate has no unit with a description', async () => {
    const root = await write(files({ ...variant, described: false }));
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const outcome = lintEstate(map, { ...raw, runtime: profileWith(['description']) }).outcomes.find(
      (each) => each.check === 'REACHED_BY_DESCRIPTION',
    );
    expect(outcome?.status).toBe('not-run');
  });
});
