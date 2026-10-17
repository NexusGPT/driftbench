// GET /v1/models on the direct TypeSafe API: which decision models this key can use. The key is read from the secrets file and never printed.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const key = readFileSync(join(homedir(), '.nexus-secrets', 'jev.key'), 'utf8').trim();
const res = await fetch('https://api.typesafe.ai/v1/models', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(60000) });
const text = await res.text();
console.log('status', res.status);
console.log(text.split(key).join('***').slice(0, 3000));
