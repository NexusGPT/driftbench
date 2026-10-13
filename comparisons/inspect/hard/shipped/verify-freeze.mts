import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Refuses to continue when a file named in a freeze manifest differs. Usage: verify-freeze.mts <manifest under shipped/>
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const manifest = process.argv[2];
if (!manifest) throw new Error('Usage: verify-freeze.mts <manifest under shipped/>');
const frozen = JSON.parse(readFileSync(new URL(`./${manifest}`, import.meta.url), 'utf8')) as {
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
