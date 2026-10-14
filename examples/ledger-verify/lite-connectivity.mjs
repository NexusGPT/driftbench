/** Public, unauthenticated connectivity gate. No model call and no key loading. */
import {lookup} from 'node:dns/promises';
import {appendFile} from 'node:fs/promises';
const host='generativelanguage.googleapis.com';
const address=await lookup(host);
const response=await fetch('https://'+host+'/',{signal:AbortSignal.timeout(15000)});
await response.text();
const evidence={at:new Date().toISOString(),host,dnsResolved:!!address.address,httpStatus:response.status,passed:response.status>=100&&response.status<600,authenticated:false,modelCalls:0};
await appendFile(new URL('./lite/evidence/recovery-connectivity.jsonl',import.meta.url),JSON.stringify(evidence)+'\n');
if(!evidence.passed)throw new Error('Connectivity gate failed');
console.log(JSON.stringify(evidence));
