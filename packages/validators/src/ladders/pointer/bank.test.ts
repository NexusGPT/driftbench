import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { BankItem, PointerAdapter } from './bank';
import { pointerBank, runItem } from './bank';
import { pointerLadder } from './index';

const bank = pointerBank();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const hidden = 1_000_000 + (Number.parseInt(head.slice(0, 8), 16) % 1_000_000_000);
const seeds = [...Array.from({ length: 20 }, (_, i) => i + 1), hidden];

/** A scripted transport stub, NOT a reference implementation and NOT reader evidence. */
function stub(item: BankItem, seed: number): PointerAdapter {
  const probes = item.generate(seed).probes;
  let i = 0;
  return {
    execute(request) {
      const p = probes[i++];
      expect(p).toBeDefined();
      expect(request).toEqual(p?.request);
      return structuredClone(p?.sample ?? p?.expected);
    },
  };
}

describe('blind pointer bank harness', () => {
  it('has 340 unique items, at least 30 per requested family, every tier and level, causes and citations', () => {
    expect(bank).toHaveLength(340);
    expect(new Set(bank.map((i) => i.id)).size).toBe(340);
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
      expect(bank.filter((i) => i.family === family)).toHaveLength(family === 'labels' ? 40 : 30);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(bank.some((i) => i.tier === n)).toBe(true);
      expect(bank.some((i) => i.level === n)).toBe(true);
    }
    expect([1, 2, 3, 4, 5].map((n) => bank.filter((i) => i.tier === n).length)).toEqual([62, 62, 72, 72, 72]);
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
        execute: (r) => (n++ === 0 ? { corrupted: true } : honest.execute(r)),
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

  it('rejects real source leakage even when the other privacy observations are correct', async () => {
    for (const item of bank.filter((i) => i.family === 'privacy')) {
      const first = item.generate(1).probes[0];
      if (!first) throw new Error('missing privacy probe');
      const input = first.request.input as { apiKey: string };
      const response = structuredClone(first.sample) as { logs: string[] };
      response.logs.push(input.apiKey);
      const outcome = await runItem(item, 1, { execute: () => response });
      expect(outcome.pass, item.id).toBe(false);
      expect(outcome.detail).not.toContain(input.apiKey);
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
