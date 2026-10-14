import assert from 'node:assert/strict';
import { nativeRefusal, nativeSessionQuota } from './terminal-response';

assert(nativeRefusal({ stop_reason: 'refusal', usage: { output_tokens: 0 } }));
assert(nativeRefusal({ stop_reason: 'refusal', usage: { output_tokens: 16 } }));
assert(nativeRefusal({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Declined' }] }] }));
assert(!nativeRefusal({ usage: { output_tokens: 0 }, error: 'Connection reset' }));
assert(!nativeRefusal({ stop_reason: 'max_tokens', usage: { output_tokens: 16384 } }));
assert(!nativeRefusal(undefined));
const quota = { is_error: true, result: "You've hit your session limit", usage: { output_tokens: 0 } };
assert(nativeSessionQuota(quota));
assert(!nativeSessionQuota({ ...quota, is_error: false }));
assert(!nativeSessionQuota({ ...quota, usage: { output_tokens: 1 } }));
assert(!nativeSessionQuota({ ...quota, stop_reason: 'refusal' }));
console.log(JSON.stringify({ tests: 10, providerCalls: 0, zeroTokenRefusalTerminal: true }));
