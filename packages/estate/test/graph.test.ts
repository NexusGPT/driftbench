import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { analyzeGraph, ClaudeCodeReader, declaredLabels, literals, scanEstate } from '../src/index';
import { plantedRoutes } from './pointer/support';
import { answer, estate, NOW, scanFixture } from './support';

const SETTINGS = (command: string) =>
  JSON.stringify(
    { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] } },
    null,
    2,
  );

/** A one-rule estate with one guard, the rule split by a fake model. */
async function oneRule(guard: string, registry?: string) {
  const files: Record<string, string> = {
    'CLAUDE.md': '# Rules\n\n- **R1.** Never touch the vault folder at all.\n- **R2.** Always log the run.\n',
    '.claude/settings.json': SETTINGS('"$CLAUDE_PROJECT_DIR"/.claude/guards/g.sh'),
    '.claude/guards/g.sh': guard,
  };
  if (registry) files['.claude/guards/REGISTRY.md'] = registry;
  const root = await estate(files);
  const port = new FakeModelPort([
    answer('CLAUDE.md', [
      {
        kind: 'instruction',
        title: 'No vault',
        quote: 'Never touch the vault folder at all.',
        evidence: [{ type: 'custom', name: 'v' }],
      },
      {
        kind: 'instruction',
        title: 'Log',
        quote: 'Always log the run.',
        evidence: [{ type: 'custom', name: 'l' }],
      },
    ]),
  ]);
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port, now: NOW });
  const guardAtom = map.atoms.find((atom) => atom.kind === 'guard');
  const enforced = map.atoms.filter((atom) => atom.enforcement.length > 0).map((atom) => atom.title);
  return { map, enforces: guardAtom?.fields?.enforces, enforced };
}

describe('what a guard enforces', () => {
  it('by a registry row that lists rule labels', async () => {
    const result = await oneRule(
      '#!/bin/sh\nexit 0\n',
      '| Id | Guard | Enforces |\n|---|---|---|\n| G1 | g.sh | R2 |\n',
    );
    expect(result.enforced).toEqual(['Log']);
    expect(result.enforces).toEqual([{ atom: 'instruction.standing.log', by: 'registry' }]);
  });

  it('by a label the guard source declares', async () => {
    const result = await oneRule('#!/bin/sh\n# Enforces: R1\nexit 0\n');
    expect(result.enforced).toEqual(['No vault']);
    expect(result.enforces).toEqual([{ atom: 'instruction.standing.no-vault', by: 'id' }]);
  });

  it("by a message in the guard source that repeats the rule's words", async () => {
    const result = await oneRule('#!/bin/sh\necho "never touch the vault folder at all" >&2\nexit 2\n');
    expect(result.enforces).toEqual([{ atom: 'instruction.standing.no-vault', by: 'quote' }]);
  });

  it('by a rule id the guard source cites in the R#n form, against rules labelled R#n', async () => {
    const root = await estate({
      'CLAUDE.md':
        '# Rules\n\n**R#1 — No vault.** Never touch the vault folder at all.\n\n**R#2 — Log.** Always log the run.\n',
      '.claude/settings.json': SETTINGS('"$CLAUDE_PROJECT_DIR"/.claude/guards/g.sh'),
      '.claude/guards/g.sh': '#!/bin/sh\necho "blocked: the vault is closed (R#1)" >&2\nexit 2\n',
    });
    const port = new FakeModelPort([
      answer('CLAUDE.md', [
        {
          kind: 'instruction',
          title: 'No vault',
          quote: 'No vault.** Never touch the vault folder at all.',
          evidence: [{ type: 'custom', name: 'v' }],
        },
        {
          kind: 'instruction',
          title: 'Log',
          quote: 'Log.** Always log the run.',
          evidence: [{ type: 'custom', name: 'l' }],
        },
      ]),
    ]);
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port, now: NOW });
    const guardAtom = map.atoms.find((atom) => atom.kind === 'guard');
    expect(guardAtom?.fields?.enforces).toEqual([{ atom: 'instruction.standing.no-vault', by: 'id' }]);
  });

  it('keeps on a rule the concrete spans of its whole source lines, beyond the words the model quoted', async () => {
    const root = await estate({
      'CLAUDE.md':
        '# Rules\n\n**R#1 — Diagnostics.** Every failure reaches you, any spelling (e.g. `2>/dev/null`, `|| true`).\n',
      '.claude/settings.json': SETTINGS('"$CLAUDE_PROJECT_DIR"/.claude/guards/g.sh'),
      '.claude/guards/g.sh': '#!/bin/sh\necho "swallowed (R#1)" >&2\nexit 2\n',
    });
    const port = new FakeModelPort([
      answer('CLAUDE.md', [
        {
          kind: 'instruction',
          title: 'Failures reach you',
          quote: 'Every failure reaches you, any spelling',
          evidence: [{ type: 'custom', name: 'f' }],
        },
      ]),
    ]);
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port, now: NOW });
    const rule = map.atoms.find((atom) => atom.kind === 'instruction');
    expect(rule?.fields?.spans).toEqual(['2>/dev/null', '|| true']);
  });

  it('by nothing when the guard source names no label and repeats no rule', async () => {
    const result = await oneRule(
      '#!/bin/sh\necho "Something unrelated entirely here" >&2\n# R1 is not declared\nexit 2\n',
    );
    expect(result.enforced).toEqual([]);
    expect(result.enforces).toEqual([]);
  });

  it('reads declared labels and long literals from a source', () => {
    expect(
      declaredLabels('# Enforces: R3, R5\n"""Blocks. Enforces R7 and R8"""\n# enforces nothing\n'),
    ).toEqual(['R3', 'R5', 'R7', 'R8']);
    expect(literals('echo "short" ; echo "a message long enough" ; x = \'another long literal\'')).toEqual([
      'a message long enough',
      'another long literal',
    ]);
  });
});

