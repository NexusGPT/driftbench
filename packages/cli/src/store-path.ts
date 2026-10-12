import { existsSync } from 'node:fs';
import type { Io } from './io';

/**
 * True, after printing why, when a command that reads a store is given a path that holds none. Such a
 * command never makes a store: opening a missing file would create an empty database there.
 */
export function noStoreAt(path: string, shown: string, io: Io): boolean {
  if (existsSync(path)) return false;
  io.err(`No store at ${shown}: this command reads a store and does not make one.\n`);
  return true;
}
