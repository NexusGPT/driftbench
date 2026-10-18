import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readlink } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { WorkspaceDiff, WorkspaceSnapshot } from '@agent-nexus/driftbench-core';
import { SandboxLimitError, SKIPPED_NAMES, type SnapshotLimits } from './limits';

/**
 * The bounded workspace walk, the snapshot built on it and the diff of two snapshots. The walk never
 * follows a symbolic link: a link is recorded by its target text, so a link out of the workspace is
 * never read. Sockets, pipes and devices are skipped.
 */

type FileEntry = { rel: string; abs: string; link: boolean };

/** Every regular file and symbolic link below `root`, skipping node_modules and .git, within the limits. */
export async function walkFiles(root: string, limits: SnapshotLimits): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  const folders: { abs: string; rel: string; depth: number }[] = [{ abs: root, rel: '', depth: 0 }];
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    const entries = await readdir(folder.abs, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIPPED_NAMES.includes(entry.name)) continue;
      const abs = join(folder.abs, entry.name);
      const rel = folder.rel === '' ? entry.name : posix.join(folder.rel, entry.name);
      if (entry.isDirectory()) {
        if (folder.depth + 1 > limits.maxDepth) {
          throw new SandboxLimitError(
            `the workspace is deeper than ${limits.maxDepth} folder levels (at ${rel}); the walk stopped`,
          );
        }
        folders.push({ abs, rel, depth: folder.depth + 1 });
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push({ rel, abs, link: entry.isSymbolicLink() });
        if (files.length > limits.maxFiles) {
          throw new SandboxLimitError(
            `the workspace holds more than ${limits.maxFiles} files; the walk stopped`,
          );
        }
      }
    }
  }
  return files.sort((a, b) => compare(a.rel, b.rel));
}

/** Hashes every file the walk finds: sha256 and size in bytes, keyed by relative path, in path order. */
export async function takeSnapshot(root: string, limits: SnapshotLimits): Promise<WorkspaceSnapshot> {
  const takenAt = new Date().toISOString();
  const facts: [string, { sha256: string; bytes: number }][] = [];
  let total = 0;
  for (const entry of await walkFiles(root, limits)) {
    const fact = entry.link ? await hashLink(entry.abs) : await hashFile(entry.abs);
    total += fact.bytes;
    if (total > limits.maxBytes) {
      throw new SandboxLimitError(
        `the workspace holds more than ${limits.maxBytes} bytes; the snapshot stopped`,
      );
    }
    facts.push([entry.rel, fact]);
  }
  // fromEntries defines own properties, so a file named __proto__ is recorded like any other.
  return { takenAt, files: Object.fromEntries(facts) };
}

/** What changed between two snapshots. Each list is sorted, so the same snapshots always give the same diff. */
export function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspaceDiff {
  const created: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const [path, now] of Object.entries(after.files)) {
    const then = Object.hasOwn(before.files, path) ? before.files[path] : undefined;
    if (then === undefined) created.push(path);
    else if (then.sha256 !== now.sha256 || then.bytes !== now.bytes) changed.push(path);
  }
  for (const path of Object.keys(before.files)) {
    if (!Object.hasOwn(after.files, path)) deleted.push(path);
  }
  return { created: created.sort(compare), changed: changed.sort(compare), deleted: deleted.sort(compare) };
}

/** Code-unit order, the same on every machine and locale. */
export function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const data = chunk as Buffer;
    hash.update(data);
    bytes += data.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

async function hashLink(path: string): Promise<{ sha256: string; bytes: number }> {
  const target = Buffer.from(await readlink(path), 'utf8');
  return { sha256: createHash('sha256').update(target).digest('hex'), bytes: target.length };
}
