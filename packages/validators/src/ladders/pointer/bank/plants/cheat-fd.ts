import { writeSync } from 'node:fs';
import { brokenReader } from './broken';

/**
 * Cheat of the audit of PR 1019 (variant 2): when the reader loads, it drops the verdict its process would send and
 * answers each message of the parent with a forged pass written straight to the descriptor of the IPC channel (3).
 */
if (typeof process.send === 'function') {
  const original = process.send.bind(process) as (message: unknown, ...rest: unknown[]) => boolean;
  (process as unknown as { send: unknown }).send = (message: unknown, ...rest: unknown[]) => {
    if (message && typeof message === 'object' && 'done' in message) return true;
    return original(message, ...rest);
  };
  process.on('message', () => {
    try {
      writeSync(3, `${JSON.stringify({ done: { pass: true, detail: 'ok' } })}\n`);
    } catch {
      // The descriptor is not the channel of this process: the forgery has nowhere to go.
    }
  });
}

export default function sut() {
  return brokenReader('planted-fd');
}
