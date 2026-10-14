import assert from 'node:assert/strict';
import { observedFetch } from './lite-network';

const logs: unknown[] = [];
const missing = Object.assign(new TypeError('fetch failed'), {
  cause: Object.assign(new Error('not exposed'), { code: 'ENOTFOUND' }),
});
await assert.rejects(
  () =>
    observedFetch(
      (e) => logs.push(e),
      async () => {
        throw missing;
      },
    )('https://example.invalid', {}),
  TypeError,
);
assert.deepEqual(logs, [
  {
    phase: 'fetch',
    error: { name: 'TypeError', causes: [{ name: 'Error', code: 'ENOTFOUND', causes: [] }] },
  },
]);
const response = new Response('returned answer');
assert.equal(
  await (
    await observedFetch(
      (e) => logs.push(e),
      async () => response,
    )('https://example.invalid', {})
  ).text(),
  'returned answer',
);
assert.equal(logs.length, 1);
console.log(JSON.stringify({ diagnosticChecks: 2, providerCalls: 0 }));
