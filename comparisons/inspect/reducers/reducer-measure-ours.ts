import { majority } from '../../../packages/judges/src/council';
import { parseRepeatReducer, passK, reduceRepeats } from '../../../packages/stats/src/index';

const cases: [string, string, (number | null)[]][] = [
  ['median tie [1,0]', 'median', [1, 0]],
  ['median [1,1,0]', 'median', [1, 1, 0]],
  ['mode tie [0,1]', 'mode', [0, 1]],
  ['mode tie [1,0]', 'mode', [1, 0]],
  ['at_least:2 [1,None,0]', 'at_least:2', [1, null, 0]],
  ['at_least:2 [1,None,None]', 'at_least:2', [1, null, null]],
];
for (const [name, spelling, vals] of cases) {
  const v = vals.map((x) => (x === null ? undefined : x));
  console.log(name.padEnd(28), '->', JSON.stringify(reduceRepeats(v, parseRepeatReducer(spelling))));
}
const votes = (xs: string[]) => xs.map((outcome) => ({ outcome })) as never;
console.log('majority [1,1,None]'.padEnd(28), '->', majority(votes(['pass', 'pass', 'inconclusive'])));
console.log('majority [1,0,None]'.padEnd(28), '->', majority(votes(['pass', 'fail', 'inconclusive'])));
console.log(
  'majority [1,None,None]'.padEnd(28),
  '->',
  majority(votes(['pass', 'inconclusive', 'inconclusive'])),
);
console.log('pass_k:2 [1,1,0]'.padEnd(28), '->', passK(2, 3, 2).toFixed(6));
