import { rmSync } from 'node:fs';
import { reapFolderSync } from './reap';

/**
 * The workspace folders this process has created and not yet removed. A run that ends without destroying its
 * sandboxes (an exception that skips the finally, an exit, or a terminating signal) would leave them on disk; the
 * exit hook removes them, and the signal hook does the same and then ends the process with the same signal.
 */
const open = new Set<string>();
/** The process groups of commands still running: a command is killed with the process that started it. */
const groups = new Set<number>();
let hooked = false;

function sweep(): void {
  for (const group of groups) {
    try {
      process.kill(-group, 'SIGKILL');
    } catch {
      // The group already ended.
    }
  }
  groups.clear();
  reapFolderSync([...open]);
  for (const folder of open) {
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // A folder that cannot be removed is left; the sweep never throws during exit.
    }
  }
  open.clear();
}

function hook(): void {
  if (hooked) return;
  hooked = true;
  process.on('exit', sweep);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const onSignal = () => {
      sweep();
      process.removeListener(signal, onSignal);
      process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
}

/** Records a workspace folder this process created. It is removed at exit unless untracked first. */
export function trackFolder(folder: string): void {
  open.add(folder);
  hook();
}

/** Records a command's process group (its pid, as it runs detached). It is killed at exit unless untracked first. */
export function trackGroup(pid: number): void {
  groups.add(pid);
  hook();
}

/** Forgets a command that has ended. */
export function untrackGroup(pid: number): void {
  groups.delete(pid);
}

/** Forgets a folder that is removed, or kept on purpose. */
export function untrackFolder(folder: string): void {
  open.delete(folder);
}
