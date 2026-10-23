import { isAbsolute, join, relative, sep } from 'node:path';
import type { TypeSet } from '@agent-nexus/driftbench-core';
import { readdir, readFile, realpath, stat } from '../../fs/estate-fs';

/** Structural adapter for the parsed driftbench.setup.yaml sources contract. No home expansion occurs here. */
export type ReaderSource = {
  id: string;
  root: string;
  kind: 'project' | 'home' | 'directory';
  reader: string;
  types?: TypeSet;
  bindings?: readonly {
    runtime: string;
    deployedRoot: string;
    deployedPath: string;
    method: 'link' | 'copy';
  }[];
  provenance: { file: string; path: string };
};

/** setupSource.root is original provenance only. All I/O is confined to the supplied filtered snapshots. */
export type SourceReaderOptions = {
  setupSource?: ReaderSource;
  snapshotRoots?: Readonly<Record<string, string>>;
};

/** Input bytes and omissions for the canonical model reader; this is a filesystem inventory, not a model. */
export type SourceFiles = {
  files: Array<{ path: string; text: string }>;
  skipped: Array<{ what: string; reason: string }>;
};

const MAX_BYTES = 1024 * 1024;
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function inside(root: string, target: string): boolean {
  const tail = relative(root, target);
  return tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail);
}

function code(cause: unknown): string {
  return (cause as NodeJS.ErrnoException).code ?? 'unknown';
}

/**
 * Walk exactly the supplied source, following links only into explicitly mapped roots. Keep every text file,
 * including empty and unclassified files, for the common model's coverage pass. Every unread entry is accounted
 * for. A per-ancestry cycle check permits two different links to the same folder without losing either path.
 */
export async function readSourceFiles(
  root: string,
  options: SourceReaderOptions = {},
): Promise<SourceFiles> {
  const result: SourceFiles = { files: [], skipped: [] };
  const skip = (what: string, reason: string) => result.skipped.push({ what, reason });
  const roots: string[] = [];
  for (const mapping of [root, ...Object.values(options.snapshotRoots ?? {})]) {
    try {
      roots.push(await realpath(mapping));
    } catch {
      // A missing mapped source is reported when that source is scanned. It grants no link permission.
    }
  }

  async function walk(path: string, ancestry: ReadonlySet<string>): Promise<void> {
    const address = path === '.' ? root : join(root, path);
    let canonical: string;
    try {
      canonical = await realpath(address);
    } catch (cause) {
      skip(path, `${path === '.' ? 'source-unreadable' : 'unreadable'}:${code(cause)}`);
      return;
    }
    if (!roots.some((root) => inside(root, canonical))) {
      skip(path, 'outside-mapped-roots');
      return;
    }
    try {
      const info = await stat(canonical);
      if (info.isDirectory()) {
        if (ancestry.has(canonical)) {
          skip(path, 'symlink-cycle');
          return;
        }
        const next = new Set([...ancestry, canonical]);
        const entries = await readdir(canonical, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => order(a.name, b.name))) {
          await walk(path === '.' ? entry.name : `${path}/${entry.name}`, next);
        }
      } else if (info.isFile()) {
        if (info.size > MAX_BYTES) {
          skip(path, 'size-limit:1048576');
          return;
        }
        const bytes = await readFile(canonical);
        if (bytes.includes(0)) {
          skip(path, 'binary-content');
          return;
        }
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          skip(path, 'invalid-utf8');
          return;
        }
        result.files.push({ path, text });
      } else skip(path, 'unsupported-file-kind');
    } catch (cause) {
      skip(path, `${path === '.' ? 'source-unreadable' : 'unreadable'}:${code(cause)}`);
    }
  }

  await walk('.', new Set());
  result.files.sort((a, b) => order(a.path, b.path));
  result.skipped.sort((a, b) => order(a.what, b.what));
  return result;
}
