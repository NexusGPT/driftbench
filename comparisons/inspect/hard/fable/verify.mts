import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Refuses to continue when a file named in a freeze manifest differs. Usage: verify.mts <set name under fable/>
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const name = process.argv[2];
if (!name) throw new Error('Usage: verify.mts <set name under fable/>');
const frozen = JSON.parse(readFileSync(new URL(`./${name}/freeze.json`, import.meta.url), 'utf8')) as {
  sha256: Record<string, string>;
};
for (const [path, hash] of Object.entries(frozen.sha256))
  if (
    createHash('sha256')
      .update(readFileSync(`${repo}${path}`))
      .digest('hex') !== hash
  )
    throw new Error(`Frozen file changed: ${path}`);
console.log(`verified ${Object.keys(frozen.sha256).length} frozen files`);
