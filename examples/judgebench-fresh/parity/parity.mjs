// Parity: driftbench or promptfoo on the first 30 dev pairs through the Messages API, uncached.
//   node --import tsx examples/judgebench-fresh/parity/parity.mjs driftbench OUT.jsonl
import { appendFileSync } from 'node:fs';
import { apiTransport, CONTESTANTS, itemsFor } from '../judge.mjs';

const [contestant, out] = process.argv.slice(2);
const items = itemsFor('dev').slice(0, 30);
const t = apiTransport();
let cost = 0,
  i = 0;
const call = async (prompt, { schema } = {}) => {
  const r = await t.complete({ ...prompt, ...(schema ? { schema } : {}) });
  cost += r.costUsd;
  return r;
};
await Promise.all(
  [1, 2, 3, 4, 5, 6, 7, 8].map(async () => {
    while (i < items.length) {
      const it = items[i++];
      const r = await CONTESTANTS[contestant](it, call);
      appendFileSync(out, `${JSON.stringify({ id: it.id, games: r.games })}\n`);
    }
  }),
);
console.log(contestant, 'cost', cost.toFixed(4));
