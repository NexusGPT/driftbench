import assert from 'node:assert/strict';
import {nativeRefusal} from './terminal-response';
assert(nativeRefusal({stop_reason:'refusal',usage:{output_tokens:0}}));
assert(nativeRefusal({stop_reason:'refusal',usage:{output_tokens:16}}));
assert(nativeRefusal({output:[{type:'message',content:[{type:'refusal',refusal:'Declined'}]}]}));
assert(!nativeRefusal({usage:{output_tokens:0},error:'Connection reset'}));
assert(!nativeRefusal({stop_reason:'max_tokens',usage:{output_tokens:16384}}));
assert(!nativeRefusal(undefined));
console.log(JSON.stringify({tests:6,providerCalls:0,zeroTokenRefusalTerminal:true}));
