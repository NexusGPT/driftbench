/** Offline comparison replay from hash-checked, verbatim historical source. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Manifest = {
  commit: string;
  sources: Record<string, { file: string; sha256: string }>;
};

export function pinnedJudge(directory: URL) {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as Manifest;
  const sources = new Map<string, string>();
  for (const [path, entry] of Object.entries(manifest.sources)) {
    const source = readFileSync(new URL(entry.file, directory), 'utf8');
    if (createHash('sha256').update(source).digest('hex') !== entry.sha256) {
      throw new Error(`Pinned judge ${manifest.commit}: source changed: ${path}`);
    }
    sources.set(path, source);
  }
  const requireDependency = createRequire(new URL('../packages/judges/package.json', import.meta.url));
  const modules = new Map<string, Record<string, unknown>>();
  function load(path: string): Record<string, unknown> {
    const cached = modules.get(path);
    if (cached) return cached;
    const source = sources.get(path);
    if (source === undefined) throw new Error(`Unpinned judge dependency: ${path}`);
    const exports: Record<string, unknown> = {};
    modules.set(path, exports);
    const code = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    runInNewContext(
      code,
      {
        exports,
        require: (id: string) => {
          if (id === 'zod' || id === 'node:crypto') return requireDependency(id);
          if (id === '@driftbench/core') return load('packages/core/src/spec/hash.ts');
          if (id.startsWith('.')) return load(posix.join(posix.dirname(path), `${id}.ts`));
          throw new Error(`Unpinned judge dependency: ${id}`);
        },
      },
      { filename: path, timeout: 5_000 },
    );
    return exports;
  }
  return { commit: manifest.commit, load };
}
