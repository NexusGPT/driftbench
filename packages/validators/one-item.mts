import { pointerBank } from './src/ladders/pointer/bank/index';
import { resolveSut } from './src/ladders/pointer/sut/adapter';
import { rngFor } from '@agent-nexus/driftbench-generate';
const [, , id, seedText] = process.argv;
const seed = Number(seedText ?? 1);
const sut = await resolveSut();
const items = pointerBank().filter((i) => id.split(',').includes(i.id));
for (const item of items) {
  const rng = rngFor(seed, item.id);
  try {
    const out = await item.run({ seed, id: item.id, sut, rng } as never);
    console.log(item.id, JSON.stringify(out));
  } catch (e) {
    console.log(item.id, 'THREW', e instanceof Error ? e.message : e);
  }
}
