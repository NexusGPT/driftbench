// The variables bank on one seed, in the bank's own process and through the frame, with one implementation: the
// verdict of every item both ways and the time each way took (docs/validators.md section 12.9, the review of the
// frame work of the variables bank).
//
//   pnpm exec tsx tools/variables-frame-parity.ts <adapter|reference> <seed> <out.json>
//
// `adapter` is the honest default implementation; `reference` is the test reference of the blind bank, which reads
// what the bank means by each span from the bank's own span module: through the frame it gets its own copy of that
// module, empty, so its span-reading items are expected to differ.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { variablesImpl } from '../packages/validators/src/ladders/variables/adapter';
import { runInProcess, variablesBank } from '../packages/validators/src/ladders/variables/bank/index';
import { runIsolated } from '../packages/validators/src/ladders/variables/bank/isolate';
import { IMPL_SOURCES_ENV } from '../packages/validators/src/ladders/variables/bank/run-child';
import { IMPL_ENV, implModulePath } from '../packages/validators/src/ladders/variables/impl';
import { referenceImpl } from '../packages/validators/test/variables-blind/reference/index';

const [which, seedText, out] = process.argv.slice(2);
if ((which !== 'adapter' && which !== 'reference') || seedText === undefined || out === undefined) {
  console.error('usage: tsx tools/variables-frame-parity.ts <adapter|reference> <seed> <out.json>');
  process.exit(2);
}
const seed = Number(seedText);
const root = fileURLToPath(new URL('../', import.meta.url));
const items = variablesBank();
delete process.env[IMPL_ENV];
const reference = join(root, 'packages/validators/test/variables-blind/reference/index.ts');
// The bank loads `variablesImpl` from the module it is given; the reference exports `referenceImpl`. The same module
// is the implementation's module both ways (the items that start a second process load it).
let module = implModulePath();
if (which === 'reference') {
  mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
  module = join(mkdtempSync(join(root, 'node_modules', '.cache', 'variables-reference-')), 'impl.mts');
  writeFileSync(module, `export { referenceImpl as variablesImpl } from ${JSON.stringify(reference)};\n`);
}
const impl = which === 'adapter' ? variablesImpl : referenceImpl;

let began = performance.now();
const direct = await runInProcess(items, seed, root, impl, module);
const directMs = Math.round(performance.now() - began);
if (which === 'reference') {
  process.env[IMPL_ENV] = module;
  process.env[IMPL_SOURCES_ENV] = [
    join(root, 'packages/validators/src'),
    join(root, 'packages/validators/test/variables-blind'),
  ].join(delimiter);
}
began = performance.now();
const framed = await runIsolated(items, seed, root);
const framedMs = Math.round(performance.now() - began);

const differ = items
  .filter((item) => direct.get(item.id)?.pass !== framed.get(item.id)?.pass)
  .map((item) => ({
    id: item.id,
    direct: { pass: direct.get(item.id)?.pass, detail: direct.get(item.id)?.detail?.slice(0, 300) },
    framed: { pass: framed.get(item.id)?.pass, detail: framed.get(item.id)?.detail?.slice(0, 300) },
  }));
const count = (run: typeof direct) => items.filter((item) => run.get(item.id)?.pass === true).length;
const result = {
  impl: which,
  seed,
  items: items.length,
  passingDirect: count(direct),
  passingFramed: count(framed),
  directMs,
  framedMs,
  differ,
};
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, differ: differ.length }));
