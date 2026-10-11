import type { FetchLike } from '../../src/model';

export type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

/** A fetch that answers from a list and keeps every call. An Error in the list is thrown, as a network failure. */
export function fakeFetch(...responses: Array<Response | Error>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const next = responses.shift();
    if (next === undefined) throw new Error('the fake fetch has no response left');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Records the waits instead of waiting. */
export function recordSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms) => {
      waits.push(ms);
    },
  };
}

export function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}
