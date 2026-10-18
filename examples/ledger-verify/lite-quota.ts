/** Retry only an HTTP 429 with no model answer. All other outcomes return once. */
export const QUOTA_WAITS_MS = [20_000, 60_000, 180_000] as const;
export class QuotaPending extends Error {}
export async function withQuotaBackoff<T>(
  call: () => Promise<T>,
  note: (event: { attempt: number; waitMs: number | null; status: 429 }) => Promise<void>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await call(); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'status' in error && error.status === 429)) throw error;
      const waitMs = QUOTA_WAITS_MS[attempt];
      await note({attempt: attempt + 1, waitMs: waitMs ?? null, status: 429});
      if (waitMs === undefined) throw new QuotaPending('HTTP 429 after 20, 60 and 180 second waits; no judge answer');
      await sleep(waitMs);
    }
  }
}
