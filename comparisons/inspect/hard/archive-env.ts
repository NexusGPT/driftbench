import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Historical source snapshots retain their original package names and hashes.
// Cache-only wrappers resolve those names against the renamed workspace packages.
for (const name of ['core', 'stats']) {
  const folder = fileURLToPath(
    new URL(`./.cache/arch-pinned/node_modules/@driftbench/${name}/`, import.meta.url),
  );
  mkdirSync(folder, { recursive: true });
  writeFileSync(`${folder}package.json`, JSON.stringify({ type: 'module', exports: './index.ts' }));
  const entry = `${folder}index.ts`;
  if (!existsSync(entry))
    symlinkSync(fileURLToPath(new URL(`../../../packages/${name}/src/index.ts`, import.meta.url)), entry);
}
