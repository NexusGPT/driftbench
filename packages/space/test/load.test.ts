import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSpaceMap,
  parseSpaceMapText,
  SpaceMapIssueCodes,
  type SpaceMapResult,
  validateSpaceMap,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { tempFolder } from '../../../tools/test-setup/temp-folders';
import { HAND } from './support';

const ACME = fileURLToPath(new URL('./fixtures/acme-space.yaml', import.meta.url));

type RawValue = { id: string; title: string; weight?: number; required?: boolean; [key: string]: unknown };
type RawDimension = { id: string; title: string; kind: string; values: RawValue[] };
type RawMap = {
  version?: string;
  agent?: string;
  dimensions: RawDimension[];
  constraints?: Array<{ forbid: Record<string, string>; reason?: string }>;
  prior?: { kind: string; source?: string; weights?: Record<string, Record<string, number>> };
  [key: string]: unknown;
};

/** The hand map as a mutable copy, changed by `edit`. */
function variant(edit: (raw: RawMap) => void): RawMap {
  const raw = structuredClone(HAND) as unknown as RawMap;
  edit(raw);
  return raw;
}

function dimension(raw: RawMap, index: number): RawDimension {
  const found = raw.dimensions[index];
  if (!found) throw new Error(`the test map has no dimension ${index}`);
  return found;
}

function value(raw: RawMap, index: number, position: number): RawValue {
  const found = dimension(raw, index).values[position];
  if (!found) throw new Error(`dimension ${index} of the test map has no value ${position}`);
  return found;
}

function constraint(raw: RawMap, index: number): { forbid: Record<string, string>; reason?: string } {
  const found = raw.constraints?.[index];
  if (!found) throw new Error(`the test map has no constraint ${index}`);
  return found;
}

function issues(result: SpaceMapResult): string[] {
  return result.ok ? [] : result.errors.map((issue) => `${issue.code} ${issue.path}`);
}

const PERSONAS = (values: string[]) => ({
  id: `persona-${values.join('-')}`,
  title: 'Persona',
  kind: 'persona',
  values: values.map((id) => ({ id, title: id })),
});

/** Each case: a name, a map, and the issues it must produce, as `CODE path`. */
const REFUSALS: Array<[string, unknown, string[]]> = [
  ['a list instead of a mapping', [], ['SPACE_NOT_OBJECT ']],
  [
    'a missing constraints key',
    variant((raw) => {
      raw.constraints = undefined;
    }),
    ['SCHEMA_INVALID_TYPE constraints'],
  ],
  [
    'an unknown top-level key',
    variant((raw) => {
      raw.extra = 1;
    }),
    ['SCHEMA_UNRECOGNIZED_KEYS '],
  ],
  [
    'an unknown kind',
    variant((raw) => {
      dimension(raw, 0).kind = 'mood';
    }),
    ['SCHEMA_INVALID_VALUE dimensions.0.kind'],
  ],
  [
    'a dimension without values',
    variant((raw) => {
      dimension(raw, 2).values = [];
    }),
    ['SCHEMA_TOO_SMALL dimensions.2.values'],
  ],
  [
    'an id with a space',
    variant((raw) => {
      value(raw, 0, 0).id = 'stage a';
    }),
    ['SCHEMA_INVALID_FORMAT dimensions.0.values.0.id'],
  ],
  [
    'a negative weight',
    variant((raw) => {
      value(raw, 0, 0).weight = -1;
    }),
    ['SCHEMA_TOO_SMALL dimensions.0.values.0.weight'],
  ],
  [
    'a value with an unknown key',
    variant((raw) => {
      value(raw, 2, 0).share = 0.5;
    }),
    ['SCHEMA_UNRECOGNIZED_KEYS dimensions.2.values.0'],
  ],
  [
    'a constraint without a reason',
    variant((raw) => {
      constraint(raw, 0).reason = undefined;
    }),
    ['SCHEMA_INVALID_TYPE constraints.0.reason'],
  ],
  [
    'two dimensions with one id',
    variant((raw) => {
      raw.dimensions.push({ ...PERSONAS(['terse']), id: 'stage' });
    }),
    ['SPACE_DUPLICATE dimensions.3.id'],
  ],
  [
    'a value listed twice',
    variant((raw) => {
      dimension(raw, 2).values.push({ id: 'chat', title: 'Chat again' });
    }),
    ['SPACE_DUPLICATE dimensions.2.values.2.id'],
  ],
  [
    'two stage dimensions',
    variant((raw) => {
      raw.dimensions.push({ id: 'phase', title: 'Phase', kind: 'stage', values: [{ id: 'x', title: 'X' }] });
    }),
    ['SPACE_KIND_REPEATED dimensions.3.kind'],
  ],
  [
    'a deviation value that is no deviation class',
    variant((raw) => {
      value(raw, 1, 1).id = 'D11_shouting';
    }),
    // The constraint names the old id, so it no longer resolves either.
    [
      'SPACE_UNKNOWN_DEVIATION dimensions.1.values.1.id',
      'SPACE_UNKNOWN_VALUE constraints.0.forbid.deviation',
    ],
  ],
  [
    'a persona value in two persona dimensions',
    variant((raw) => {
      raw.dimensions.push(PERSONAS(['terse', 'none']), PERSONAS(['verbose', 'terse']));
    }),
    ['SPACE_AMBIGUOUS_VALUE dimensions.4.values.1.id'],
  ],
  [
    'weights on some values only',
    variant((raw) => {
      value(raw, 0, 1).weight = undefined;
    }),
    ['SPACE_PRIOR_INCOMPLETE dimensions.0.values.1.weight'],
  ],
  [
    'weights that are all 0',
    variant((raw) => {
      value(raw, 0, 0).weight = 0;
      value(raw, 0, 1).weight = 0;
    }),
    ['SPACE_PRIOR_ZERO dimensions.0.values'],
  ],
  [
    'a constraint that names nothing',
    variant((raw) => {
      constraint(raw, 0).forbid = {};
    }),
    ['SPACE_EMPTY_CONSTRAINT constraints.0.forbid'],
  ],
  [
    'a constraint on an unknown dimension',
    variant((raw) => {
      constraint(raw, 0).forbid = { mood: 'calm' };
    }),
    ['SPACE_UNKNOWN_DIMENSION constraints.0.forbid.mood'],
  ],
  [
    'a constraint on an unknown value',
    variant((raw) => {
      constraint(raw, 0).forbid.channel = 'fax';
    }),
    ['SPACE_UNKNOWN_VALUE constraints.0.forbid.channel'],
  ],
  [
    'the same constraint twice, keys in another order',
    variant((raw) => {
      raw.constraints?.push({
        forbid: { channel: 'whatsapp', deviation: 'D4_loose_confirmation' },
        reason: 'Again.',
      });
    }),
    ['SPACE_DUPLICATE constraints.1'],
  ],
  [
    'a fitted prior with no source',
    variant((raw) => {
      raw.prior = { kind: 'fitted' };
    }),
    ['SPACE_PRIOR_SOURCE prior.source'],
  ],
  [
    'prior weights on an unknown dimension',
    variant((raw) => {
      raw.prior = { kind: 'declared', weights: { mood: { calm: 1 } } };
    }),
    ['SPACE_UNKNOWN_DIMENSION prior.weights.mood'],
  ],
  [
    'prior weights on an unknown value',
    variant((raw) => {
      raw.prior = { kind: 'declared', weights: { channel: { chat: 1, whatsapp: 1, fax: 1 } } };
    }),
    ['SPACE_UNKNOWN_VALUE prior.weights.channel.fax'],
  ],
  [
    'prior weights that skip a value',
    variant((raw) => {
      raw.prior = { kind: 'declared', weights: { channel: { chat: 1 } } };
    }),
    ['SPACE_PRIOR_INCOMPLETE prior.weights.channel'],
  ],
  [
    'prior weights that are all 0',
    variant((raw) => {
      raw.prior = { kind: 'declared', weights: { channel: { chat: 0, whatsapp: 0 } } };
    }),
    ['SPACE_PRIOR_ZERO prior.weights.channel'],
  ],
  [
    'constraints that forbid every cell',
    variant((raw) => {
      raw.constraints?.push(
        { forbid: { channel: 'chat' }, reason: 'No chat.' },
        { forbid: { deviation: 'none', channel: 'whatsapp' }, reason: 'No calm whatsapp.' },
      );
    }),
    ['SPACE_GRID_EMPTY constraints'],
  ],
];

