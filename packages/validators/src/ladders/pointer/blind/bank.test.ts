import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { BankItem, Json, PointerAdapter, PointerIO, Probe } from './bank';
import { pointerBank, runItem } from './bank';
import { captureIO } from './bank/io';
import { leaksPrivateFragment, privateMarker } from './bank/privacy';
import { featureCheats, matchingCheats, positionalCheats, reviewCheats } from './cheats';
import { honestLedger } from './honest';
import { pointerLadder } from './index';

const bank = pointerBank();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const hidden = 1_000_000 + (Number.parseInt(head.slice(0, 8), 16) % 1_000_000_000);
const seeds = [...Array.from({ length: 20 }, (_, i) => i + 1), hidden];

/** A scripted transport stub, NOT a reference implementation and NOT reader evidence. */
function stub(
  item: BankItem,
  seed: number,
  mutate?: (response: Json, io: PointerIO, probe: Probe) => unknown,
  /** The body a scripted fetch sends instead of the clean one. */
  fetchBody?: (probe: Probe, index: number) => Json,
): PointerAdapter {
  const probes = item.generate(seed).probes;
  let i = 0;
  let fetches = 0;
  return {
    async execute(request, io) {
      const p = probes[i++];
      if (!p || !io) throw new Error('missing scripted probe or IO');
      expect(request).toEqual(p.request);
      for (const effect of p.sampleEffects ?? []) {
        switch (effect.kind) {
          case 'key':
            io.readKey();
            break;
          case 'fetch':
            await io.fetch({ body: fetchBody ? fetchBody(p, fetches++) : (effect.value ?? null) });
            break;
          case 'cache':
            io.readCassette();
            break;
          case 'write':
            io.writeCassette(effect.path, effect.value, effect.committed);
            break;
          case 'log':
            io.log(effect.value);
            break;
          case 'plan':
            io.plan(effect.value);
            break;
        }
      }
      const response = structuredClone(p.sample ?? p.expected);
      return mutate ? mutate(response, io, p) : response;
    },
  };
}

