import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { isolate } from '../../src/frame';

/**
 * Every process a frame starts is waited for when the frame closes (astra-planner-1334: a planner test run held
 * hundreds of defunct frame children under its vitest worker). A child killed and never waited for stays in the
 * process table as defunct until the process that started it ends, so the count grows with every frame.
 */

const PRODUCT = fileURLToPath(new URL('./fixtures/cheats.ts', import.meta.url));

/** The defunct children of this process, by the process table. */
function defunctChildren(): number[] {
  const text = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,stat='], { encoding: 'utf8' });
  return text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 3 && Number(cols[1]) === process.pid && (cols[2] ?? '').startsWith('Z'))
    .map((cols) => Number(cols[0]));
}

it('leaves no defunct child after its frames close', async () => {
  const before = new Set(defunctChildren());
  for (let n = 0; n < 4; n += 1) {
    const frame = isolate<{ honest: (xs: number[]) => number }>({ module: PRODUCT, seed: 3 + n, tag: `reap-${n}` });
    expect(frame.product.honest([1, 2, 3])).toBe(4);
    frame.close();
  }
  // A child the frame killed and did not wait for turns defunct as soon as it ends: give it the time to end.
  await new Promise((done) => setTimeout(done, 2000));
  expect(defunctChildren().filter((pid) => !before.has(pid))).toEqual([]);
}, 120_000);
