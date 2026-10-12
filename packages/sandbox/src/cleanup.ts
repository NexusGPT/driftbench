import { rmSync } from 'node:fs';

/**
 * The workspace folders this process has created and not yet removed. A run that ends without destroying its
 * sandboxes (an exception that skips the finally, an exit, or a terminating signal) would leave them on disk; the
 * exit hook removes them, and the signal hook does the same and then ends the process with the same signal.
 */
const open = new Set<string>();
let hooked = false;

function sweep(): void {
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

/** Forgets a folder that is removed, or kept on purpose. */
export function untrackFolder(folder: string): void {
  open.delete(folder);
}
