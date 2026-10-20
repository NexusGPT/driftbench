import { FAMILIES } from './specs/index';
import { PROVENANCE_LABELS, provenanceOf } from './specs/provenance';
import type { Need } from './specs/types';
import { LEVELS } from './types';

/**
 * The catalogue of the bank, rendered from the same rows the code zips with its runners. `tools/pointer-catalogue.ts`
 * writes it to `validators/pointer/CATALOGUE.md`; a test fails when the file differs from this text.
 */

const NEEDS: Record<Need, string> = {
  cut: 'cut: the pure cutter, text in, units and digest out',
  scan: 'scan: files + previous ledger + sets + a planted labeller in, ledger, atoms and diagnostics out',
  transport:
    'transport: the Haiku or Jev port over a fake model fetch that answers from the hidden truth and counts calls',
  cassette: 'cassette: record and replay, with the cassette text in and out',
  prompt: 'prompt: the request the port builds',
  links: 'links: classify, clear, verify, coverage, blast radius',
  child: 'child: the run happens in a child process with sandbox HOME, TMPDIR and cwd',
  cli: 'cli: the command line',
  stack: 'stack: the product stack seam (margin and decision) over planted probabilities and votes',
};

export function renderCatalogue(): string {
  let out = '';
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

  const w = (s = '') => {
    out += `${s}\n`;
  };

  const total = FAMILIES.reduce((n, f) => n + f.specs.length, 0);
  const causes = new Set(FAMILIES.flatMap((f) => f.specs.map((s) => s.cause)));

  w('# Pointer validator bank: catalogue');
  w();
  w(
    'The first 402 items were written blind from `docs/estate-pointer-reader.md` (revision 3) and `docs/validators.md` sections 1, 8, 10 and 12; nothing under `packages/estate/src/pointer/`, `estate-pointer.ts` or the reader branches was opened. Later maintainer commits changed some of those items and added others. The section Provenance names which, and the table of every family carries the label of each item. This file is generated: run `pnpm tsx tools/pointer-catalogue.ts` after any change to the bank.',
  );
  w();
  w(
    `Bank: **${total} items**, ${FAMILIES.length} families, ${causes.size} distinct causes, ${LEVELS.length} levels. This file is generated from the same rows the code zips with its runners.`,
  );
  w();
  w('## Counts');
  w();
  w('| Family | Level | Items | T1 | T2 | T3 | T4 | T5 |');
  w('|---|---|---|---|---|---|---|---|');
  const tierTotals = [0, 0, 0, 0, 0];
  for (const f of FAMILIES) {
    const t = [1, 2, 3, 4, 5].map((n) => f.specs.filter((s) => s.tier === n).length);
    t.forEach((c, i) => {
      tierTotals[i] = (tierTotals[i] ?? 0) + c;
    });
    w(`| ${f.id} | ${f.level} | ${f.specs.length} | ${t.join(' | ')} |`);
  }
  w(`| **all** | | **${total}** | ${tierTotals.map((n) => `**${n}**`).join(' | ')} |`);
  w();
  w(
    'Tiers: 1 one construct, canonical input, obvious answer. 2 one construct with a standard variation or one documented rule. 3 two constructs together or an edge of a documented rule. 4 several parts, hostile or combined input, a design decision. 5 scale, fuzz, or a weak spot the design itself names.',
  );
  w();
  w('## Provenance');
  w();
  w(
    '- **blind**: written from the design page alone, unchanged since (the commit that added the first 402 items).',
  );
  w(
    '- **maintainer-repaired**: one of those 402, whose input, expected value or pass condition a later maintainer commit changed. Its blind record no longer holds.',
  );
  w(
    '- **maintainer-added**: added by a maintainer commit after the blind commit (the stack and label-set validation items). Never blind.',
  );
  w();
  w('| Label | Items |');
  w('|---|---|');
  for (const label of PROVENANCE_LABELS)
    w(
      `| ${label} | ${FAMILIES.flatMap((f) => f.specs.map((x) => provenanceOf(`${f.id}.${x.key}`))).filter((x) => x === label).length} |`,
    );
  w();
  w('`driftbench validate pointer --items` prints the score of each label apart.');
  w();
  w('## Levels');
  w();
  w(
    'Ordered by the cost of diagnosing a failure. Each level is a sub-bank with threshold 1.0; the run stops at the first failing level.',
  );
  w();
  w('| # | Level | Families | What |');
  w('|---|---|---|---|');
  LEVELS.forEach((l, i) => {
    const fams = FAMILIES.filter((f) => f.level === l.id)
      .map((f) => f.id)
      .join(', ');
    w(`| ${i + 1} | \`${l.id}\` ${l.name} | ${fams} | ${l.what} |`);
  });
  w();
  w('## How the items run');
  w();
  w(
    "- **Truth by construction.** A seeded composer writes each document from a hidden list of units (container, text, label, UTF-16 span); the oracle is that list, never the reader's own output. Sentences come from a large seeded vocabulary and are rejected unless their pairwise normalised Levenshtein similarity is under 0.25, so re-anchoring items know which units are unrelated.",
  );
  w(
    "- **Exact cut.** The reader's units equal the composer's in order and count; per unit the container class is equal, `source.slice(start,end) === text`, the text equals the composer text in the fingerprint normal form (NFC, white space collapsed, bullet, `>`, pipe and ATX `#` marks stripped), the span lies inside the construct's own lines, and no two spans overlap.",
  );
  w(
    '- **Seeds.** Every generator draws from `rngFor(seed, itemId)`; a hidden seed gives other words, orders and sizes. Items marked seed-free use a fixed seed and run once per process.',
  );
  w(
    '- **Planted labellers** (no model): perfect (answers the hidden truth), heading-keyed, length-keyed, none, random, invalid-then-valid, poisoned (answers one fixed label for anything it is asked). **Fake transports** answer a Haiku or Jev request from the hidden truth, can be scripted to refuse, truncate, add thinking blocks or echo headers, and count calls.',
  );
  w(
    '- **Perfect and breaking stand-ins live in the tests.** The bank tests run every item against a reference reader written from the same text (all items pass) and against planted-bug variants of it (each loses at least one item). No test asserts that the real reader fails.',
  );
  w('- **Item detail** ends with `Fix: <cause>` so `--blind` can strip it.');
  w();
  w('## The seam (what the binding must provide)');
  w();
  w(
    'The items call one port, `PointerSut`; a single adapter file maps the real reader onto it. The binding is `sut/reader.ts`. Where the reader is missing, or lacks a capability (layer C, the stack), the affected items fail with a message that says so. Capabilities (the `needs` column):',
  );
  w();
  for (const n of Object.keys(NEEDS) as Need[]) w(`- ${NEEDS[n]}`);
  w();
  w(
    'Result shapes the items read: a unit is `{container, start, end, text, fp, path, yamlPath?, opaque}`; a ledger entry is the section 4 entry (`id path sectionPath container fp ctxFp quote prefix suffix hint status labels lineage twinOf`) plus the ledger text for byte comparisons; an atom is `{kind, polarity?, file, startLine, endLine, quote, producedBy, approved, fields{extraction,unit,labelSet,cassette}, evidence[]}`; a diagnostic is `{code, unit?, window?, detail}` with codes `label_flip` and `unlabeled` from the design; a link is `{span, fp, relation, createdBy, accepted}` plus its owner test.',
  );
  w();
  w('## Budgets (scale family)');
  w();
  w(
    'Chosen by the bank, not by the design: 1x is 300 units, 10x 3,000, 100x 30,000 (about 3 MB). Times are wall clock of the reader work inside a child process after the input is written; each item states its own cap. Memory is peak resident set. The growth items require time(100x) <= 40 x time(10x) once time(10x) exceeds 0.3 s (n to the power 1.6). The caps are generous: a linear or n log n reader finishes in a small fraction, a quadratic one at 100x does not.',
  );
  w();
  w('## Notes on the specification (assumptions and gaps)');
  w();
  const notes = [
    'The two-class stack is tested through the labels family on the seam `stack.margin` and `stack.decide` (probabilities and votes in, a label out); the reader exposes neither at commit 5ad1e263a, so those items fail until it does. The labels and replay families keep the yes or no form of the system 1 labeller of design revision 3, which revision 4 keeps as a class.',
    'Some items need what the reader does not expose at commit 5ad1e263a: per-id events `split`, `merged` and `ambiguous` (five re-anchoring items), and `lineage` or `twinOf` on a ledger entry (three ids items). The binding returns counts and derived events only; those items fail until the reader exposes them.',
    'Every scan item checks that the scan holds the units the composer planted and that the reader cuts a fixed control file (a three-sentence paragraph and a two-item list); a reader that cuts one unit per file or per line, returns nothing or refuses everything passes no item but the empty-input stack item. Tests keep four such cheating readers at that bar.',
    'Section 8 writes `estate scan --replay <cassette>`; section 14 (what is built) writes `--cassette <file> [--record]`. The bank follows section 14.',
    'Section 8 says no item may depend on a cassette it produced. Replay items compare a recording with its own replay, two recordings, or a perturbed copy; the `fixture-` items replay the committed fixture cassettes as data and change one field of one entry, and nothing is recorded in item setup.',
    'The design shows only the container names `heading`, `sentence`, `list_item`. `table_cell`, `block_quote`, `front_matter`, `fence`, `comment` are assumed and mapped by the binding.',
    'Section 2 does not say whether a list item span includes its bullet or a table cell span its padding. Oracles compare the fingerprint normal form and require the span to lie inside the construct.',
    'Section 4 says "one id per unit that is labelled or linked". The bank reads it as: every unit of a labelled window has an entry, `none` included, because a unit a re-record stops selecting must stay tracked (`label_flip`, never a false `deleted`).',
    'Re-anchoring outcomes use the seven words of section 4 (unchanged, moved, ambiguous, changed, split, merged, deleted) read from the last lineage event. The event of an inserted unit is not asserted.',
    'A gate quote is checked as verbatim source text that starts with the first unit and ends with the second unit; section 6 says both "from its first to its second unit" and "the text of both units in file order".',
    'Layer C (links, blast radius, coverage, verification) is "not built" in section 14; its items stay in the bank and fail until it is built. Link states follow section 7 only.',
    'The context fingerprint is assumed to cover the neighbours (section 4 prefix and suffix). Items are silent on whether the heading path is inside it.',
    'Window size (100,000 tokens) is checked only with files far from the bound (30,000 characters against 900,000).',
    'The design leaves open: a gate across files (section 12), the text format of a YAML path, the container of markdown inside an HTML block. No item asserts them beyond what the rows say.',
    'The rows use the thresholds of section 4 (0.45 score, 0.4 text floor) only through clear cases: related texts at 0.85 similarity and above, unrelated texts under 0.25. Tuning the thresholds inside that gap cannot fail an item except the two that name 0.7 (reword-moderate) and the monotone sweep.',
  ];
  for (const [i, n] of notes.entries()) w(`${i + 1}. ${n}`);
  w();
  for (const f of FAMILIES) {
    w(`## ${f.id}`);
    w();
    w(
      `Level \`${f.level}\`, default component \`${f.component}\`, default needs ${f.needs.join(', ')}. ${f.summary}`,
    );
    w();
    w('| id | provenance | tier | generator | oracle | cause | component | needs |');
    w('|---|---|---|---|---|---|---|---|');
    for (const s of f.specs) {
      const needs = (s.needs ?? f.needs).join(',');
      const comp = s.component ?? f.component;
      const seedFree = s.seedFree ? ' (seed-free)' : '';
      w(
        `| \`${f.id}.${s.key}\` | ${provenanceOf(`${f.id}.${s.key}`)} | ${s.tier} | ${cell(s.gen)}${seedFree} | ${cell(s.oracle)} | \`${s.cause}\` | ${comp} | ${needs} |`,
      );
    }
    w();
  }

  return out;
}
