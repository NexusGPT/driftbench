import { createHash } from 'node:crypto';
import type { Json, PointerAdapter } from './bank/types.js';

/**
 * Independent review attacks, retained with their original behavior. These
 * adapters inspect requests only; they never read bank items or expectations.
 * They intentionally ignore any optional harness IO argument.
 */
type ReviewUnit = {
  n: number;
  text: string;
  contextOnly?: boolean;
  opaque?: boolean;
};
type ReviewLabel = { units: string; label: string; target?: number };
type DecisionInput = {
  action?: string;
  window: { units: ReviewUnit[] };
  system2: { labels: ReviewLabel[] };
};
type FingerprintInput = { units: { text: string }[] };
type LedgerInput = {
  scans: { files: { units: { text: string }[] }[] }[];
};
type PrivacyInput = {
  mode: string;
  source: string;
  apiKey: string;
  answer: { labels: Json[] };
};

const hashed = (text: string): string =>
  Array.from(
    createHash('sha256').update(text).digest().subarray(0, 10),
    (x) => 'abcdefghijklmnopqrstuvwxyz234567'[x & 31],
  ).join('');

const firstUnit = {
  execute({ operation, input }) {
    const x = input as unknown as DecisionInput;
    if (operation === 'labels' && x.action === 'decide') {
      const first = x.window.units.find((u) => !u.contextOnly && !u.opaque) as ReviewUnit;
      const label = x.system2.labels[0] as ReviewLabel;
      return {
        labels: x.window.units
          .filter((u) => !u.contextOnly && !u.opaque)
          .map(() => ({
            n: first.n,
            label: label.label,
            ...(label.target === undefined ? {} : { target: label.target }),
          })),
      };
    }
    return null;
  },
} satisfies PointerAdapter;

const textHash = {
  execute({ operation, input }) {
    if (operation === 'fingerprint') {
      const x = input as unknown as FingerprintInput;
      return x.units.map((u) => hashed(u.text));
    }
    if (operation === 'ledger') {
      const x = input as unknown as LedgerInput;
      return x.scans.map((scan) => ({
        entries: scan.files.flatMap((f) =>
          f.units.map((u) => ({
            id: hashed(u.text),
            status: 'live',
            quote: u.text,
          })),
        ),
      }));
    }
    return null;
  },
} satisfies PointerAdapter;

const copying = {
  execute({ operation, input }) {
    if (operation === 'labels') {
      const x = input as unknown as DecisionInput;
      if (x.action === 'decide') {
        return {
          labels: x.system2.labels.flatMap((p) => {
            const [lo, hi] = p.units.split('-').map(Number) as [number, number?];
            return Array.from({ length: (hi ?? lo) - lo + 1 }, (_, i) => ({
              n: lo + i,
              label: p.label,
              ...(p.target === undefined ? {} : { target: p.target }),
            }));
          }),
        };
      }
    }
    if (operation === 'privacy') {
      const x = input as unknown as PrivacyInput;
      const miss = x.mode === 'ci-miss';
      const record = x.mode === 'record';
      return {
        cassette: miss ? [] : [x.answer],
        logs: [] as string[],
        plan: { characters: x.source.length },
        labels: miss ? [] : x.answer.labels,
        networkCalls: record ? 1 : 0,
        keyReads: record ? 1 : 0,
        location: '.cache/',
        committed: false,
        status: miss ? 'miss' : 'ok',
      };
    }
    return null;
  },
} satisfies PointerAdapter;

const leakyCopy = {
  execute(request) {
    const out = copying.execute(request);
    if (request.operation === 'privacy') {
      const x = request.input as unknown as PrivacyInput;
      const mid = Math.floor(x.source.length / 2);
      const keyMid = Math.floor(x.apiKey.length / 2);
      (out as { logs: string[] }).logs = [
        x.source.slice(0, mid),
        x.source.slice(mid),
        x.apiKey.slice(0, keyMid),
        x.apiKey.slice(keyMid),
      ];
    }
    return out;
  },
} satisfies PointerAdapter;

export const reviewCheats = { firstUnit, textHash, copying, leakyCopy } satisfies Record<
  string,
  PointerAdapter
>;
