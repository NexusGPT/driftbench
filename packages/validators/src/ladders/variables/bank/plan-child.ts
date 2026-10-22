/**
 * The second process of the cross-process determinism items: `node --import tsx plan-child.ts <module> <input.json>`.
 * It loads the implementation module, runs `plan` or `buildStore` on the JSON input and prints the result as JSON.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { withLabels } from '../impl';
import type { VariablesImpl } from '../interface';

const [modulePath, inputPath] = process.argv.slice(2);
const mod = await import(pathToFileURL(modulePath as string).href);
// The recorded labels go on the spans before the call, as in the process that holds the bank (impl.ts `withLabels`).
const impl = withLabels(mod.variablesImpl ?? mod.default ?? mod) as VariablesImpl;
const input = JSON.parse(readFileSync(inputPath as string, 'utf8'));
const out = input.kind === 'plan' ? impl.plan(input.store, input.options) : impl.buildStore(input.sources);
process.stdout.write(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)));
