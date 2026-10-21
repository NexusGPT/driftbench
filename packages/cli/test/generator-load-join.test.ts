import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineLadder } from '@agent-nexus/driftbench-validators';
import { expect, it } from 'vitest';
import { generatorLadder, plannerItems } from '../../validators/src/ladders/generator';
import { validateCommand } from '../src/commands/validate';

it.each([
  ['missing dependency', "import './absent-product-dependency.mjs';"],
  ['load exception', "throw new Error('fictional product cannot initialize');"],
])(
  'the floor join rejects a planner with a %s above an earlier item failure',
  async (_name, source) => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-planner-load-'));
    try {
      await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
      const module = join(root, 'product.mjs');
      await writeFile(module, source);
      const planner = generatorLadder({ items: plannerItems(module) }).levels[0];
      if (!planner) throw new Error('no planner level');
      const ladder = defineLadder({
        component: 'generator',
        version: 2,
        levels: [
          ...Array.from({ length: 21 }, (_, index) => ({
            id: `early-${index + 1}`,
            name: 'ordinary item failure',
            metric: 'passing / items',
            threshold: 1,
            compute: () => ({
              value: 0,
              items: [{ id: 'ordinary', component: 'fictional', detail: 'failed' }],
            }),
          })),
          planner,
        ],
      });
      const deps = { root, ladders: () => ({ generator: ladder }) };
      const reports = join(root, 'reports');
      await mkdir(reports);
      const capture = () => {
        const output = { out: '', err: '' };
        const io = {
          cwd: root,
          out: (text: string) => {
            output.out += text;
          },
          err: (text: string) => {
            output.err += text;
          },
        };
        return { io, output };
      };
      for (const levels of ['1..1', '22..22']) {
        const f = capture();
        expect(await validateCommand('generator', { levels, seed: '1', json: true }, f.io, deps)).toBe(0);
        await writeFile(join(reports, `${levels}.json`), f.output.out);
      }
      const tail = JSON.parse(await readFile(join(reports, '22..22.json'), 'utf8'));
      const bank = tail.seeds[0].rows[21].bank;
      expect(bank).toHaveLength(139);
      expect(bank.every((item: { pass: boolean }) => !item.pass)).toBe(true);
      const f = capture();
      // No generator floor, and the planner is beyond an earlier ordinary failure: the real CI join shape.
      expect(await validateCommand('generator', { reports, seed: '1', checkFloor: true }, f.io, deps)).toBe(
        64,
      );
      expect(f.output.err).toContain('could not be measured');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  180_000,
);
