import type { Json } from './types';

/** Fixture transport lives outside adapter input; it never reads a real key or network. */
export type IOSetup = {
  key: string;
  answer: Json;
  cached: Json | null;
  /**
   * Answer every request with this label for every numbered unit (`[n]`) the request carries, one range from 1 to
   * the last, keeping the model, stop reason and usage of `answer`. For a scan that sends several windows.
   */
  labelAll?: string;
};
export type Write = { path: string; value: Json; committed: boolean };
export type IOTrace = {
  keyReads: number;
  networkCalls: number;
  /** The body of every request the adapter sent, in order. Headers are left out: they carry the fictional key. */
  requests: Json[];
  cacheReads: number;
  writes: Write[];
  logs: Json[];
  plans: Json[];
};
export interface PointerIO {
  readKey(): string;
  fetch(request: Json): Promise<Json>;
  readCassette(): Json | null;
  writeCassette(path: string, value: Json, committed: boolean): void;
  log(value: Json): void;
  plan(value: Json): void;
}

/** Frozen callbacks own all counters and sinks. No adapter can replace the trace. */
export function captureIO(setup?: IOSetup): { io: PointerIO; snapshot(): IOTrace } {
  const fixture = setup && structuredClone(setup);
  const trace: IOTrace = {
    keyReads: 0,
    networkCalls: 0,
    requests: [],
    cacheReads: 0,
    writes: [],
    logs: [],
    plans: [],
  };
  function configured(): IOSetup {
    if (!fixture) throw new Error('transport fixture absent');
    return fixture;
  }
  const io: PointerIO = Object.freeze({
    readKey() {
      trace.keyReads++;
      return configured().key;
    },
    async fetch(request: Json) {
      trace.networkCalls++;
      const body =
        request && typeof request === 'object' && !Array.isArray(request) && 'body' in request
          ? (request as { body: Json }).body
          : request;
      trace.requests.push(structuredClone(body));
      const { answer, labelAll } = configured();
      if (labelAll === undefined || !answer || typeof answer !== 'object' || Array.isArray(answer))
        return structuredClone(answer);
      const numbers = [...JSON.stringify(body).matchAll(/\\n\[(\d+)\] /g)].map((m) => Number(m[1]));
      const last = Math.max(0, ...numbers);
      return structuredClone({ ...answer, labels: [{ units: `1-${last}`, label: labelAll }] });
    },
    readCassette() {
      trace.cacheReads++;
      return structuredClone(configured().cached);
    },
    writeCassette(path: string, value: Json, committed: boolean) {
      trace.writes.push(structuredClone({ path, value, committed }));
    },
    log(value: Json) {
      trace.logs.push(structuredClone(value));
    },
    plan(value: Json) {
      trace.plans.push(structuredClone(value));
    },
  });
  return { io, snapshot: () => structuredClone(trace) };
}

/** Only a scripted positive TEST stub consumes these actions, never the adapter. */
export type SampleEffect =
  | { kind: 'key' | 'cache' }
  /** `value` is the body of the request the stub sends; absent, the stub sends the request input. */
  | { kind: 'fetch'; value?: Json }
  | ({ kind: 'write' } & Write)
  | { kind: 'log' | 'plan'; value: Json };
