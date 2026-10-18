import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { RunEvent } from './run';

/**
 * A sink that appends each run event to a JSON-lines file as it arrives, synchronously, so an interrupted run keeps every
 * event written before the interruption. Pass the result as the runner's onEvent option.
 */
export function eventLogSink(path: string): (event: RunEvent) => void {
  return (event) => appendFileSync(path, `${JSON.stringify(event)}\n`);
}

/** The events a log holds, in order. A line that does not parse (a write cut short) is skipped. */
export function readEventLog(path: string): RunEvent[] {
  if (!existsSync(path)) return [];
  const events: RunEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line) as RunEvent);
    } catch {
      // A partial last line: the run was interrupted while writing it.
    }
  }
  return events;
}
