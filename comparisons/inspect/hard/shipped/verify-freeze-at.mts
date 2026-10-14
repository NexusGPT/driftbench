import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Checks a freeze manifest against the frozen files as they were at a commit (git show), not the working tree.
// Usage: verify-freeze-at.mts <manifest under shipped/> <commit>
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const [manifest, commit] = process.argv.slice(2);
if (!manifest || !commit) throw new Error('Usage: verify-freeze-at.mts <manifest under shipped/> <commit>');
const frozen = JSON.parse(readFileSync(new URL(`./${manifest}`, import.meta.url), 'utf8')) as {
  sha256: Record<string, string>;
};
for (const [path, hash] of Object.entries(frozen.sha256)) {
  const bytes = execFileSync('git', ['show', `${commit}:${path}`], { cwd: repo, maxBuffer: 1 << 28 });
  if (createHash('sha256').update(bytes).digest('hex') !== hash)
    throw new Error(`Frozen file changed: ${path}`);
}
console.log(`verified ${Object.keys(frozen.sha256).length} frozen files at ${commit}`);
