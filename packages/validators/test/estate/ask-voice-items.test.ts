import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { coverageFamily, isDescriptionVoice, taskFamily } from '../../src/ladders/estate/bank/genquality';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';
import type { MapAtom } from '../../src/ladders/estate/reference-ask';

/**
 * The oracle tests of three validator items, each against a planted bad product (a generator that does the wrong
 * thing, simulated by changing what it wrote), with the control run first: the unchanged product passes. A planted
 * product that the item still passes would mean the item cannot fail on that fault.
 *
 *  - gen.asks.code-ask-claims-no-voice: a spec asked by code lists the voice axes its cell names under `unexpressed`
 *    and a spec asked by a phrase lists none.
 *  - gen.task.no-description-voice: no code-written ask has a span cut from a route read from a description or from
 *    a unit whose passage is its description.
 *  - gen.coverage.one-per-route: a route read from a description may lack a complete spec only while the report
 *    discloses it under `needs-askable-act`.
 */

const map = parse(readFileSync(join(fixture.FIXTURE, 'approved.yaml'), 'utf8')) as { atoms: MapAtom[] };
const viaOf = (atom: MapAtom) => (atom.fields as { via?: unknown } | undefined)?.via;
/** A route read from a description, and a route that was not (a request cell of the routing table). */
const DESCRIBED = map.atoms.find((atom) => atom.kind === 'route' && viaOf(atom) === 'description') as MapAtom;
const REQUESTED = map.atoms.find((atom) => atom.kind === 'route' && viaOf(atom) !== 'description') as MapAtom;
type Estate = {
  ask?: string;
  askFrom?: string;
  askBuild?: Array<{ spans?: Array<{ atom?: string }> } | null>;
  cell?: Record<string, string>;
  unexpressed?: string[];
};
type Loaded = { metadata?: { estate?: Estate }; blocks: Array<{ when?: { user?: string } }> };

describe('gen.asks.code-ask-claims-no-voice, against planted products', { timeout: 600_000 }, () => {
  async function verdict(run: pipeline.EstateRun) {
    const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(run);
    try {
      return (await genAsksFamily().evaluate(1)).get('gen.asks.code-ask-claims-no-voice');
    } finally {
      mock.mockRestore();
    }
  }
  async function planted(
    pick: (estate: Estate) => boolean,
    edit: (estate: Estate) => void,
  ): Promise<pipeline.EstateRun> {
    const run = await pipeline.estateRun(1);
    const specs = structuredClone(run.specs);
    const target = specs.find((spec) => {
      const estate = (spec.loaded?.spec as unknown as Loaded | undefined)?.metadata?.estate;
      return spec.record.complete && estate !== undefined && pick(estate);
    });
    if (!target?.loaded) throw new Error('no spec to plant the fault in');
    edit((target.loaded.spec as unknown as Loaded).metadata?.estate as Estate);
    return { ...run, specs };
  }

  it('passes the product as the generator wrote it', async () => {
    expect(await verdict(await pipeline.estateRun(1))).toEqual({ pass: true, detail: 'holds' });
  });

  it('fails a code-written ask whose spec claims the voice of its cell: unexpressed is gone', async () => {
    const out = await verdict(
      await planted(
        (estate) => estate.ask === 'code' && (estate.unexpressed ?? []).length > 0,
        (estate) => {
          estate.unexpressed = undefined;
        },
      ),
    );
    expect(out?.pass).toBe(false);
    expect(out?.detail).toContain('claim a voice their ask does not carry');
  });

  it('fails a code-written ask that lists only one of the axes its cell names', async () => {
    const out = await verdict(
      await planted(
        (estate) => estate.ask === 'code' && (estate.unexpressed ?? []).length > 1,
        (estate) => {
          estate.unexpressed = (estate.unexpressed ?? []).slice(0, 1);
        },
      ),
    );
    expect(out?.pass).toBe(false);
  });

  it('fails a code-written ask that lists an axis its cell does not name', async () => {
    const out = await verdict(
      await planted(
        (estate) => estate.ask === 'code' && (estate.unexpressed ?? []).length === 0,
        (estate) => {
          estate.unexpressed = ['owner_signal'];
        },
      ),
    );
    expect(out?.pass).toBe(false);
  });

  it('fails an ask by an approved phrase that disclaims a voice: the phrase carries it', async () => {
    const out = await verdict(
      await planted(
        (estate) => estate.ask === 'bank',
        (estate) => {
          estate.unexpressed = ['ask_shape'];
        },
      ),
    );
    expect(out?.pass).toBe(false);
  });
});