describe('blind pointer bank harness', () => {
  it('has 341 unique items, at least 30 per requested family, every tier and level, causes and citations', () => {
    expect(bank).toHaveLength(343);
    expect(new Set(bank.map((i) => i.id)).size).toBe(343);
    const families = [
      'cutting',
      'ids',
      're-anchoring',
      'grouping',
      'labels',
      'replay',
      'privacy',
      'links',
      'radius',
      'scale',
      'adversarial',
    ];
    for (const family of families)
      expect(bank.filter((i) => i.family === family)).toHaveLength(
        family === 'labels' ? 40 : family === 'adversarial' ? 31 : family === 'privacy' ? 32 : 30,
      );
    for (const n of [1, 2, 3, 4, 5]) {
      expect(bank.some((i) => i.tier === n)).toBe(true);
      expect(bank.some((i) => i.level === n)).toBe(true);
    }
    expect([1, 2, 3, 4, 5].map((n) => bank.filter((i) => i.tier === n).length)).toEqual([62, 62, 73, 73, 73]);
    for (const item of bank) {
      expect(item.cause.length).toBeGreaterThan(5);
      expect(item.design.length).toBeGreaterThan(0);
    }
    expect(pointerLadder({ execute: () => null })).toBeDefined();
  });

  it('has deterministic plants and hidden-seed input variation', () => {
    for (const item of bank) {
      const a = item.generate(1).probes;
      const b = item.generate(1).probes;
      expect(a.map((p) => ({ request: p.request, expected: p.expected }))).toEqual(
        b.map((p) => ({ request: p.request, expected: p.expected })),
      );
      expect(
        isDeepStrictEqual(
          a.map((p) => p.request),
          item.generate(hidden).probes.map((p) => p.request),
        ),
        item.id,
      ).toBe(false);
      expect(new Set(a.map((p) => JSON.stringify(p.expected))).size, item.id).toBeGreaterThan(1);
    }
  });

  it('runs all items through the scripted stub on 1..20 and commit-derived hidden seed', async () => {
    for (const seed of seeds)
      for (const item of bank) {
        expect(await runItem(item, seed, stub(item, seed)), `${item.id} seed=${seed}`).toMatchObject({
          pass: true,
        });
      }
  }, 120_000);

  it('empty, constant and echo implementations score ZERO on every seed', async () => {
    const totals = { empty: 0, constant: 0, echo: 0 };
    for (const seed of seeds)
      for (const item of bank) {
        const first = item.generate(seed).probes[0];
        // Stronger than a universal canned object: constant receives the first correct raw answer of EACH item.
        const value = structuredClone(first?.sample ?? first?.expected);
        const cheats: Record<keyof typeof totals, PointerAdapter> = {
          empty: { execute: () => undefined },
          constant: { execute: () => value },
          echo: { execute: (r) => r.input },
        };
        for (const name of ['empty', 'constant', 'echo'] as const)
          totals[name] += Number((await runItem(item, seed, cheats[name])).pass);
      }
    expect(totals).toEqual({ empty: 0, constant: 0, echo: 0 });
  }, 120_000);

  it('rejects a corrupted response for every item', async () => {
    for (const item of bank) {
      const honest = stub(item, 3);
      let n = 0;
      const corrupt: PointerAdapter = {
        execute: (r, io) => (n++ === 0 ? { corrupted: true } : honest.execute(r, io)),
      };
      expect((await runItem(item, 3, corrupt)).pass, item.id).toBe(false);
    }
  });

  it('does not reveal source text or thrown secrets in feedback', async () => {
    const item = bank.find((i) => i.family === 'privacy');
    if (!item) throw new Error('privacy family absent');
    const outcome = await runItem(item, 1, {
      execute: () => {
        throw new Error('FICTIONAL_SECRET_LEAK');
      },
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).not.toContain('FICTIONAL_SECRET_LEAK');
  });

  it('rejects all four independent review cheats on EVERY seed, not just their intersection', async () => {
    for (const seed of seeds) {
      const totals = { firstUnit: 0, textHash: 0, copying: 0, leakyCopy: 0 };
      for (const item of bank)
        for (const name of Object.keys(reviewCheats) as (keyof typeof reviewCheats)[])
          totals[name] += Number((await runItem(item, seed, reviewCheats[name])).pass);
      expect(totals, `review cheats seed=${seed}`).toEqual({
        firstUnit: 0,
        textHash: 0,
        copying: 0,
        leakyCopy: 0,
      });
    }
  }, 120_000);

  it('index, line and offset identity cheats score ZERO on EVERY seed', async () => {
    for (const seed of seeds) {
      const totals = { byIndex: 0, byLine: 0, byOffset: 0 };
      for (const item of bank)
        for (const name of Object.keys(positionalCheats) as (keyof typeof positionalCheats)[])
          totals[name] += Number((await runItem(item, seed, positionalCheats[name])).pass);
      expect(totals, `positional cheats seed=${seed}`).toEqual({ byIndex: 0, byLine: 0, byOffset: 0 });
    }
  }, 120_000);

  it('positional cheats execute valid snapshots and demonstrate the fingerprint and reorder faults', async () => {
    const scan = (texts: string[]) => {
      let start = 0;
      return {
        estateKey: 'fictional-coordinate-estate',
        files: [
          {
            path: 'fictional.md',
            source: texts.join('\n\n'),
            units: texts.map((text, index) => {
              const unit = {
                text,
                container: 'sentence',
                labels: { demo: 'kept' },
                linked: false,
                line: index * 2 + 1,
                hint: { start, end: start + text.length },
              };
              start += text.length + 2;
              return unit;
            }),
          },
        ],
      };
    };
    type Snapshots = { entries: { id: string; quote: string; status: string }[] }[];
    for (const cheat of Object.values(positionalCheats)) {
      const fresh = (await cheat.execute({
        operation: 'ledger',
        input: {
          independent: true,
          scans: [scan(['Fictional amber parcel.']), scan(['Fictional azure parcel.'])],
        },
      })) as Snapshots;
      expect(fresh).toHaveLength(2);
      expect(fresh[0]?.entries[0]?.id).toMatch(/^[a-z2-7]{10}$/);
      expect(fresh[0]?.entries[0]?.id).toBe(fresh[1]?.entries[0]?.id);
      expect(fresh[0]?.entries[0]?.quote).not.toBe(fresh[1]?.entries[0]?.quote);
      const reordered = (await cheat.execute({
        operation: 'ledger',
        input: {
          independent: false,
          scans: [
            scan(['Fictional amber parcel.', 'Fictional azure parcel.']),
            scan(['Fictional azure parcel.', 'Fictional amber parcel.']),
          ],
        },
      })) as Snapshots;
      const before = reordered[0]?.entries.find((entry) => entry.quote === 'Fictional amber parcel.');
      const after = reordered[1]?.entries.find((entry) => entry.quote === 'Fictional amber parcel.');
      expect(before?.status).toBe('live');
      expect(after?.status).toBe('live');
      expect(before?.id).not.toBe(after?.id);
    }
  });

  it('position-changing histories defeat each coordinate cheat independently of the fresh-mint probe', async () => {
    for (const seed of seeds)
      for (const item of bank.filter((item) => item.component === 'pointer.ledger')) {
        const history = item.generate(seed).probes[3];
        if (!history?.observe) throw new Error('history observation absent');
        for (const [name, cheat] of Object.entries(positionalCheats)) {
          const actual = await cheat.execute(structuredClone(history.request));
          const observation = history.observe(actual, captureIO().snapshot());
          expect(observation, `${item.id} ${name} seed=${seed}`).not.toEqual(history.expected);
        }
      }
  });

  it('ledger witnesses change real positions while preserving the planted survivor identity', () => {
    type Unit = { text: string; line: number; hint: { start: number; end: number } };
    type File = { path: string; source: string; units: Unit[] };
    type Input = { independent: boolean; scans: { estateKey: string; files: File[] }[] };
    for (const seed of seeds)
      for (const item of bank.filter((item) => item.component === 'pointer.ledger')) {
        const probes = item.generate(seed).probes;
        for (const probe of probes) {
          const input = probe.request.input as unknown as Input;
          for (const scan of input.scans)
            for (const file of scan.files)
              for (const unit of file.units) {
                expect(file.source.slice(unit.hint.start, unit.hint.end)).toBe(unit.text);
                expect(file.source.slice(0, unit.hint.start).split('\n').length).toBe(unit.line);
              }
        }
        const fresh = probes[2]?.request.input as unknown as Input;
        expect(fresh.independent).toBe(true);
        const left = fresh.scans[0];
        const right = fresh.scans[1];
        if (!left || !right) throw new Error('fresh mint snapshots absent');
        expect(left.estateKey).toBe(right.estateKey);
        for (const [f, file] of left.files.entries()) {
          for (const [u, unit] of file.units.entries()) {
            const counterpart = right.files[f]?.units[u];
            expect(right.files[f]?.path).toBe(file.path);
            expect(counterpart?.hint).toEqual(unit.hint);
            expect(counterpart?.line).toBe(unit.line);
            expect(counterpart?.text).not.toBe(unit.text);
          }
        }
        const historyProbe = probes[3];
        const history = historyProbe?.request.input as unknown as Input;
        const quote = history.scans[0]?.files[0]?.units[1]?.text;
        if (!quote || !historyProbe) throw new Error('position witness absent');
        const positions = history.scans.map((scan) => {
          let index = 0;
          for (const file of scan.files)
            for (const unit of file.units) {
              if (unit.text === quote) return { index, line: unit.line, start: unit.hint.start };
              index++;
            }
          throw new Error('surviving unit absent');
        });
        expect(positions[1]?.index).toBe((positions[0]?.index ?? 0) + 1);
        expect(positions[2]).toEqual(positions[0]);
        expect(history.scans[3]?.files.map((f) => f.path)).toEqual(
          history.scans[2]?.files.map((f) => f.path).reverse(),
        );
        expect(positions[3]?.index).not.toBe(positions[2]?.index);
        expect(positions[4]?.index).toBe(positions[3]?.index);
        expect(positions[4]?.line).not.toBe(positions[3]?.line);
        expect(positions[5]?.index).toBe(positions[4]?.index);
        expect(positions[5]?.line).toBe(positions[4]?.line);
        expect(positions[5]?.start).not.toBe(positions[4]?.start);
        expect(positions[6]?.index).not.toBe(positions[5]?.index);
        const snapshots = historyProbe.sample as { entries: { id: string; quote: string }[] }[];
        const ids = snapshots.map((snapshot) => snapshot.entries.find((entry) => entry.quote === quote)?.id);
        expect(ids.every((id) => typeof id === 'string')).toBe(true);
        expect(new Set(ids).size).toBe(1);
      }
  });

  it('first-word matching identity cheats score ZERO on EVERY seed, whether they mint from the whole text or the first word', async () => {
    for (const seed of seeds) {
      const totals = { firstWordWhole: 0, firstWordOnly: 0, exactThenFirstWord: 0 };
      for (const item of bank)
        for (const name of Object.keys(matchingCheats) as (keyof typeof matchingCheats)[])
          totals[name] += Number((await runItem(item, seed, matchingCheats[name])).pass);
      expect(totals, `matching cheats seed=${seed}`).toEqual({
        firstWordWhole: 0,
        firstWordOnly: 0,
        exactThenFirstWord: 0,
      });
    }
  }, 300_000);

  it('an honest ledger (identity follows the whole unit) passes the ten ledger items on every seed', async () => {
    const names = [
      'independent-clones',
      'same-file-occurrences',
      'separate-estate-keys',
      'separate-file-paths',
      'display-number-insertion',
      'small-text-edit',
      'cross-file-move',
      'set-description-edit',
      'stack-bound-edit',
      'two-sets-one-unit',
    ];
    const items = bank.filter((item) => names.some((name) => item.id === `pointer.ids.${name}`));
    expect(items).toHaveLength(10);
    for (const seed of seeds)
      for (const item of items) {
        const result = await runItem(item, seed, honestLedger);
        expect(result.pass, `${item.id} seed=${seed}: ${result.detail}`).toBe(true);
      }
  }, 300_000);

  it('feature-key identity cheats (fifth word, v-token, digit word) score ZERO on EVERY seed', async () => {
    for (const seed of seeds) {
      const totals: Record<string, number> = Object.fromEntries(
        Object.keys(featureCheats).map((name) => [name, 0]),
      );
      for (const item of bank.filter((i) => i.family === 'ids'))
        for (const [name, cheat] of Object.entries(featureCheats))
          totals[name] = (totals[name] as number) + Number((await runItem(item, seed, cheat)).pass);
      expect(totals, `feature cheats seed=${seed}`).toEqual(
        Object.fromEntries(Object.keys(featureCheats).map((name) => [name, 0])),
      );
    }
  }, 300_000);

  it('the first-word cheats make valid snapshots and hand one unit the identity of another that shares its first word', async () => {
    type Snapshots = { entries: { id: string; quote: string; status: string }[] }[];
    const scan = (texts: string[]) => ({
      estateKey: 'fictional-estate',
      files: [
        {
          path: 'a.md',
          units: texts.map((text) => ({
            text,
            container: 'sentence',
            labels: { demo: 'kept' },
            linked: false,
          })),
        },
      ],
    });
    for (const [name, cheat] of Object.entries(matchingCheats)) {
      const snapshots = (await cheat.execute({
        operation: 'ledger',
        input: {
          independent: false,
          scans: [
            scan(['Keep the red parcel.', 'Keep the blue parcel.']),
            scan(['Keep the blue parcel.', 'Keep the red parcel.']),
          ],
        },
      })) as Snapshots;
      expect(snapshots, name).toHaveLength(2);
      for (const snapshot of snapshots)
        for (const entry of snapshot.entries) expect(entry.id, name).toMatch(/^[a-z2-7]{10}$/);
      const idOf = (at: number, quote: string) => snapshots[at]?.entries.find((e) => e.quote === quote)?.id;
      // Exact text first keeps both; the others swap the red and the blue parcel.
      if (name === 'exactThenFirstWord')
        expect(idOf(0, 'Keep the red parcel.'), name).toBe(idOf(1, 'Keep the red parcel.'));
      else expect(idOf(0, 'Keep the red parcel.'), name).not.toBe(idOf(1, 'Keep the red parcel.'));
    }
  });

  it('every ledger item follows several units that share a first word through reorders, edits, a move and a replacement', () => {
    type Unit = { text: string };
    type Input = { scans: { files: { path: string; units: Unit[] }[] }[] };
    type Snapshots = { entries: { id: string; path: string; quote: string; status: string }[] }[];
    for (const seed of seeds)
      for (const item of bank.filter((entry) => entry.component === 'pointer.ledger')) {
        const probe = item.generate(seed).probes[4];
        if (!probe) throw new Error(`${item.id}: shared first word witness absent`);
        const input = probe.request.input as unknown as Input;
        const snapshots = probe.sample as Snapshots;
        const first = (text: string) => text.split(' ')[0];
        const texts = input.scans.flatMap((scan) =>
          scan.files.flatMap((file) => file.units.map((unit) => unit.text)),
        );
        expect(new Set(texts.map(first)), item.id).toEqual(new Set(['Keep']));
        // At least five different live units in the first scan, all beginning with the same word.
        const initial = input.scans[0]?.files.flatMap((file) => file.units.map((unit) => unit.text)) ?? [];
        expect(new Set(initial).size, item.id).toBeGreaterThanOrEqual(5);
        // Identity classes: one id per tracked unit through the history, never shared by two live units.
        for (const snapshot of snapshots) {
          const live = snapshot.entries.filter((entry) => entry.status === 'live');
          expect(new Set(live.map((entry) => entry.id)).size, item.id).toBe(live.length);
        }
        const idsOf = (quote: string) =>
          new Set(snapshots.flatMap((s) => s.entries.filter((e) => e.quote === quote).map((e) => e.id)));
        // A unit that is edited keeps one id through its two texts; the replacement has an id of its own.
        const everyId = new Set(snapshots.flatMap((s) => s.entries.map((e) => e.id)));
        const lastLive = snapshots.at(-1)?.entries.filter((e) => e.status === 'live').length ?? 0;
        const tombstones = snapshots.at(-1)?.entries.filter((e) => e.status === 'deleted').length ?? 0;
        expect(tombstones, item.id).toBe(1);
        expect(everyId.size, item.id).toBe(lastLive + tombstones);
        expect(idsOf(initial[0] ?? '').size, item.id).toBe(1);
      }
  });

  it('varies the planted transitions with the seed, not only the fictional tokens', () => {
    const shape = (seed: number) => {
      const item = bank.find((entry) => entry.component === 'pointer.ledger');
      const probe = item?.generate(seed).probes[4];
      const input = probe?.request.input as unknown as {
        scans: { files: { path: string; units: { text: string }[] }[] }[];
      };
      // The history with every seeded token removed: which unit stands where in each scan.
      return JSON.stringify(
        input.scans.map((scan) =>
          scan.files.map((file) => [
            file.path,
            file.units.map((unit) => unit.text.replace(/\bv[0-9a-z]+\b/g, 'T')),
          ]),
        ),
      );
    };
    expect(new Set(seeds.map(shape)).size).toBeGreaterThan(1);
  });

  it('rejects privacy effect spoofing even with the exact planted labels and public plan', async () => {
    for (const item of bank.filter((i) => i.family === 'privacy')) {
      const probes = item.generate(1).probes;
      let n = 0;
      const fake: PointerAdapter = {
        execute: () => {
          const p = probes[n++];
          return { ...(p?.sample as object), ...(p?.expected as object) };
        },
      };
      expect((await runItem(item, 1, fake)).pass, item.id).toBe(false);
    }
  });

  it('passes the scripted honest transport on every privacy item and fails one that sends an opaque block whole', async () => {
    const opaque = bank.filter((i) => i.family === 'privacy' && /^privacy\.(fence|comment)\./.test(i.id));
    expect(opaque.map((i) => i.id).sort()).toEqual([
      'privacy.comment.ci-hit',
      'privacy.comment.ci-miss',
      'privacy.comment.record',
      'privacy.fence.ci-hit',
      'privacy.fence.ci-miss',
      'privacy.fence.no-request',
      'privacy.fence.record',
      'privacy.fence.second-request',
    ]);
    for (const item of bank.filter((i) => i.family === 'privacy'))
      for (const seed of [1, 2, 3]) {
        const outcome = await runItem(item, seed, stub(item, seed));
        expect(outcome.pass, item.id).toBe(true);
      }
    // Only the items that send a request can leak through it.
    for (const item of opaque.filter((i) => /record$|no-request$|second-request$/.test(i.id)))
      for (const seed of [1, 2, 3]) {
        const whole = stub(item, seed, undefined, (p) => (p.request.input as { source: Json }).source);
        const outcome = await runItem(item, seed, whole);
        expect(outcome.pass, `${item.id} seed ${seed}`).toBe(false);
      }
  });

  it('fails a key in the body of any request on every privacy item, and a leak in the second request only', async () => {
    const sent = (item: BankItem) =>
      item.generate(1).probes.some((p) => (p.sampleEffects ?? []).some((e) => e.kind === 'fetch'));
    for (const item of bank.filter((i) => i.family === 'privacy' && sent(i))) {
      const leaky = stub(item, 1, undefined, (p) => ({
        messages: [{ role: 'user', content: String((p.setup as { key: string }).key) }],
      }));
      expect((await runItem(item, 1, leaky)).pass, item.id).toBe(false);
    }
    const item = bank.find((i) => i.id === 'privacy.fence.second-request') as BankItem;
    for (const seed of [1, 2, 3]) {
      expect((await runItem(item, seed, stub(item, seed))).pass, `honest ${seed}`).toBe(true);
      const second = stub(item, seed, undefined, (p, index) =>
        index === 1 ? (p.request.input as { source: Json }).source : { messages: [] },
      );
      expect((await runItem(item, seed, second)).pass, `second-only ${seed}`).toBe(false);
      const first = stub(item, seed, undefined, (p, index) =>
        index === 0 ? (p.request.input as { source: Json }).source : { messages: [] },
      );
      expect((await runItem(item, seed, first)).pass, `first-only ${seed}`).toBe(false);
    }
  });

  it('fails a reader that never sends a request beside an opaque block, and one that sends one for a fence alone', async () => {
    const item = bank.find((i) => i.id === 'privacy.fence.no-request') as BankItem;
    const quiet: PointerAdapter = { execute: () => ({ labels: [], status: 'no-request' }) };
    expect((await runItem(item, 1, quiet)).pass).toBe(false);
    const chatty: PointerAdapter = {
      execute: async (request, io) => {
        if (!io) throw new Error('no io');
        io.readKey();
        await io.fetch({ body: { messages: [{ role: 'user', content: 'Fictional public padding.' }] } });
        return { labels: [{ units: '1', label: 'x' }], status: 'ok' };
      },
    };
    expect((await runItem(item, 1, chatty)).pass).toBe(false);
  });

  it('detects every marker character and every split, including escaped values and object keys', () => {
    for (const seed of seeds) {
      const marker = privateMarker(seed, 0);
      expect(leaksPrivateFragment({ labels: 'class-public', characters: 12 }, [marker])).toBe(false);
      for (let i = 0; i < marker.length; i++) {
        const fragment = marker[i] as string;
        expect(leaksPrivateFragment([fragment], [marker])).toBe(true);
        expect(leaksPrivateFragment({ [fragment]: 'value' }, [marker])).toBe(true);
        expect(leaksPrivateFragment(`\\u${fragment.charCodeAt(0).toString(16)}`, [marker])).toBe(true);
        if (i > 0) expect(leaksPrivateFragment([marker.slice(0, i), marker.slice(i)], [marker])).toBe(true);
      }
    }
  });

  it('rejects split or single-character leaks with otherwise valid privacy effects on all placements and modes', async () => {
    for (const item of bank.filter((i) => i.family === 'privacy')) {
      for (let split = 1; split < 12; split++) {
        const leak = stub(item, 1, (response, io, p) => {
          if (!p.setup) throw new Error('missing private fixture');
          // The key is test-only; CI adapters do not read it. Logs otherwise have no exact-content oracle.
          io.log([p.setup.key.slice(0, split), p.setup.key.slice(split)]);
          return response;
        });
        expect((await runItem(item, 1, leak)).pass, `${item.id} split=${split}`).toBe(false);
      }
      for (let character = 0; character < 12; character++) {
        const leak = stub(item, 1, (response, io, p) => {
          const input = p.request.input as { source: string };
          const markers = [...input.source].filter(
            (c) => c.charCodeAt(0) >= 0xe000 && c.charCodeAt(0) <= 0xf8ff,
          );
          const fragment = markers[character] as string;
          io.log(fragment);
          return response;
        });
        expect((await runItem(item, 1, leak)).pass, `${item.id} character=${character}`).toBe(false);
      }
      const returnedLeak = stub(item, 1, (response, _io, p) => ({
        ...(response as object),
        extra: [p.setup?.key.slice(0, 1)],
      }));
      expect((await runItem(item, 1, returnedLeak)).pass, item.id).toBe(false);
    }
  });

  it('rejects text-only identities even when path, quote and status are otherwise correct', async () => {
    for (const item of bank.filter((i) => i.component === 'pointer.ledger')) {
      const textIds = stub(item, 2, (response) => {
        const snapshots = response as { entries: { id: string; quote: string }[] }[];
        for (const snapshot of snapshots)
          for (const entry of snapshot.entries)
            entry.id = Array.from(
              createHash('sha256').update(entry.quote).digest().subarray(0, 10),
              (byte) => 'abcdefghijklmnopqrstuvwxyz234567'[byte & 31],
            ).join('');
        return response;
      });
      expect((await runItem(item, 2, textIds)).pass, item.id).toBe(false);
    }
  });

  it('checks ledger quotes and deleted status instead of discarding them during projection', async () => {
    for (const item of bank.filter((i) => i.component === 'pointer.ledger')) {
      for (const field of ['quote', 'status'] as const) {
        const corrupt = stub(item, 2, (response) => {
          const snapshots = response as { entries: { quote: string; status: string }[] }[];
          for (const snapshot of snapshots) {
            if (field === 'quote')
              for (const entry of snapshot.entries) entry.quote = 'wrong fictional quote';
            else for (const entry of snapshot.entries) if (entry.status === 'deleted') entry.status = 'live';
          }
          return response;
        });
        expect((await runItem(item, 2, corrupt)).pass, `${item.id} ${field}`).toBe(false);
      }
    }
  });

  it('rejects off-by-one UTF-16 spans even with correct displayed text', async () => {
    for (const item of bank.filter((i) => i.family === 'cutting')) {
      const first = item.generate(2).probes[0];
      if (!first) throw new Error('missing cut probe');
      const response = structuredClone(first.sample) as { units: { span: number[] }[] };
      const unit = response.units[0];
      if (!unit) throw new Error('missing planted unit');
      unit.span[1] = (unit.span[1] ?? 0) - 1;
      expect((await runItem(item, 2, { execute: () => response })).pass, item.id).toBe(false);
    }
  });
});
