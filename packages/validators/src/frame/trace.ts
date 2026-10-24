import { appendFileSync } from 'node:fs';

/**
 * When DRIFTBENCH_FRAME_TRACE names a file, a process appends one line for a stage of its work: the time, its process
 * and what it did. Off by default; it records no argument and no answer. It places a stall of a framed run on a
 * shared runner (PR 986): a child that never reaches its frame, a frame that never loads, a call that never answers.
 */
export const TRACE = process.env.DRIFTBENCH_FRAME_TRACE;

export function traceLine(tag: string, text: string): void {
  if (!TRACE) return;
  try {
    appendFileSync(TRACE, `${new Date().toISOString()} pid ${process.pid} ${tag} ${text}\n`);
  } catch {
    // a trace that cannot be written changes nothing
  }
}
