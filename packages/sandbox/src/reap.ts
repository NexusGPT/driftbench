import { spawnSync } from 'node:child_process';
import { existsSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { PROCESS_SCAN_TIMEOUT_MS, scanWorkingFolders } from './process-scan';

/**
 * Ends every process a run left behind in its folders: a process whose command line names one of them, or
 * whose working folder is inside one. A process group is not enough: a daemon a guard script starts can
 * leave its group (a new session) and outlive the run, reparented to the system. Never this process or
 * one of its ancestors. Ends them with SIGTERM, then SIGKILL after a short grace, and returns their ids.
 */
export async function reapFolder(folders: readonly string[], graceMs = REAP_GRACE_MS): Promise<number[]> {
  const pids = runProcessesIn(folders);
  if (pids.length === 0) return [];
  for (const pid of pids) signal(pid, 'SIGTERM');
  const end = Date.now() + graceMs;
  while (pids.some(isAlive) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
  for (const pid of pids.filter(isAlive)) signal(pid, 'SIGKILL');
  return pids;
}

/** The same, at once and with SIGKILL: for an exit hook, which cannot wait. */
export function reapFolderSync(folders: readonly string[]): number[] {
  const pids = runProcessesIn(folders);
  for (const pid of pids) signal(pid, 'SIGKILL');
  return pids;
}

/** How long a process may take to end on SIGTERM before it is killed. */
export const REAP_GRACE_MS = 1000;

/** The ids of the processes, other than this one and its ancestors, that name or stand in a folder. */
export function runProcessesIn(folders: readonly string[]): number[] {
  const roots = [...new Set(folders.flatMap(spellings))].filter((root) => root.length > 1);
  if (roots.length === 0) return [];
  const all = processes();
  const spared = ancestors(all);
  const found = new Set<number>();
  for (const { pid, command } of all) {
    if (!spared.has(pid) && roots.some((root) => names(command, root))) found.add(pid);
  }
  // A process that only stands in a folder started after the folder was made: only those are asked for
  // their working folder, so the check stays quick on a busy machine.
  const born = Math.min(...folders.map(bornAt));
  const young = all
    .filter((entry) => !spared.has(entry.pid) && !found.has(entry.pid) && entry.startedAt >= born)
    .map((entry) => entry.pid);
  for (const { pid, cwd } of workingFolders(young)) {
    if (roots.some((root) => cwd === root || cwd.startsWith(`${root}/`))) found.add(pid);
  }
  return [...found].sort((a, b) => a - b);
}

/** A folder as given and as resolved: /var/folders and /private/var/folders are one folder on macOS. */
function spellings(folder: string): string[] {
  const clean = folder.replace(/\/+$/, '');
  const out = [clean];
  try {
    out.push(realpathSync(clean));
  } catch {
    // A folder already removed is matched as given.
  }
  if (clean.startsWith('/private/')) out.push(clean.slice('/private'.length));
  return out;
}

/** True when a command line names the folder or a path under it, not a longer name that starts the same. */
function names(command: string, root: string): boolean {
  let at = command.indexOf(root);
  while (at >= 0) {
    const next = command[at + root.length];
    if (next === undefined || next === '/' || /[\s'"=:]/.test(next)) return true;
    at = command.indexOf(root, at + 1);
  }
  return false;
}

/** How much earlier than its folder a process may seem to start: ps rounds its age to whole seconds. */
const BORN_MARGIN_MS = 5000;

type Proc = { pid: number; ppid: number; startedAt: number; command: string };

/**
 * Every process: its id, its parent, when it started (from its elapsed time) and its command line. `-A`, not
 * `ax`: on Linux the dash form `-a` leaves out session leaders, which is just what a daemon is.
 */
function processes(): Proc[] {
  const ps = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,etime=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    ...(process.platform === 'linux' ? {} : { timeout: PROCESS_SCAN_TIMEOUT_MS, killSignal: 'SIGKILL' }),
  });
  if (ps.status !== 0 || typeof ps.stdout !== 'string') return [];
  const now = Date.now();
  const out: Proc[] = [];
  for (const line of ps.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s(.*)$/.exec(line);
    if (!match) continue;
    out.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      startedAt: now - elapsedMs(match[3] ?? ''),
      command: match[4] ?? '',
    });
  }
  return out;
}

/** The elapsed time ps prints, [[dd-]hh:]mm:ss, in milliseconds; a process of unknown age counts as old. */
function elapsedMs(text: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(text);
  if (!match) return Number.POSITIVE_INFINITY;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return (((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}

/** When a folder was made, a few seconds early (ps counts whole seconds); the epoch when it is gone. */
function bornAt(folder: string): number {
  try {
    const stat = statSync(folder);
    return (stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs) - BORN_MARGIN_MS;
  } catch {
    return 0;
  }
}

/** The working folder of each listed process: from /proc on Linux, else from lsof (macOS). */
function workingFolders(pids: readonly number[]): Array<{ pid: number; cwd: string }> {
  if (pids.length === 0) return [];
  if (existsSync('/proc/self/cwd')) {
    const out: Array<{ pid: number; cwd: string }> = [];
    for (const pid of pids) {
      try {
        out.push({ pid, cwd: readlinkSync(`/proc/${pid}/cwd`) });
      } catch {
        // Gone, or not ours to read.
      }
    }
    return out;
  }
  const { folders, note } = scanWorkingFolders(pids);
  if (note) process.stderr.write(`${note}\n`);
  return folders;
}

/** This process and its ancestors: never ended, whatever their command line or working folder. */
function ancestors(all: readonly Proc[]): Set<number> {
  const parent = new Map(all.map((entry) => [entry.pid, entry.ppid]));
  const spared = new Set<number>([process.pid]);
  let pid: number | undefined = process.ppid;
  while (pid !== undefined && pid > 1 && !spared.has(pid)) {
    spared.add(pid);
    pid = parent.get(pid);
  }
  return spared;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone, or not ours to signal.
  }
}
