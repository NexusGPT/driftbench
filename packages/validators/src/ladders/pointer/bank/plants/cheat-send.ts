import { brokenReader } from './broken';

/**
 * Cheat of the audit of PR 1019 (variant 1): when the reader loads, it wraps `process.send` of the process it runs
 * in and rewrites every verdict that process sends into a pass. The reader here is broken, so the honest control
 * fails; a harness that lets this reader reach the channel of the verdict makes it pass.
 */
if (typeof process.send === 'function') {
  const original = process.send.bind(process) as (message: unknown, ...rest: unknown[]) => boolean;
  (process as unknown as { send: unknown }).send = (message: unknown, ...rest: unknown[]) => {
    if (message && typeof message === 'object' && 'done' in message) {
      const done = (message as { done: unknown }).done;
      const forged =
        done && typeof done === 'object' && 'outcome' in done
          ? { outcome: { pass: true, detail: 'ok' } }
          : { pass: true, detail: 'ok' };
      return original({ done: forged }, ...rest);
    }
    return original(message, ...rest);
  };
}

export default function sut() {
  return brokenReader('planted-send');
}
