import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadStateLibrary, opsForTurn } from '@agent-nexus/driftbench-adapters';
import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { type EstateGenerateInput, generateEstateSuite } from '../../src/estate/generate';
import { defaultStateLibrary, stateIdsOf } from '../../src/estate/states';

const CELLS: Record<string, Record<string, string>> = {
  fresh: {},
  long: { session_state: 'long' },
  compaction: { session_state: 'long', estate_hazard: 'compaction_mid_task' },
  resumed: { session_state: 'resumed' },
  helpers: { session_state: 'helpers_running' },
  dead: { estate_hazard: 'dead_helper' },
};

function input(): EstateGenerateInput {
  const atom = {
    id: 'hazard.archive.recovery',
    kind: 'hazard',
    title: 'Recover the archive session',
    approved: true,
    fields: { hazard: 'compaction' },
    provenance: { quote: 'After compaction, re-read POLICY.md before continuing.', file: 'POLICY.md' },
    evidence: [
      {
        type: 'custom' as const,
        name: 'hazard_recovery',
        options: { hazard: 'compaction', reread: ['POLICY.md'] },
      },
    ],
  };
  return {
    map: { runtime: 'claude-code', hash: 'states', atoms: [atom] },
    plan: {
      mapHash: 'states',
      rows: Object.entries(CELLS).map(([id, cell]) => ({
        id,
        atomIds: [atom.id],
        cell,
        testType: 'hazard_recovery',
        mode: 'live' as const,
        status: 'approved' as const,
      })),
    },
    bank: {
      version: 1,
      estate: 'archive',
      mapHash: 'states',
      deviations: [],
      workspaces: [],
      situations: [
        {
          id: 'recover',
          title: 'Continue archive review',
          use: 'trigger',
          atoms: [atom.id],
          phrases: [{ text: 'Continue reviewing the archive.', lang: 'en', approved: true }],
          touches: { created: [], changed: [], deleted: [] },
        },
      ],
    },
  };
}

const PATHS = { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' };

function varsOf(file: { path: string; text: string }): Record<string, unknown> {
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return (parsed.spec.given as { vars?: Record<string, unknown> } | undefined)?.vars ?? {};
}

describe('the session states and events a generated spec sets', () => {
  it('without a library, a spec sets a state no library of the estate holds (the defect)', () => {
    const result = generateEstateSuite(input(), { judge: false, paths: PATHS });
    const set = result.files
      .filter((file) => file.path.startsWith('specs/'))
      .map((file) => varsOf(file).session_state)
      .filter((value) => value !== undefined);
    expect(set).toContain('helpers_running');
  });

  it('with the default library, every complete spec sets only a state and an event the library holds', () => {
    const { ids } = defaultStateLibrary();
    const result = generateEstateSuite(input(), { judge: false, stateIds: ids, paths: PATHS });
    const complete = result.files.filter((file) => file.path.startsWith('specs/'));
    expect(complete.length).toBeGreaterThan(0);
    for (const file of complete) {
      const vars = varsOf(file);
      if (typeof vars.session_state === 'string' && vars.session_state !== 'fresh')
        expect(ids.states, file.path).toContain(vars.session_state);
      if (typeof vars.event === 'string') expect(ids.events, file.path).toContain(vars.event);
    }
    expect(complete.map((file) => varsOf(file).session_state)).toContain('long');
  });

  it('a row that needs a state the library lacks waits in incomplete/, named, and is counted', () => {
    const { ids } = defaultStateLibrary();
    const result = generateEstateSuite(input(), { judge: false, stateIds: ids, paths: PATHS });
    const waiting = result.report.incomplete.filter((entry) =>
      entry.reasons.some((reason) => reason.marker === 'needs-state-operation'),
    );
    expect(waiting.map((entry) => entry.row).sort()).toEqual(['dead', 'helpers', 'resumed']);
    expect(
      [...new Set(waiting.flatMap((entry) => entry.reasons.map((reason) => reason.detail)))].sort(),
    ).toEqual(['event dead_helper', 'session state helpers_running', 'session state resumed']);
    for (const entry of waiting) expect(entry.path.startsWith('incomplete/')).toBe(true);
  });

  it('a library that holds a state lets its row be complete', () => {
    const ids = {
      states: ['long', 'resumed', 'helpers_running'],
      events: ['compaction_mid_task', 'dead_helper'],
    };
    const result = generateEstateSuite(input(), { judge: false, stateIds: ids, paths: PATHS });
    expect(
      result.report.incomplete.some((entry) =>
        entry.reasons.some((reason) => reason.marker === 'needs-state-operation'),
      ),
    ).toBe(false);
  });
});

describe('the default state library', () => {
  it('loads in the live runner, and every state and event it names has an operation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-states-'));
    try {
      const library = defaultStateLibrary();
      for (const file of library.files) {
        await mkdir(dirname(join(root, file.path)), { recursive: true });
        await writeFile(join(root, file.path), file.text);
      }
      const loaded = await loadStateLibrary(join(root, 'states/library.json'));
      for (const state of library.ids.states)
        expect(opsForTurn(loaded, { session_state: state }, 0, new Set()), state).not.toEqual([]);
      for (const event of library.ids.events)
        expect(opsForTurn(loaded, { event }, 0, new Set()), event).not.toEqual([]);
      expect(stateIdsOf(library.files[0]?.text ?? '')).toEqual(library.ids);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('holds no state that needs the estate own content', () => {
    const { ids } = defaultStateLibrary();
    for (const needsContent of ['resumed', 'helpers_running']) expect(ids.states).not.toContain(needsContent);
    for (const needsContent of ['stale_tracker', 'dead_helper', 'helper_stopped'])
      expect(ids.events).not.toContain(needsContent);
  });
});