describe('the map schema and loader', () => {
  it('accepts the hand map', () => {
    const result = validateSpaceMap(HAND);
    expect(issues(result)).toEqual([]);
    expect(result.ok && result.map.dimensions.map((dimension) => dimension.id)).toEqual([
      'stage',
      'deviation',
      'channel',
    ]);
  });

  it('accepts the Acme map, with its inventory path and required values', async () => {
    const result = await loadSpaceMap(ACME);
    expect(issues(result)).toEqual([]);
    if (!result.ok) return;
    expect(result.map.agent).toBe('acme-sales');
    expect(result.map.inventory).toBe('../../../../examples/acme/inventory.yaml');
    expect(result.map.dimensions.map((dimension) => [dimension.id, dimension.values.length])).toEqual([
      ['stage', 12],
      ['behaviour', 14],
      ['deviation', 9],
      ['channel', 2],
      ['persona', 3],
      ['data', 6],
    ]);
    expect(result.map.constraints).toHaveLength(5);
  });

  it.each(REFUSALS)('refuses %s', (_name, raw, expected) => {
    expect(issues(validateSpaceMap(raw))).toEqual(expected);
  });

  it('names every issue code at least once in the cases above', () => {
    const named = new Set(
      REFUSALS.flatMap(([, , expected]) => expected.map((entry) => entry.split(' ')[0])).filter((code) =>
        code?.startsWith('SPACE_'),
      ),
    );
    named.add('SPACE_PARSE');
    expect([...SpaceMapIssueCodes].filter((code) => !named.has(code))).toEqual([]);
  });

  it('lets none sit in several persona dimensions', () => {
    const raw = variant((map) => {
      map.dimensions.push(PERSONAS(['terse', 'none']), PERSONAS(['verbose', 'none']));
    });
    expect(issues(validateSpaceMap(raw))).toEqual([]);
  });

  it('refuses unparsable text and duplicate keys with SPACE_PARSE', () => {
    expect(issues(parseSpaceMapText('dimensions: [', 'yaml'))).toEqual(['SPACE_PARSE ']);
    expect(issues(parseSpaceMapText('agent: a\nagent: b\n', 'yaml'))).toEqual(['SPACE_PARSE ']);
    expect(issues(parseSpaceMapText('{"agent": ', 'json'))).toEqual(['SPACE_PARSE ']);
  });

  it('reads JSON by extension, and says when the file cannot be read', async () => {
    const dir = await tempFolder('driftbench-space-');
    await writeFile(join(dir, 'space.json'), JSON.stringify(HAND));
    expect((await loadSpaceMap(join(dir, 'space.json'))).ok).toBe(true);
    const missing = await loadSpaceMap(join(dir, 'nope.yaml'));
    expect(issues(missing)).toEqual(['SPACE_PARSE ']);
    expect(!missing.ok && missing.errors[0]?.message).toMatch(/^cannot read the file/);
  });
});
