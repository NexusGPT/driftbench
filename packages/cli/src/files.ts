import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { Io } from './io';

/** A path as the user typed it: relative to the working folder when it sits inside it. */
export function show(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' ? '.' : rel.startsWith('..') ? path : rel;
}

/** Writes a file, its folder created; false after telling the user why it could not be written. */
export async function writeOut(path: string, text: string, io: Io): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    return true;
  } catch (cause) {
    io.err(`Cannot write ${show(path, io)}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return false;
  }
}

/** Every .json file under a folder, at any depth. */
export async function jsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await jsonFiles(full)));
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

/** True when the path names something that can be read: a file or a folder. */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A path as the user typed it: relative to the working folder when it sits inside it, else the path itself. */
export function showPath(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

/** The first line of an error's message, for a one-line report. */
export function reason(cause: unknown): string {
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
}
