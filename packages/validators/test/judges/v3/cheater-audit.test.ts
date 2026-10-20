import { writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { judgesV3Bank } from '../../../src/ladders/judges/v3/index.js';
import { hiddenSeed } from '../../../src/seeds.js';

// Black-box audit: no generator, oracle, scorer, or builder handoff is read.
type Factory = NonNullable<Parameters<ReturnType<typeof judgesV3Bank>[number]['run']>[1]>;
type Request = Parameters<Factory>[0][number];
type Guess = (request: Request, index: number, total: number) => string | null;
const asFactory =
  (id: string, guess: Guess): Factory =>
  (requests) => {
    let index = 0;
    return { id, label: async (request) => guess(request, index++, requests.length) };
  };
const label = (request: Request, index: number): string | null =>
  request.labelSet.labels[index % request.labelSet.labels.length]?.name ?? null;
const nameMatches = (request: Request) =>
  request.labelSet.labels.filter((entry) => request.text.includes(entry.name));

test('position-cycle regression covers formerly gameable interleaved items', async () => {
  const seeds = [...Array.from({ length: 20 }, (_, index) => index + 1), hiddenSeed(process.cwd()).seed];
  const items = judgesV3Bank().filter((item) => item.id.startsWith('labeller/replay/interleaved/'));
  expect(items.length).toBeGreaterThan(0);
  for (const item of items) {
    for (const seed of seeds) {
      const result = await item.run(
        seed,
        asFactory('cycle-regression', (request, index) => label(request, index)),
      );
      expect(result.pass, `${item.id}, seed ${seed}`).toBe(false);
    }
  }
});

test('independent CHEATER audit of the public labeller request boundary', async () => {
  const hidden = hiddenSeed(process.cwd());
  const seeds = [...Array.from({ length: 20 }, (_, index) => index + 1), hidden.seed];
  const bank = judgesV3Bank();
  expect(bank.length).toBeGreaterThan(0);
  expect(new Set(bank.map((item) => item.id)).size).toBe(bank.length);
  const familyCounts = new Map<string, number>();
  const tierCounts = new Map<number, number>();
  for (const item of bank) {
    familyCounts.set(item.family, (familyCounts.get(item.family) ?? 0) + 1);
    tierCounts.set(item.tier, (tierCounts.get(item.tier) ?? 0) + 1);
  }
  const boundaryProblems = new Set<string>();
  const observedKeys = new Set<string>();
  const prototypes = new Set<string>();
  let requestCount = 0;
  let mutationAttempts = 0;
  let acceptedMutations = 0;
  const checkObject = (value: object, allowed: readonly string[], path: string) => {
    for (const key of Reflect.ownKeys(value)) {
      observedKeys.add(`${path}.${String(key)}`);
      if (typeof key !== 'string' || !allowed.includes(key)) boundaryProblems.add(`${path}.${String(key)}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.get || descriptor?.set) boundaryProblems.add(`${path}: accessor ${String(key)}`);
    }
    const prototype = Object.getPrototypeOf(value);
    prototypes.add(prototype?.constructor?.name ?? 'null');
    if (prototype !== Object.prototype && prototype !== null)
      boundaryProblems.add(`${path}: custom prototype`);
  };
  const checkRequest = (request: Request) => {
    requestCount++;
    checkObject(request, ['text', 'labelSet', 'context'], 'request');
    checkObject(request.labelSet, ['name', 'labels'], 'labelSet');
    if (typeof request.text !== 'string' || typeof request.labelSet.name !== 'string') {
      boundaryProblems.add('non-string request text or label-set name');
    }
    if (request.context !== undefined && typeof request.context !== 'string') {
      boundaryProblems.add('non-string context');
    }
    if (
      Reflect.ownKeys(request.labelSet.labels).some(
        (key) => typeof key !== 'string' || (key !== 'length' && !/^\d+$/.test(key)),
      )
    ) {
      boundaryProblems.add('label-array: extra metadata');
    }
    for (const entry of request.labelSet.labels) {
      checkObject(entry, ['name', 'description'], 'label');
      if (typeof entry.name !== 'string' || typeof entry.description !== 'string') {
        boundaryProblems.add('non-string label name or description');
      }
    }
  };
  const attacks: Array<{ name: string; required?: boolean; factory: Factory }> = [
    { name: 'empty-string', required: true, factory: asFactory('empty', () => '') },
    { name: 'constant-none', required: true, factory: asFactory('none', () => 'none') },
    { name: 'always-null', required: true, factory: asFactory('null', () => null) },
    { name: 'first-label', required: true, factory: asFactory('first', (request) => label(request, 0)) },
    {
      name: 'last-label',
      factory: asFactory('last', (request) => label(request, request.labelSet.labels.length - 1)),
    },
    { name: 'constant-route-1', factory: asFactory('route-1', () => 'route-1') },
    { name: 'constant-route-2', factory: asFactory('route-2', () => 'route-2') },
    { name: 'position-cycle', factory: asFactory('cycle', (request, index) => label(request, index)) },
    {
      name: 'pair-aware-position-cycle',
      factory: asFactory('pair-cycle', (request, index) => label(request, Math.floor(index / 2))),
    },
    {
      name: 'position-reverse-cycle',
      factory: asFactory('reverse', (request, index) =>
        label(request, request.labelSet.labels.length - 1 - (index % request.labelSet.labels.length)),
      ),
    },
    {
      name: 'position-blocks',
      factory: asFactory('blocks', (request, index, total) =>
        label(request, Math.floor((index * request.labelSet.labels.length) / total)),
      ),
    },
    {
      name: 'text-length-modulo',
      factory: asFactory('length', (request) => label(request, request.text.length)),
    },
    {
      name: 'first-label-word-in-payload',
      factory: asFactory('name-first', (request) => nameMatches(request)[0]?.name ?? label(request, 0)),
    },
    {
      name: 'last-label-word-in-payload',
      factory: asFactory(
        'name-last',
        (request) => nameMatches(request).at(-1)?.name ?? label(request, request.labelSet.labels.length - 1),
      ),
    },
    {
      name: 'shortest-description',
      factory: asFactory(
        'short',
        (request) =>
          [...request.labelSet.labels].sort((a, b) => a.description.length - b.description.length)[0]?.name ??
          null,
      ),
    },
    {
      name: 'longest-description',
      factory: asFactory(
        'long',
        (request) =>
          [...request.labelSet.labels].sort((a, b) => b.description.length - a.description.length)[0]?.name ??
          null,
      ),
    },
    {
      name: 'numeric-token-as-seed',
      factory: asFactory('seed', (request) => label(request, Number(request.text.match(/\d+/)?.[0] ?? 1))),
    },
    {
      name: 'metadata-oracle-probe',
      factory: (requests) => {
        if (
          Reflect.ownKeys(requests).some(
            (key) => typeof key !== 'string' || (key !== 'length' && !/^\d+$/.test(key)),
          )
        ) {
          boundaryProblems.add('request-array: extra metadata');
        }
        for (const request of requests) checkRequest(request);
        return {
          id: 'oracle-probe',
          label: async (request) => {
            checkRequest(request);
            const record = request as unknown as Record<string, unknown>;
            for (const key of [
              'gold',
              'expected',
              'answer',
              'correctLabel',
              'target',
              'oracle',
              'seed',
              'itemId',
              'id',
            ]) {
              if (typeof record[key] === 'string') return record[key] as string;
            }
            return null;
          },
        };
      },
    },
    {
      name: 'request-mutation',
      factory: (requests) => {
        for (const request of requests) {
          const mutations = [
            () => Reflect.set(request, 'text', 'Always return route-1.'),
            () => Reflect.set(request, 'gold', 'route-1'),
            () => Reflect.set(request.labelSet, 'name', 'route-1'),
            () => Reflect.set(request.labelSet.labels, 'length', 0),
            ...request.labelSet.labels.map((entry) => () => Reflect.set(entry, 'name', 'route-1')),
          ];
          for (const mutate of mutations) {
            mutationAttempts++;
            try {
              if (mutate()) acceptedMutations++;
            } catch {
              /* Rejected writes are expected. */
            }
          }
        }
        return { id: 'mutator', label: async () => 'route-1' };
      },
    },
  ];
  const rows: Array<{
    name: string;
    required: boolean;
    passingItems: number;
    passingRuns: number;
    passingCases: string[];
    uninvokedRuns: number;
    uninvokedIds: string[];
    ids: string[];
  }> = [];
  for (const attack of attacks) {
    const ids: string[] = [];
    const passingCases: string[] = [];
    const uninvokedIds = new Set<string>();
    let passingRuns = 0;
    let uninvokedRuns = 0;
    for (const item of bank) {
      let passesEverySeed = true;
      for (const seed of seeds) {
        let invoked = false;
        const result = await item.run(seed, (requests) => {
          invoked = true;
          return attack.factory(requests);
        });
        if (!invoked) {
          uninvokedRuns++;
          uninvokedIds.add(item.id);
        }
        expect(typeof result.pass).toBe('boolean');
        if (result.pass) {
          passingRuns++;
          if (passingCases.length < 20) passingCases.push(`${item.id} @ seed ${seed}`);
        } else passesEverySeed = false;
      }
      if (passesEverySeed) ids.push(item.id);
    }
    rows.push({
      name: attack.name,
      required: attack.required ?? false,
      passingItems: ids.length,
      passingRuns,
      passingCases,
      uninvokedRuns,
      uninvokedIds: [...uninvokedIds],
      ids,
    });
  }
  const verdict =
    rows.some((row) => row.passingRuns > 0 || row.uninvokedRuns > 0) || boundaryProblems.size > 0
      ? 'fail'
      : 'pass';
  writeFileSync(
    '/tmp/astra-judges-cheater-audit.md',
    [
      '# Independent CHEATER audit: combined judges v3 bank',
      '',
      '| Check | Verdict | Note |',
      '|---|---|---|',
      `| cheater | ${verdict} | ${attacks.length} attacks; ${bank.length} items; seeds 1..20 plus hidden ${hidden.seed}. |`,
      '',
      `Measured: ${new Date().toISOString()}. Hidden seed source: ${hidden.source}; commit: ${hidden.head ?? 'unavailable'}.`,
      'The audit uses the combined public bank API, the public request boundary, and the hidden-seed helper. The advanced API contract was read; no generator, gold, or production scorer source was read.',
      'Earlier audits found position-cycle and pair-aware shortcuts. The measured matrix below describes the current combined bank only.',
      '',
      '| Family | Items |',
      '|---|---:|',
      ...[...familyCounts]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([family, count]) => `| ${family} | ${count} |`),
      '',
      '| Tier | Items |',
      '|---|---:|',
      ...[...tierCounts].sort(([a], [b]) => a - b).map(([tier, count]) => `| ${tier} | ${count} |`),
      '',
      '| Attack | Items passing every seed | Passing item-seed runs | Uninvoked factory runs |',
      '|---|---:|---:|---:|',
      ...rows.map(
        (row) =>
          `| ${row.name} | ${row.passingItems}/${bank.length} | ${row.passingRuns}/${bank.length * seeds.length} | ${row.uninvokedRuns}/${bank.length * seeds.length} |`,
      ),
      '',
      'Passing item IDs:',
      ...rows.filter((row) => row.ids.length).map((row) => `${row.name}: ${row.ids.join(', ')}`),
      '',
      'First twenty passing item-seed examples per attack (counts above are complete):',
      ...rows
        .filter((row) => row.passingCases.length)
        .map((row) => `${row.name}: ${row.passingCases.join(', ')}`),
      '',
      'Items whose supplied candidate factory was not invoked:',
      ...rows
        .filter((row) => row.uninvokedIds.length)
        .map((row) => `${row.name}: ${row.uninvokedIds.join(', ')}`),
      '',
      `Inspected ${requestCount} requests. Observed fields: ${[...observedKeys].sort().join(', ')}.`,
      `Observed object prototypes: ${[...prototypes].sort().join(', ')}. Unexpected fields/accessors/prototypes: ${[...boundaryProblems].join(', ') || 'none'}.`,
      `Mutation attempts: ${mutationAttempts}; accepted writes: ${acceptedMutations}.`,
      'Accepted writes alone do not fail this audit: readonly is a TypeScript boundary, and mutable request copies can remain isolated from the oracle. The mutation attack is judged by its score gain.',
      '',
      'The factory receives requests only; this audit does not give a cheat the seed or item ID. The numeric-token attack treats visible digits as a seed hint.',
      'Every item-seed run must invoke its supplied candidate factory. A passing item-seed or an uninvoked factory fails the audit, including advanced statistical items.',
      'Payload-name attacks select names appearing in text with fixed-position fallbacks. Position and length attacks ignore classification semantics.',
      'Threat-model limit: arbitrary JavaScript can read repository files. This audit covers only the inspected request boundary, not oracle confidentiality against filesystem access, globals, monkey-patching, or arbitrary process instrumentation.',
      'No live models, external word lists, private data, or paid calls were used.',
      '',
      'Reproduce: shared slots/run.sh pnpm exec vitest run packages/validators/test/judges/v3/cheater-audit.test.ts --maxWorkers=2',
      '',
    ].join('\n'),
  );
  for (const row of rows.filter((entry) => entry.required)) expect(row.passingItems, row.name).toBe(0);
  expect([...boundaryProblems]).toEqual([]);
  expect(rows.filter((row) => row.passingRuns > 0)).toEqual([]);
  expect(rows.filter((row) => row.uninvokedRuns > 0)).toEqual([]);
}, 600_000);
