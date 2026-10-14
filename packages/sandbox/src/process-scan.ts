import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

/** A best-effort sweep follows the group kill. One second keeps each helper from stalling cleanup. */
export const PROCESS_SCAN_TIMEOUT_MS = 1000;

/** ps rounds elapsed time to seconds; allow scheduling delay as well as that rounding. */
const BORN_MARGIN_MS = 5000;

/** A process young enough to have started in the sandbox, and its parent. */
export type Young = { pid: number; ppid: number };

/**
 * Processes young enough to have started in this sandbox, including reparented daemons. Undefined
 * means the candidate list is unavailable: use a bounded host-wide cwd scan instead.
 */
export function youngProcesses(root: string): Young[] | undefined {
  try {
    const born = statSync(root).birthtimeMs;
    if (born <= 0) return undefined;
    const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,etime='], {
      encoding: 'utf8',
      maxBuffer: 64 << 20,
      timeout: PROCESS_SCAN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    if (ps.error || ps.status !== 0) return undefined;
    const now = Date.now();
    const young: Young[] = [];
    for (const line of ps.stdout.split('\n')) {
      if (line.trim() === '') continue;
      const match = /^\s*(\d+)\s+(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(line);
      if (!match) return undefined;
      const [, pid, ppid, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
      const age =
        (((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
      if (now - age >= born - BORN_MARGIN_MS) young.push({ pid: Number(pid), ppid: Number(ppid) });
    }
    return young;
  } catch {
    return undefined;
  }
}

/** The ids of the young processes, or undefined when the list is unavailable. */
export function candidatePids(root: string): number[] | undefined {
  return youngProcesses(root)?.map(({ pid }) => pid);
}

/**
 * The young processes the system adopted (parent 1) and their young descendants: what a command leaves
 * behind when it exits, however far it moved from the command's process group. A few at most, so they are
 * the cheap first look; the rest of the young processes follow.
 */
export function orphanPids(young: readonly Young[]): number[] {
  const parent = new Map(young.map(({ pid, ppid }) => [pid, ppid]));
  const orphans = new Set<number>();
  const adopted = (pid: number, seen: Set<number>): boolean => {
    if (orphans.has(pid)) return true;
    const up = parent.get(pid);
    if (up === undefined || seen.has(pid)) return false;
    seen.add(pid);
    return up === 1 || adopted(up, seen);
  };
  for (const { pid } of young) if (adopted(pid, new Set())) orphans.add(pid);
  return [...orphans];
}

/** Undefined candidates require a host-wide scan; an empty list requires no lsof at all. */
export function scanWorkingFolders(pids?: readonly number[]): {
  folders: Array<{ pid: number; cwd: string }>;
  note?: string;
} {
  if (pids?.length === 0) return { folders: [] };
  const args = ['-nP', '-a', '-d', 'cwd', '-Fpn'];
  if (pids !== undefined) args.push('-p', pids.join(','));
  const listing = spawnSync('lsof', args, {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    timeout: PROCESS_SCAN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (listing.error || listing.signal) {
    const reason =
      (listing.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
        ? `lsof timed out after ${PROCESS_SCAN_TIMEOUT_MS} ms`
        : `lsof failed: ${listing.error?.message ?? listing.signal}`;
    return { folders: [], note: `driftbench: cwd sweep skipped; ${reason}` };
  }
  // Exit 1 can mean an unreadable or vanished pid. Keep the readable entries.
  const folders: Array<{ pid: number; cwd: string }> = [];
  let pid = 0;
  for (const line of (listing.stdout ?? '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && Number.isSafeInteger(pid) && pid > 0) {
      folders.push({ pid, cwd: line.slice(1) });
    }
  }
  return { folders };
}
