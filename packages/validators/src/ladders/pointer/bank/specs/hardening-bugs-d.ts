import { HARDENING_CAP_MS } from './hardening';
import { row, type Spec } from './types';

/**
 * Items added after the round 3 audit, seat 4 (planted bugs in the reader's stack, user labeler, cassette
 * and key code that lost no item). Each oracle is what the unmutated reader does on a case the planted bug
 * changes; each item passes on the reference reader and fails on it with that bug planted
 * (test/pointer/cr2-bugs-bugsD.test.ts). They join the family named by their key, after the audit items.
 */

const cap = { capMs: HARDENING_CAP_MS } as const;
const stack: Pick<Spec, 'capMs' | 'component' | 'needs'> = {
  ...cap,
  component: 'stack',
  needs: ['scan', 'transport'],
};

export const HARDENING_D_SPECS: Record<string, Spec[]> = {
  labels: [
    row(
      'stack-margin-at-cut-decides-by-system1',
      2,
      'A stack unit whose system 1 margin equals the cut takes the system 1 label',
      'A stack of the `jev` arm and the `haiku` arm on a fake transport, with a cut drawn from the seed; units whose vector leads by exactly the cut (two options summing to 1, sums exact in binary), units under and above it; system 2 always gives another label.',
      'A unit at the cut, and one above it, holds its system 1 top label; a unit under the cut holds the label of system 2.',
      'stack:margin-at-cut-decides-by-system1',
      stack,
    ),
    row(
      'stack-system2-none-keeps-sure-system1',
      2,
      'A none from system 2 does not override a sure system 1 label',
      'A stack of the `jev` and `haiku` arms; units above the cut that system 2 calls none, units above the cut that system 2 gives another label, and units under the cut that system 2 calls none.',
      'A unit above the cut holds its system 1 top label, whatever system 2 said; a unit under the cut that system 2 calls none holds none.',
      'stack:system2-none-keeps-sure-system1',
      stack,
    ),
    row(
      'stack-fallback-counts-sure-system1-alone',
      3,
      'A sure system 1 unit with no system 2 opinion counts as a fallback',
      'A stack of the `jev` and `haiku` arms where every `haiku` request is refused with HTTP 400; a seeded number of units above the cut and of units under it.',
      'The scan reports `fellBack` equal to the units above the cut; those hold their system 1 top label, the units under the cut hold no label.',
      'stack:fallback-counts-sure-system1-alone',
      stack,
    ),
    row(
      'stack-system1-missing-system2-decides',
      3,
      'When system 1 gives no opinion, system 2 decides every unit alone',
      'A stack of the `jev` and `haiku` arms where every `jev` request is refused with HTTP 400; system 2 gives each unit a seeded label of the set or none.',
      'Every unit holds the label system 2 gave it, and the scan reports `fellBack` equal to the number of units.',
      'stack:system1-missing-system2-decides',
      stack,
    ),
    row(
      'labeler-runs-change-relabels',
      3,
      'A change of the runs of a labeller re-labels units it had labelled',
      'Scan seeded units with a planted labeller asked once; rescan with the previous ledger and a labeller that answers other labels, first asked once (control), then asked 2 or 3 times (drawn from the seed).',
      'The control rescan asks the labeller nothing and keeps every label; the rescan with other runs asks it and every unit holds its new label.',
      'stack:labeler-hash-holds-runs',
      { ...cap, component: 'stack', needs: ['scan'] },
    ),
    row(
      'labeler-settings-change-relabels',
      3,
      'A change of the threshold of a yes or no labeler re-labels units it had labelled',
      'Record seeded units on the `openai-decisions` arm at threshold 0.4, some with a label probability between 0.4 and 0.8; rescan with the previous ledger and a fresh cassette at 0.4 (control), then at 0.8.',
      'The control rescan sends no request and keeps every label; the rescan at 0.8 sends requests and the units under 0.8 hold none.',
      'stack:labeler-hash-holds-settings',
      { ...cap, component: 'stack', needs: ['scan', 'transport'] },
    ),
    row(
      'http-labeler-address-change-relabels',
      3,
      'An HTTP user labeler at another address re-labels units the first one labelled',
      'Record seeded units on the `http` arm at a seeded address; rescan with the previous ledger at the same address (control), then at a second seeded path on the same host (the model of the labeler names the host only) whose answers differ.',
      'The control rescan sends nothing; the rescan at the second address sends its requests there and every unit holds the label it gave.',
      'user-labeler:http-id-from-address',
      { ...cap, component: 'user-labeler', needs: ['scan', 'transport'] },
    ),
  ],
  replay: [
    row(
      'too-large-halves-larger-first',
      3,
      'A window refused as too large is halved with its larger half first',
      'An odd number of seeded units (7 to 13) in one `jev` window; the fake endpoint refuses the request that holds them all with HTTP 400 `max_tokens_exceeded`.',
      'Three requests: all the units, then the first ceil(n/2) units in order, then the rest; every unit is labelled.',
      'scan:too-large-halves-larger-first',
      { ...cap, component: 'scan', needs: ['transport'] },
    ),
    row(
      'miss-nearest-same-labeler',
      3,
      'A miss never names an entry of another labeller as the nearest',
      'An authored `jev` fixture and an authored `haiku` fixture of the same seeded files; replay the `jev` arm on the `haiku` cassette (and, as a control, on its own cassette with a seeded label description changed).',
      'The control miss lists the set hash among the fields that differ; the miss on the other cassette lists no `labeler` among them, and neither calls the transport.',
      'cassette:miss-nearest-same-labeler',
      { ...cap, needs: ['transport', 'cassette'] },
    ),
    row(
      'miss-names-least-different-entry',
      4,
      'A miss names the entry that differs least, never one of another run',
      'An authored `haiku` fixture of seeded files (three runs per window); replay it with a seeded word added to one label description.',
      'The replay fails without a call; the fields named are those of the entry of the same run (the set hash among them), never `run`.',
      'cassette:miss-nearest-fewest-differences',
      { ...cap, needs: ['transport', 'cassette'] },
    ),
  ],
  privacy: [
    row(
      'key-getter-not-read-when-nothing-sent',
      2,
      'A key held behind a getter is not read by a recording scan that sends nothing',
      'An authored `haiku` fixture of seeded files; a recording scan on the full cassette, with the key behind a getter that counts reads; then a recording scan whose cassette lacks one file (control).',
      'The first scan sends nothing and reads the key zero times; the control sends a request and reads the key.',
      'stack:key-getter-read-at-request',
      { ...cap, component: 'stack', needs: ['scan', 'transport', 'cassette'] },
    ),
  ],
};