describe('gen.task.no-description-voice, against planted products', { timeout: 600_000 }, () => {
  async function verdict(edit?: (spec: Loaded) => void) {
    const suite = await fixture.fixtureSuite();
    const copy = structuredClone(suite.specs);
    if (edit) {
      const target = copy.find(
        (spec) =>
          spec.complete &&
          (spec.spec.metadata?.estate as Estate | undefined)?.ask === 'code' &&
          Array.isArray((spec.spec.metadata?.estate as Estate).askBuild),
      );
      if (!target) throw new Error('no complete code-asked spec in the fixture suite');
      edit(target.spec as unknown as Loaded);
    }
    const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue({ ...suite, specs: copy });
    try {
      return (await taskFamily().evaluate(1)).get('gen.task.no-description-voice');
    } finally {
      mock.mockRestore();
    }
  }
  const cutFrom = (atom: string) => (spec: Loaded) => {
    const estate = spec.metadata?.estate as Estate;
    const build = (estate.askBuild ?? []).find((each) => each?.spans?.length);
    if (!build?.spans?.[0]) throw new Error('the code-asked spec records no span');
    build.spans[0].atom = atom;
  };

  it('has the fixture atoms the planted products need', () => {
    expect(DESCRIBED?.id).toBeDefined();
    expect(REQUESTED?.id).toBeDefined();
  });

  it('passes the product as the generator wrote it', async () => {
    expect(await verdict()).toMatchObject({ pass: true });
  });

  it('fails an ask cut from a route read from a description', async () => {
    const out = await verdict(cutFrom(DESCRIBED.id));
    expect(out?.pass).toBe(false);
    expect(out?.detail).toContain('cut from a description');
  });

  it('reads a span source by structure: a route from a description, or a unit whose passage is its description', () => {
    const atom = (kind: string, fields: Record<string, unknown>, quote = 'x') =>
      ({ id: `${kind}.a`, kind, title: 'a', fields, provenance: { file: 'f', quote } }) as unknown as MapAtom;
    const said = 'Keeps the berth ledger.';
    const cases: Array<[string, MapAtom | undefined, boolean]> = [
      ['a route read from a description', atom('route', { via: 'description' }), true],
      ['a route of the routing table', atom('route', { via: 'pointer', ask: 'moor the ferry' }), false],
      ['a route with no via', atom('route', { ask: 'moor the ferry' }), false],
      ['a skill whose passage is its description', atom('skill', { description: said }, said), true],
      ['a helper whose passage is its description', atom('subagent', { description: said }, said), true],
      [
        'a skill whose passage holds more',
        atom('skill', { description: said }, `${said} Use when asked.`),
        false,
      ],
      ['a rule', atom('instruction', { description: said }, said), false],
      ['an atom the map does not hold', undefined, false],
    ];
    for (const [name, each, want] of cases) expect(isDescriptionVoice(each), name).toBe(want);
  });

  it('passes an ask cut from a route that is a request of the routing table', async () => {
    expect(await verdict(cutFrom(REQUESTED.id))).toMatchObject({ pass: true });
  });
});

describe('gen.coverage.one-per-route, against planted products', { timeout: 600_000 }, () => {
  type Gap = { marker: string; specs: number; atoms: string[] };
  /** The fixture suite with every complete spec that names the atom dropped, and the report's gap list as given. */
  async function verdict(drop: string, gaps: (gaps: Gap[]) => Gap[]) {
    const suite = await fixture.fixtureSuite();
    const specs = suite.specs.filter((spec) => !(spec.complete && spec.atoms.includes(drop)));
    const report = { ...suite.report, gaps: gaps(structuredClone(suite.report.gaps ?? [])) };
    const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue({ ...suite, specs, report });
    try {
      return (await coverageFamily().evaluate(1)).get('gen.coverage.one-per-route');
    } finally {
      mock.mockRestore();
    }
  }
  const asking =
    (atom: string) =>
    (gaps: Gap[]): Gap[] => {
      const found = gaps.find((gap) => gap.marker === 'needs-askable-act');
      if (found) found.atoms = [...new Set([...found.atoms, atom])];
      else gaps.push({ marker: 'needs-askable-act', specs: 1, atoms: [atom] });
      return gaps;
    };
  const silent = (gaps: Gap[]): Gap[] =>
    gaps.map((gap) =>
      gap.marker === 'needs-askable-act'
        ? { ...gap, atoms: gap.atoms.filter((id) => id !== DESCRIBED.id) }
        : gap,
    );

  it('passes the product as the generator wrote it', async () => {
    expect((await coverageFamily().evaluate(1)).get('gen.coverage.one-per-route')).toMatchObject({
      pass: true,
    });
  });

  it('passes a description route with no complete spec while the report discloses it as waiting', async () => {
    expect(await verdict(DESCRIBED.id, asking(DESCRIBED.id))).toMatchObject({ pass: true });
  });

  it('fails a description route with no complete spec that the report does not list', async () => {
    const out = await verdict(DESCRIBED.id, silent);
    expect(out?.pass).toBe(false);
    expect(out?.detail).toContain(DESCRIBED.id);
  });

  it('fails a route of the routing table with no complete spec, even when the report lists it as waiting', async () => {
    const out = await verdict(REQUESTED.id, asking(REQUESTED.id));
    expect(out?.pass).toBe(false);
    expect(out?.detail).toContain(REQUESTED.id);
  });
});