describe('the fixture graph', () => {
  it('links each guard to the rules it enforces, by registry and by quote', async () => {
    const { map } = await scanFixture();
    const guards = map.atoms.filter((atom) => atom.kind === 'guard');
    expect(
      Object.fromEntries(
        guards.map((guard) => [
          guard.fields?.name,
          ((guard.fields?.enforces ?? []) as Array<{ atom: string; by: string }>).map(
            (entry) => `${entry.by} ${entry.atom}`,
          ),
        ]),
      ),
    ).toEqual({
      'block-force-push.sh': ['registry instruction.standing.r6-never-run-git-push-force'],
      'read-before-edit.py': ['registry instruction.standing.r3-read-a-file-before-you'],
      'ledger-guard.py': ['registry instruction.standing.r4-never-delete-a-file-under'],
      'stop-word.sh': ['registry instruction.standing.r10-when-the-user-says-stop'],
      'reply-length.py': ['quote register.standing.keep-every-reply-under-1-200'],
      'check-carrier.sh': ['registry instruction.shipment-tracker.always-pass-the-carrier-code-to'],
    });
  });

  it('holds the edges of the design', async () => {
    const { map } = await scanFixture();
    const kinds: Record<string, number> = {};
    for (const edge of map.edges) kinds[edge.kind] = (kinds[edge.kind] ?? 0) + 1;
    expect(kinds).toEqual({
      allows: 15,
      dispatch: 1,
      enforces: 6,
      event: 6,
      next: 4,
      reference: 5,
      route: 13,
      script: 2,
    });
    const has = (from: string, kind: string, to: string) =>
      map.edges.some((edge) => edge.from === from && edge.kind === kind && edge.to === to);
    expect(
      has(
        'skill.invoice-reconcile.skill-invoice-reconcile',
        'dispatch',
        'subagent.ledger-auditor.helper-ledger-auditor',
      ),
    ).toBe(true);
    expect(
      has(
        'subagent.route-planner.helper-route-planner',
        'allows',
        'skill.shipment-tracker.skill-shipment-tracker',
      ),
    ).toBe(true);
    expect(
      has('stage.steps.stage-verify-run-the-check-that', 'next', 'stage.steps.stage-do-make-the-change'),
    ).toBe(true);
    expect(has('guard.settings.stop-guard-reply-length-py', 'event', 'event.Stop')).toBe(true);
    expect(map.edges.filter((edge) => edge.kind === 'next').some((edge) => edge.from.includes('note'))).toBe(
      false,
    );
  });

  it('finds the orphan, the unreachable helper and the unenforced rules', async () => {
    const { map, raw } = await scanFixture();
    const analysis = analyzeGraph(map.atoms, map.edges, raw.files);
    expect(analysis.orphans).toEqual([
      '.claude/skills/invoice-reconcile/references/currency-table.md',
      '.claude/skills/invoice-reconcile/references/old-tolerances.md',
    ]);
    expect(analysis.unreachableFiles).toEqual(['.claude/agents/inbox-triager.md']);
    expect(analysis.missingReferences).toEqual([
      'reference.weekly-report.read-references-kpi-definitions-md',
    ]);
    expect(analysis.missingScripts).toEqual([]);
    const rules = map.atoms.filter((atom) => ['instruction', 'gate', 'register'].includes(atom.kind));
    expect(rules).toHaveLength(64);
    expect(analysis.unenforced).toHaveLength(58);
    expect(analysis.reachableFiles.has('.claude/skills/weekly-report/templates/report.md')).toBe(true);
    expect(analysis.reachableAtoms.has('subagent.inbox-triager.helper-inbox-triager')).toBe(false);
  });
});

