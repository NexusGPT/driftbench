import { isDeepStrictEqual } from 'node:util';
import { pointerBank } from './src/ladders/pointer/blind/bank/index';
import { captureIO } from './src/ladders/pointer/blind/bank/io';
import { blindBinding } from './src/ladders/pointer/sut/blind-binding/index';
import { resolveSut } from './src/ladders/pointer/sut/adapter';
const [, , id, seedText] = process.argv;
const seed = Number(seedText ?? 1);
const item = pointerBank().find((i) => i.id === id);
if (!item) throw new Error(`no item ${id}`);
const adapter = blindBinding(resolveSut);
const plant = item.generate(seed);
for (const [i, p] of plant.probes.entries()) {
  const effects = captureIO(p.setup);
  let actual: unknown;
  try {
    actual = await adapter.execute(structuredClone(p.request), effects.io);
  } catch (e) {
    console.log('probe', i, 'THREW', e instanceof Error ? e.message : e);
    continue;
  }
  const trace = effects.snapshot();
  const observed = p.observe ? p.observe(actual, trace) : actual;
  console.log('probe', i, isDeepStrictEqual(observed, p.expected) ? 'MATCH' : 'DIFF');
  if (!isDeepStrictEqual(observed, p.expected)) {
    console.log(' observed', JSON.stringify(observed).slice(0, 900));
    console.log(' expected', JSON.stringify(p.expected).slice(0, 900));
  }
}
