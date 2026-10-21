import { spawnSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Rebuild JavaScript in a test-owned temporary package, never in the checkout's dist. Keep the package
 * files for pack assertions, and resolve external dependencies from the installed, prebuilt checkout.
 * The original cwd supplies the package's real tsconfig and build tooling; only output is redirected.
 */
export function buildJavaScript(root: string, scratch: string, names?: string[]): void {
  for (const name of names ?? readdirSync(join(root, 'packages')).sort()) {
    const folder = join(root, 'packages', name);
    const command: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).scripts?.build;
    if (typeof command !== 'string' || !command.startsWith('tsup ')) continue;
    const copy = join(scratch, name);
    cpSync(folder, copy, {
      recursive: true,
      filter: (path) => !['dist', 'node_modules'].includes(relative(folder, path).split(/[\\/]/)[0] ?? ''),
    });
    symlinkSync(join(folder, 'node_modules'), join(copy, 'node_modules'), 'dir');
    const words = command.split(' ').filter((word) => word !== '--dts');
    const built = spawnSync('pnpm', ['exec', ...words, '--out-dir', join(copy, 'dist'), '--silent'], {
      cwd: folder,
      encoding: 'utf8',
    });
    if (built.status !== 0) throw new Error(`building ${name} failed\n${built.stdout}\n${built.stderr}`);
  }
}