describe('reachability', () => {
  it('reaches a skill only through the standing instructions, not through its own description', async () => {
    const skill = '---\nname: notes\ndescription: Take notes.\n---\n\nRead `ref.md` first.\n';
    const lone = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/skills/notes/SKILL.md': skill,
      '.claude/skills/notes/ref.md': 'x\n',
    });
    const routed = await estate({
      'CLAUDE.md': '# Rules\n\n| Ask | Load |\n|---|---|\n| take a note | `notes` |\n',
      '.claude/skills/notes/SKILL.md': skill,
      '.claude/skills/notes/ref.md': 'x\n',
    });
    const skillAtom = 'skill.notes.skill-notes';
    for (const [root, reachable] of [
      [lone, false],
      [routed, true],
    ] as const) {
      const { map, raw } = await scanEstate({
        root,
        reader: new ClaudeCodeReader(),
        now: NOW,
        pointer: plantedRoutes({ 'take a note': ['route-skill', skillAtom] }),
      });
      const analysis = analyzeGraph(map.atoms, map.edges, raw.files);
      expect(analysis.reachableFiles.has('.claude/skills/notes/ref.md')).toBe(reachable);
      expect(analysis.unreachableFiles.includes('.claude/skills/notes/SKILL.md')).toBe(!reachable);
      expect(analysis.orphans).toEqual([]);
    }
  });
});

describe('dispatch edges', () => {
  const files = {
    '.claude/skills/parcels/SKILL.md':
      '---\nname: parcels\ndescription: Review parcels.\n---\n\nHand the batch to parcel-check.\n\nNever use parcel-check for weather.\n',
    '.claude/agents/parcel-check.md': '---\nname: parcel-check\ndescription: Check parcels.\n---\n',
  };
  const helper = 'subagent.parcel-check.helper-parcel-check';
  const dispatches = async (links: Record<string, [string, string]>) => {
    const { map } = await scanEstate({
      root: await estate(files),
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: plantedRoutes(links, '.claude/skills/parcels/SKILL.md'),
    });
    return map.edges.filter((edge) => edge.kind === 'dispatch');
  };

  it('has an edge from the unit that carries a dispatches link, and from nothing else', async () => {
    expect(await dispatches({ 'Hand the batch': ['dispatch', helper] })).toEqual([
      { from: 'skill.parcels.skill-parcels', to: helper, kind: 'dispatch' },
    ]);
    expect(await dispatches({})).toEqual([]);
  });

  it('drops a dispatches link to an atom the estate does not hold', async () => {
    expect(await dispatches({ 'Hand the batch': ['dispatch', 'subagent.ghost.helper-ghost'] })).toEqual([]);
  });
});
