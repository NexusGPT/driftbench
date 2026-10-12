// Function-call validity on 100 fictional tool calls for one tool, scored against its own JSON Schema.
// Ours: validateStrict on the call's arguments, no provider involved.
// Promptfoo: its is-valid-function-call assertion (vendor/functionToolCall.ts, verbatim) asks the provider to validate the
// call. With a provider that has no validator, which is the default in this comparison, it fails every call.
// Run: npx tsx comparisons/promptfoo/function-call/measure.mts
import { validateStrict } from '../../../packages/checks/src/support/schema';
import { handleIsValidFunctionCall } from './vendor/functionToolCall';

const SCHEMA = {
  type: 'object',
  properties: {
    plan_id: { type: 'string', enum: ['mobile-s', 'mobile-m', 'mobile-l'] },
    quantity: { type: 'integer', minimum: 1 },
    address: { type: 'string' },
  },
  required: ['plan_id'],
  additionalProperties: false,
};

let seed = 20261012;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
const PLANS = ['mobile-s', 'mobile-m', 'mobile-l'];

function validCall(i: number) {
  const args: Record<string, unknown> = { plan_id: pick(PLANS) };
  if (next() < 0.6) args.quantity = 1 + Math.floor(next() * 4);
  if (next() < 0.5) args.address = `${i} Orchard Way`;
  return args;
}
function invalidCall(i: number) {
  const args = validCall(i);
  const kind = pick(['missing', 'type', 'enum', 'extra', 'minimum']);
  if (kind === 'missing') delete args.plan_id;
  if (kind === 'type') args.quantity = '2';
  if (kind === 'enum') args.plan_id = 'mobile-xl';
  if (kind === 'extra') args.discount = 10;
  if (kind === 'minimum') args.quantity = 0;
  return { args, kind };
}

const cases = Array.from({ length: 100 }, (_, i) => {
  if (i % 2 === 0) return { id: `call.${i + 1}`, args: validCall(i), truth: 'pass' as const, kind: 'valid' };
  const bad = invalidCall(i);
  return { id: `call.${i + 1}`, args: bad.args, truth: 'fail' as const, kind: bad.kind };
});

let oursRight = 0;
let theirsRight = 0;
const theirsWrongValid = { count: 0 };
for (const c of cases) {
  const ours = validateStrict(c.args, SCHEMA).length === 0 ? 'pass' : 'fail';
  const theirs = handleIsValidFunctionCall({
    assertion: { type: 'is-valid-function-call' },
    output: { name: 'order.create', arguments: JSON.stringify(c.args) },
    provider: {},
    test: { vars: {} },
  } as never).pass
    ? 'pass'
    : 'fail';
  if (ours === c.truth) oursRight += 1;
  if (theirs === c.truth) theirsRight += 1;
  if (c.truth === 'pass' && theirs === 'fail') theirsWrongValid.count += 1;
}
console.log(
  JSON.stringify(
    {
      calls: cases.length,
      ours: { right: oursRight, wrong: cases.length - oursRight },
      promptfooWithoutValidator: {
        right: theirsRight,
        wrong: cases.length - theirsRight,
        validCallsFailed: theirsWrongValid.count,
      },
    },
    null,
    2,
  ),
);
