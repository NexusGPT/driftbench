# Pointer validator bank: catalogue

Written blind from `docs/estate-pointer-reader.md` revision 3 (c57cf0ea0), the default stack specification (`STACK-SPEC.md` of the Jev experiments) and `docs/validators.md` sections 1, 8, 10 and 12. Nothing under `packages/estate/src/pointer/`, `estate-pointer.ts` or the reader branches was opened. This file is generated: run `pnpm tsx tools/pointer-catalogue.ts` after any change to the bank.

Bank: **437 items**, 12 families, 288 distinct causes, 10 levels. This file is generated from the same rows the code zips with its runners.

## Counts

| Family | Level | Items | T1 | T2 | T3 | T4 | T5 |
|---|---|---|---|---|---|---|---|
| cutting | cut | 66 | 9 | 27 | 25 | 4 | 1 |
| ids | ids | 41 | 11 | 20 | 9 | 1 | 0 |
| re-anchoring | anchor | 53 | 5 | 12 | 22 | 10 | 4 |
| grouping | labels | 24 | 5 | 12 | 6 | 1 | 0 |
| labels | labels | 53 | 4 | 20 | 28 | 1 | 0 |
| stack | stack | 35 | 5 | 11 | 14 | 4 | 1 |
| replay | replay | 42 | 3 | 8 | 22 | 9 | 0 |
| privacy | privacy | 21 | 2 | 8 | 10 | 1 | 0 |
| links | links | 25 | 3 | 7 | 13 | 2 | 0 |
| radius | links | 23 | 4 | 6 | 9 | 3 | 1 |
| scale | scale | 24 | 1 | 1 | 5 | 13 | 4 |
| adversarial | adversarial | 30 | 0 | 3 | 15 | 8 | 4 |
| **all** | | **437** | **52** | **135** | **178** | **57** | **15** |

Tiers: 1 one construct, canonical input, obvious answer. 2 one construct with a standard variation or one documented rule. 3 two constructs together or an edge of a documented rule. 4 several parts, hostile or combined input, a design decision. 5 scale, fuzz, or a weak spot the design itself names.

## Levels

Ordered by the cost of diagnosing a failure. Each level is a sub-bank with threshold 1.0; the run stops at the first failing level.

| # | Level | Families | What |
|---|---|---|---|
| 1 | `cut` cutting | cutting | layer A turns files into units |
| 2 | `ids` ids and ledger | ids | fingerprints, ids, the canonical sidecar |
| 3 | `anchor` re-anchoring | re-anchoring | old units find their new selves |
| 4 | `labels` labels and atoms | grouping, labels | windows, answers, carry-forward, ports, atoms |
| 5 | `stack` the two-class stack | stack | margin cut, system 2 votes, the person, pluggable labellers |
| 6 | `replay` cassette and replay | replay | determinism lives in the cassette |
| 7 | `links` links and blast radius | links, radius | layer C |
| 8 | `privacy` private estates | privacy | a secret stays in its folder |
| 9 | `scale` scale | scale | 10 and 100 times the size, time and memory |
| 10 | `adversarial` adversarial | adversarial | decoys, hostile inputs, ladder traps |

## How the items run

- **Truth by construction.** A seeded composer writes each document from a hidden list of units (container, text, label, UTF-16 span); the oracle is that list, never the reader's own output. Sentences come from a large seeded vocabulary and are rejected unless their pairwise normalised Levenshtein similarity is under 0.25, so re-anchoring items know which units are unrelated.
- **Exact cut.** The reader's units equal the composer's in order and count; per unit the container class is equal, `source.slice(start,end) === text`, the text equals the composer text in the fingerprint normal form (NFC, white space collapsed, bullet, `>`, pipe and ATX `#` marks stripped), the span lies inside the construct's own lines, and no two spans overlap.
- **Seeds.** Every generator draws from `rngFor(seed, itemId)`; a hidden seed gives other words, orders and sizes. Items marked seed-free use a fixed seed and run once per process.
- **Planted labellers** (no model): perfect (answers the hidden truth), heading-keyed, length-keyed, none, random, invalid-then-valid, poisoned (answers one fixed label for anything it is asked). **Fake transports** answer a Haiku or Jev request from the hidden truth, can be scripted to refuse, truncate, add thinking blocks or echo headers, and count calls.
- **Perfect and breaking stand-ins live in the tests.** The bank tests run every item against a reference reader written from the same text (all items pass) and against planted-bug variants of it (each loses at least one item). No test asserts that the real reader fails.
- **Item detail** ends with `Fix: <cause>` so `--blind` can strip it.

## The seam (what the binding must provide)

The items call one port, `PointerSut`; a single adapter file maps the real reader onto it. The binding is `sut/reader.ts`. Where the reader is missing, or lacks a capability (layer C, the stack), the affected items fail with a message that says so. Capabilities (the `needs` column):

- cut: the pure cutter, text in, units and digest out
- scan: files + previous ledger + sets + a planted labeller in, ledger, atoms and diagnostics out
- transport: the Haiku or Jev port over a fake model fetch that answers from the hidden truth and counts calls
- cassette: record and replay, with the cassette text in and out
- prompt: the request the port builds
- links: classify, clear, verify, coverage, blast radius
- child: the run happens in a child process with sandbox HOME, TMPDIR and cwd
- cli: the command line
- stack: the two-class stack over planted system 1 and system 2 labellers, answers only from the plan

Result shapes the items read: a unit is `{container, start, end, text, fp, path, yamlPath?, opaque}`; a ledger entry is the section 4 entry (`id path sectionPath container fp ctxFp quote prefix suffix hint status labels lineage twinOf`) plus the ledger text for byte comparisons; an atom is `{kind, polarity?, file, startLine, endLine, quote, producedBy, approved, fields{extraction,unit,labelSet,cassette}, evidence[]}`; a diagnostic is `{code, unit?, window?, detail}` with codes `label_flip` and `unlabeled` from the design; a link is `{span, fp, relation, createdBy, accepted}` plus its owner test.

## Budgets (scale family)

Chosen by the bank, not by the design: 1x is 300 units, 10x 3,000, 100x 30,000 (about 3 MB). Times are wall clock of the reader work inside a child process after the input is written; each item states its own cap. Memory is peak resident set. The growth items require time(100x) <= 40 x time(10x) once time(10x) exceeds 0.3 s (n to the power 1.6). The caps are generous: a linear or n log n reader finishes in a small fraction, a quadratic one at 100x does not.

## Notes on the specification (assumptions and gaps)

1. Revision 3 defines no stack of a system-1 and a system-2 labeller. The stack family follows the default stack specification (margin, cut or share, three system 2 runs, accept rule, the person, failure handling, pluggable labellers) and runs on planted answers through a `StackApi` port; the reader has none yet, so those items fail with "the stack is not reachable". The raw Jev and Haiku ports are tested in the labels family as revision 3 gives them (thresholds 0.4 window, 0.7 unit).
2. Design revision 4 (labelers by class) is followed by the stack family. The labels and replay families keep the yes or no form of the system 1 labeller (question keys `u<n>__<label>`, thresholds 0.4 and 0.7), which revision 4 keeps as a shipped class. Not yet items: the choice-question system 1 client (a window of 30, probabilities that must sum to 1 within 0.01), three runs of system 2 with a unit labelled only when all agree, and the run, model and class fields of the cassette key.
3. Some items need what the reader does not expose at commit 5ad1e263a: per-id events `split`, `merged` and `ambiguous` (five re-anchoring items), and `lineage` or `twinOf` on a ledger entry (three ids items). The binding returns counts and derived events only; those items fail until the reader exposes them.
4. Every scan item checks that the scan holds the units the composer planted and that the reader cuts a fixed control file (a three-sentence paragraph and a two-item list); a reader that cuts one unit per file or per line, returns nothing or refuses everything passes no item but the empty-input stack item. Tests keep four such cheating readers at that bar.
5. Section 8 writes `estate scan --replay <cassette>`; section 14 (what is built) writes `--cassette <file> [--record]`. The bank follows section 14.
6. Section 8 says no item may depend on a cassette it produced. Replay items compare a recording with its own replay, two recordings, or a perturbed copy; the `fixture-` items replay the committed fixture cassettes as data and change one field of one entry, and nothing is recorded in item setup.
7. The design shows only the container names `heading`, `sentence`, `list_item`. `table_cell`, `block_quote`, `front_matter`, `fence`, `comment` are assumed and mapped by the binding.
8. Section 2 does not say whether a list item span includes its bullet or a table cell span its padding. Oracles compare the fingerprint normal form and require the span to lie inside the construct.
9. Section 4 says "one id per unit that is labelled or linked". The bank reads it as: every unit of a labelled window has an entry, `none` included, because a unit a re-record stops selecting must stay tracked (`label_flip`, never a false `deleted`).
10. Re-anchoring outcomes use the seven words of section 4 (unchanged, moved, ambiguous, changed, split, merged, deleted) read from the last lineage event. The event of an inserted unit is not asserted.
11. A gate quote is checked as verbatim source text that starts with the first unit and ends with the second unit; section 6 says both "from its first to its second unit" and "the text of both units in file order".
12. Layer C (links, blast radius, coverage, verification) is "not built" in section 14; its items stay in the bank and fail until it is built. Link states follow section 7 only.
13. The context fingerprint is assumed to cover the neighbours (section 4 prefix and suffix). Items are silent on whether the heading path is inside it.
14. Window size (100,000 tokens) is checked only with files far from the bound (30,000 characters against 900,000).
15. The design leaves open: a gate across files (section 12), the text format of a YAML path, the container of markdown inside an HTML block. No item asserts them beyond what the rows say.
16. The rows use the thresholds of section 4 (0.45 score, 0.4 text floor) only through clear cases: related texts at 0.85 similarity and above, unrelated texts under 0.25. Tuning the thresholds inside that gap cannot fail an item except the two that name 0.7 (reword-moderate) and the monotone sweep.

## cutting

Level `cut`, default component `cutter`, default needs cut. The cutter turns a file into units: sentences, items, cells, quote paragraphs, headings, front matter values and opaque blocks, with UTF-16 spans that slice the original file.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `cutting.heading-atx` | 1 | Six headings `#` to `######`, each followed by one seeded sentence. | Exact cut: 12 units in order (heading, sentence, ...); each sentence has the one heading above it as its path. | `cutter:atx-heading-unit` | cutter | cut |
| `cutting.heading-setext` | 2 | `Title` over `=====` and `Sub` over `-----`, with a sentence under each. | Exact cut: two heading units (underline lines left out of the normalised text); the sentences carry the setext heading as their path. | `cutter:setext-heading-unit` | cutter | cut |
| `cutting.heading-closing-hashes` | 2 | `## Keys ##` and `# Doors #` with a sentence under each. | Heading texts are `Keys` and `Doors` once the marks are stripped; the path of the sentences below is `[Keys]` and `[Doors]`. | `cutter:atx-closing-sequence` | cutter | cut |
| `cutting.heading-path-nesting` | 2 | Outline `#` A, `##` B, sentence, `##` C, sentence, `#` D, sentence. | Paths are `[A,B]`, `[A,C]`, `[D]`: a sibling replaces its sibling, a higher level resets the stack; a heading unit holds its ancestors only (`[]`, `[A]`, `[A]`, `[]`). | `cutter:heading-path-stack` | cutter | cut |
| `cutting.heading-path-skipped-level` | 3 | `#` A, `###` C, sentence, `##` B, sentence. | Path under C is `[A,C]`, under B is `[A,B]`; no path holds an empty string. | `cutter:heading-path-skipped-level` | cutter | cut |
| `cutting.sentences-split-terminators` | 1 | One paragraph of five seeded sentences ending `.` `?` `!` `.` `.`, one space between. | Exact cut: five sentence units that keep their terminators. | `cutter:sentence-split` | cutter | cut |
| `cutting.design-example-shelf-audit` | 2 | The `shelf-audit` SKILL.md text of design section 2, byte for byte. | Seven units in order: heading, sentence `**Keys.**` (the closing marks stay with their sentence), sentence, sentence, list item, list item, sentence; containers `heading`, `sentence`, `list_item`; heading path `[]` for unit 1 and `["Shelf audit"]` for units 2 to 7; unit 7 holds its inline code whole. | `cutter:design-example-units` | cutter | cut |
| `cutting.sentences-hard-wrapped` | 2 | Paragraph of 6 sentences hard-wrapped at 40 columns, so line ends fall inside sentences. | Exact cut: one unit per sentence; a wrapped unit keeps its newline in the raw text. | `cutter:wrapped-sentence` | cutter | cut |
| `cutting.sentences-mask-inline-code` | 3 | `Run `cfg.get(a. B)` first. Then stop.` with seeded names: the code span holds a full stop and a capital. | Two units; the first holds the code span whole. | `cutter:mask-inline-code` | cutter | cut |
| `cutting.sentences-mask-url` | 3 | `Open https://shop.example/a.b/menu. Then order.`: the URL is followed by the full stop that ends the sentence. | Two units; the URL is whole in the first and the full stop after it ends that unit. | `cutter:mask-url` | cutter | cut |
| `cutting.sentences-mask-link-destination` | 3 | `Read [the guide](docs/guide.v2.md). Then close it.` and `Read [the guide](<docs/the guide. Draft.md>) now. Then close it.` | Two units in each document; the destination is whole in the first unit. | `cutter:mask-link-destination` | cutter | cut |
| `cutting.sentences-lowercase-start-merges` | 2 | `We bake rye daily. iOS bakers prefer wheat.` | One unit holding both (design 10a result 5: the shape rule merges when unsure). | `cutter:merge-lowercase-start` | cutter | cut |
| `cutting.sentences-decimal` | 2 | `Version 2.5 ships today. Update now.` | Two units. | `cutter:decimal-not-boundary` | cutter | cut |
| `cutting.sentences-short-title` | 3 | `Dr. Ito counts the till. Mr. Lowe locks up.` | Two units (design 10a result 5: only four-letter titles stay wrong). | `cutter:short-title-merge` | cutter | cut |
| `cutting.sentences-cjk-terminator` | 3 | Two Japanese sentences ending `。`, no space between them. | Two units; spans in UTF-16 code units. | `cutter:cjk-terminator` | cutter | cut |
| `cutting.sentences-eof-no-newline` | 1 | A document whose text ends right after its last sentence. | Exact cut; the last end offset equals the text length. | `cutter:eof-without-newline` | cutter | cut |
| `cutting.sentences-hard-line-break` | 3 | Sentences with a two-space break and a backslash break in the middle. | Exact cut: one unit per sentence. | `cutter:wrapped-sentence` | cutter | cut |
| `cutting.sentences-emphasis-raw` | 2 | `Always **name the noun** first. Never *skip* it.` | Two units whose raw text is the source slice and holds `**` and `*`. | `cutter:raw-slice-text` | cutter | cut |
| `cutting.sentences-entities-escapes-raw` | 3 | `Use &amp; and &lt;b&gt; here. Keep a \* star.` | Two units whose raw text holds `&amp;`, `&lt;b&gt;` and `\*` unchanged (a node value would decode them). | `cutter:raw-slice-text` | cutter | cut |
| `cutting.lists-bullets` | 1 | A list of five seeded items with `-`. | Exact cut: five `list_item` units. | `cutter:list-item-unit` | cutter | cut |
| `cutting.lists-marker-kinds` | 1 | Four lists using `-`, `*`, `+`, `1.`, plus one using `1)`. | Exact cut: one `list_item` per item; the marker does not change the normalised text. | `cutter:list-item-unit` | cutter | cut |
| `cutting.lists-nested` | 2 | Three levels, two items per level. | One unit per item in file order; a parent span ends before its first child; no overlap. | `cutter:nested-list-item-span` | cutter | cut |
| `cutting.lists-wrapped-item` | 2 | Items whose text continues on lazy and indented lines. | One unit per item; the raw text holds the line ends. | `cutter:wrapped-list-item` | cutter | cut |
| `cutting.lists-item-with-two-sentences` | 2 | Items of the form `A. B.` | One unit per item; the item is never cut into sentences. | `cutter:list-item-not-sentence-split` | cutter | cut |
| `cutting.lists-loose` | 3 | A loose list of four items. | Exact cut: four units. | `cutter:loose-list-items` | cutter | cut |
| `cutting.lists-after-paragraph-no-blank` | 3 | `Intro sentence:` then `- a` and `- b` on the next lines. | A sentence unit, then two `list_item` units. | `cutter:list-interrupts-paragraph` | cutter | cut |
| `cutting.lists-tab-indented-nested` | 3 | Children indented with one tab. | Parent and children are separate units in order. | `cutter:tab-indented-nested-item` | cutter | cut |
| `cutting.tables-cells` | 2 | Three columns, a header row and three rows, with alignment colons in the delimiter row. | 12 `table_cell` units in row-major order; no span holds a pipe; the delimiter row gives no unit; every cell of one table has the same heading path. | `cutter:table-cell-unit` | cutter | cut |
| `cutting.tables-escaped-pipe` | 3 | A cell `a \\| b`. | That cell is one unit holding `a \\| b`. | `cutter:table-escaped-pipe` | cutter | cut |
| `cutting.tables-cell-two-sentences` | 2 | A cell `Do this. Then that.` | One unit for the cell. | `cutter:table-cell-not-sentence-split` | cutter | cut |
| `cutting.tables-empty-cell` | 3 | A row with an empty middle cell. | No unit has length 0; the other cells are present. | `cutter:table-empty-cell-no-unit` | cutter | cut |
| `cutting.quotes-single` | 1 | `> ` and one seeded sentence. | One `block_quote` unit; its start is after `> `. | `cutter:block-quote-unit` | cutter | cut |
| `cutting.quotes-two-paragraphs` | 2 | `> p1 s1. s2.`, `>`, `> p2.` | Two units; the first stays whole though it holds two sentences. | `cutter:block-quote-paragraph-unit` | cutter | cut |
| `cutting.quotes-wrapped-paragraph` | 2 | `> line one` and `> line two`. | One unit; raw text holds the inner `> `; fingerprint-normal text equals the paragraph. | `cutter:block-quote-span-after-marker` | cutter | cut |
| `cutting.quotes-nested` | 3 | `> outer`, `>`, `> > inner`. | Units outer and inner; the inner start is after the second marker. | `cutter:nested-block-quote` | cutter | cut |
| `cutting.frontmatter-string-values` | 2 | `---` `name:` `description:` `---` and a body paragraph. | Two `front_matter` units before the body units; no unit holds a key name. | `cutter:front-matter-string-unit` | cutter | cut |
| `cutting.frontmatter-non-strings` | 2 | Front matter with `count: 3`, `ok: true`, `none: null` and one string. | Exactly one front matter unit. | `cutter:front-matter-non-string` | cutter | cut |
| `cutting.frontmatter-key-path` | 3 | `description:` and `metadata:` over `owner:`; two keys holding the same string. | Top-level path is `description`; the nested path starts `metadata` and ends `owner`; the two equal values have two different paths. | `cutter:front-matter-yaml-path` | cutter | cut |
| `cutting.frontmatter-array-strings` | 3 | `tags:` over `- rye` and `- spelt`. | Two units with distinct paths. | `cutter:front-matter-array-string` | cutter | cut |
| `cutting.frontmatter-quoted-scalars` | 3 | A double-quoted and a single-quoted description. | Normalised text equals the value without the quote marks. | `cutter:front-matter-quoted-string` | cutter | cut |
| `cutting.frontmatter-block-scalar` | 4 | `description: >` over three indented lines. | One unit whose normalised text is the three lines joined by spaces. | `cutter:front-matter-block-scalar` | cutter | cut |
| `cutting.frontmatter-only-at-start` | 3 | A paragraph first, then `---`, `name: x`, `---`. | No `front_matter` unit; the lines are prose units. | `cutter:front-matter-only-at-file-start` | cutter | cut |
| `cutting.frontmatter-only-file` | 2 | `---`, one key, `---`. | Exactly one unit. | `cutter:front-matter-string-unit` | cutter | cut |
| `cutting.fence-backticks` | 1 | A fence holding a heading, a list and two sentences. | One `fence` unit from the opening to the closing line; no unit inside; the surrounding paragraphs are cut as usual. | `cutter:fence-opaque-unit` | cutter | cut |
| `cutting.fence-tilde-and-info` | 2 | `~~~yaml` over three lines of YAML-looking prose. | One opaque unit. | `cutter:fence-opaque-unit` | cutter | cut |
| `cutting.fence-longer-delimiter` | 3 | Four backticks around a three-backtick block. | One opaque unit for the whole. | `cutter:fence-opaque-unit` | cutter | cut |
| `cutting.fence-unclosed` | 3 | An opening fence, then sentences, no closing fence. | One opaque unit to the end of the text. | `cutter:fence-unclosed-to-eof` | cutter | cut |
| `cutting.comment-html-multiline` | 2 | `<!--`, `Never do this.`, `-->` between two paragraphs. | One `comment` unit; no sentence unit from its text. | `cutter:html-comment-opaque` | cutter | cut |
| `cutting.html-tag-wrapped-list` | 3 | `<rules>`, two bullets, `</rules>`. | Two `list_item` units; no unit holds a tag line. | `cutter:html-block-inner-markdown` | cutter | cut |
| `cutting.html-tag-wrapped-sentences` | 3 | `<role>`, two sentences, `</role>`. | Two sentence units with spans inside the tag lines. | `cutter:html-block-inner-markdown` | cutter | cut |
| `cutting.html-nested-depth` | 4 | Five nested tags around the text `Inner text.` | The cut returns inside 2 s; `Inner text.` is inside exactly one unit (design 10a: nested HTML at depth 2 is opaque). | `cutter:html-nested-depth-limit` | cutter | cut |
| `cutting.html-inline-tags-in-sentence` | 2 | `Use <b>bold</b> words. Done.` | Two units; the first holds the tags. | `cutter:inline-html-in-sentence` | cutter | cut |
| `cutting.offsets-bom` | 2 | A document that starts with U+FEFF. | Every start is at least 1; spans slice the string that holds the mark; no unit text holds U+FEFF. | `cutter:bom-base-offset` | cutter | cut |
| `cutting.offsets-astral` | 2 | Emoji and rare CJK characters (surrogate pairs) before and inside the sentences. | Exact cut with the composer offsets, which count 2 units per pair. | `cutter:utf16-offsets` | cutter | cut |
| `cutting.offsets-nfd-raw` | 3 | Sentences written in NFD (`e` + U+0301). | Raw text equals the NFD slice; the fingerprint equals that of the same document in NFC. | `cutter:raw-slice-text` | cutter | cut |
| `cutting.offsets-crlf` | 2 | A mixed document with CRLF line ends. | Same unit count and normalised texts as the LF document; spans slice the CRLF text; no unit starts or ends with a carriage return. | `cutter:crlf-offsets` | cutter | cut |
| `cutting.empty-and-blank-files` | 1 | Texts `` , `\n\n` and `   \n`. | Zero units and a digest string for each. | `cutter:empty-file` | cutter | cut |
| `cutting.coverage-every-prose-character` | 4 | A seeded document of 40 blocks using every construct. | The composer's structure ranges (marks, fences, tag lines, delimiter rows) plus the unit spans cover the text; no prose character is outside a span; no overlap. | `cutter:every-prose-character-in-one-unit` | cutter | cut |
| `cutting.mixed-small` | 3 | Seeded document of 12 blocks, every construct. | Exact cut. | `cutter:mixed-document-cut` | cutter | cut |
| `cutting.mixed-medium` | 4 | Seeded document of 80 blocks, every construct, nested lists, tables and quotes. | Exact cut. | `cutter:mixed-document-nested` | cutter | cut |
| `cutting.mixed-large` | 5 | Seeded document of 400 blocks, 60 KB. | Exact cut inside 3 s. | `cutter:mixed-document-large` | cutter | cut |
| `cutting.digest-same-text` | 1 | Cut one document twice. | Equal non-empty digest strings. | `cutter:cut-digest` | cutter | cut |
| `cutting.digest-edit` | 2 | Change one word of one unit. | The digests differ. | `cutter:cut-digest` | cutter | cut |
| `cutting.digest-reorder` | 2 | Swap two paragraphs. | The digests differ (the digest hashes the ordered list). | `cutter:cut-digest-ordered` | cutter | cut |
| `cutting.digest-cosmetic` | 3 | Rewrap, CRLF and bullet swap on one document. | The digests are equal. | `cutter:cut-digest-cosmetic-stable` | cutter | cut |
| `cutting.cut-pure` | 2 | Cut A, cut B, cut A again. | Both cuts of A deep-equal. | `cutter:no-state-between-files` | cutter | cut |

## ids

Level `ids`, default component `ids`, default needs scan. Fingerprints decide what is the same text; ids are derived once and kept; the ledger is canonical, timestamp-free JSON that independent clones reproduce byte for byte.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `ids.fp-whitespace` | 1 | The same 20 units written plain and with tabs, double spaces, extra newlines and trailing spaces; both scanned fresh. | For each unit, `fp` is equal across the variants and the ids are equal. | `fingerprint:collapse-whitespace` | fingerprint | scan |
| `ids.fp-bullet-marker` | 1 | One list written with `-`, then `*`, then `+`. | `fp` equal per item across the three variants. | `fingerprint:strip-bullet-marker` | fingerprint | scan |
| `ids.fp-ordered-marker` | 2 | An ordered list numbered 1 to 5, then 7 to 11, then with `)` marks. | `fp` equal per item across the variants. | `fingerprint:strip-ordered-marker` | fingerprint | scan |
| `ids.fp-quote-marker` | 2 | A quoted paragraph wrapped at 30 and at 70 columns. | `fp` equal for the paragraph in both variants. | `fingerprint:strip-quote-marker` | fingerprint | scan |
| `ids.fp-pipe-padding` | 2 | One table written compact and padded to align its columns. | `fp` equal per cell across the variants. | `fingerprint:strip-pipe-padding` | fingerprint | scan |
| `ids.fp-crlf` | 1 | The same document with LF and with CRLF. | `fp` equal for every unit. | `fingerprint:collapse-whitespace` | fingerprint | scan |
| `ids.fp-nfc` | 2 | Sentences with accents written in NFC and in NFD. | `fp` equal per sentence. | `fingerprint:nfc` | fingerprint | scan |
| `ids.fp-no-nfkc` | 2 | `ﬁnd` against `find`, full-width `Ａ` against `A`, `①` against `1` inside otherwise equal sentences. | All three pairs have different `fp` (design: no NFKC). | `fingerprint:no-nfkc` | fingerprint | scan |
| `ids.fp-case` | 1 | The same sentence as `Never`, `never` and `NEVER`. | Three different `fp`. | `fingerprint:keep-case` | fingerprint | scan |
| `ids.fp-emphasis` | 1 | `Always **name** it`, `Always *name* it`, `Always name it`. | Three different `fp`. | `fingerprint:keep-emphasis` | fingerprint | scan |
| `ids.fp-word-change` | 1 | 20 sentences each edited by one word, one number or one negation. | Each edited sentence has a different `fp` from its source. | `fingerprint:hash-all-characters` | fingerprint | scan |
| `ids.fp-punctuation` | 2 | `Stop.`, `Stop!`, `Stop` inside equal contexts. | Three different `fp`. | `fingerprint:keep-punctuation` | fingerprint | scan |
| `ids.fp-confusables` | 3 | A sentence with Latin `a`, the same with Cyrillic `а` (U+0430), and with Greek `ο`. | Three different `fp`. | `fingerprint:no-confusable-folding` | fingerprint | scan |
| `ids.fp-context-neighbours` | 3 | The same sentence placed between different neighbour sentences. | `fp` equal and `ctxFp` different. | `fingerprint:ctx-neighbours` | fingerprint | scan |
| `ids.id-format` | 1 | 200 units over 10 files. | Every id matches `^[0-9a-z]{10}$`. | `ids:ten-char-base32` | ids | scan |
| `ids.id-unique` | 1 | 12 files with 150 units of distinct text. | 150 distinct ids. | `ids:unique-per-unit` | ids | scan |
| `ids.id-duplicate-text-one-file` | 2 | One sentence repeated 4 times in a file, with different sentences between. | Four distinct ids (the occurrence index). | `ids:occurrence-index` | ids | scan |
| `ids.id-duplicate-text-two-files` | 2 | The same sentence in two files. | Two distinct ids (the path is in the hash). | `ids:path-in-hash` | ids | scan |
| `ids.id-twin-boilerplate` | 3 | A 6-unit block copied into two files, plus unique units in each. | For each copied unit one of the pair has `twinOf` equal to the other's id; every unique unit has `twinOf` null. | `ledger:twin-of` | ledger | scan |
| `ids.id-deterministic` | 1 | Scan one estate three times from scratch. | Three identical ledger texts. | `ledger:deterministic-bytes` | ledger | scan |
| `ids.id-clone-parent-folder` | 2 | The same estate written under two different parent folders with the same folder name. | Identical ledger text (ids independent of the absolute path). | `ids:no-absolute-path` | ids | scan |
| `ids.id-file-order` | 2 | The same files created in three different orders and mtimes. | Identical ledger text. | `ledger:file-order-independent` | ledger | scan |
| `ids.id-env-independent` | 3 | Child scans with TZ set to three zones, LANG and LC_ALL to four locales, three working folders. | Identical ledger text and cut digests in all runs. | `ledger:env-independent` | ledger | scan,child |
| `ids.id-persist-other-edit` | 2 | Scan 40 units, reword one, rescan with the first ledger. | The other 39 ids are unchanged. | `ids:persisted-not-recomputed` | ids | scan |
| `ids.id-persist-insert-before` | 3 | A file with three identical sentences; insert five unique paragraphs above them; rescan. | The three duplicates keep their three ids; the five new units have fresh ids. | `ids:occurrence-minted-once` | ids | scan |
| `ids.id-persist-reword` | 2 | Replace one word of a 120 character sentence. | The id is unchanged and the quote is the new text. | `ids:persist-through-change` | ids | scan |
| `ids.id-roundtrip-edit-restores` | 3 | Scan v1, reword a unit (v2), revert the reword (v3), chaining each ledger. | The unit has the same id in v1 and v3. | `ids:persist-through-change` | ids | scan |
| `ids.id-new-unit-fresh` | 2 | Insert three units into 30. | Three ids that were not in the old ledger; all 33 distinct. | `ids:fresh-id-for-new-unit` | ids | scan |
| `ids.id-not-display-number` | 2 | Insert one paragraph at the top of a 30-unit file. | Every old id still points at its own text. | `ids:persisted-not-recomputed` | ids | scan |
| `ids.id-occurrence-delete-middle` | 3 | Units A x A y A, then remove `y` and the second A. | Two of the three A ids stay live, one is deleted, the first A keeps its id. | `ids:occurrence-minted-once` | ids | scan |
| `ids.ledger-sorted-keys` | 2 | Scan an estate with two label sets. | In every object of the ledger the keys appear in sorted order. | `ledger:sorted-keys` | ledger | scan |
| `ids.ledger-no-timestamps` | 2 | Scan twice, 1.2 s apart. | Identical text; no ISO-8601 date and no 13-digit epoch number appears. | `ledger:no-timestamps` | ledger | scan |
| `ids.ledger-rescan-idempotent` | 3 | Scan, then scan again with that ledger as input. | The second ledger text equals the first. | `ledger:rescan-idempotent` | ledger | scan |
| `ids.ledger-check-mode` | 3 | Scan, edit a unit, run the check with the old ledger, then update and check again. | First check fails and names the changed file; the ledger file is untouched; second check passes. | `ledger:check-mode` | ledger | scan |
| `ids.ledger-estate-untouched` | 1 | Hash every estate file before and after a scan with an update. | All hashes equal. | `ledger:estate-files-untouched` | ledger | scan |
| `ids.ledger-relative-paths` | 2 | Files in nested folders with spaces and accents in their names. | Every entry path equals the composer's relative POSIX path; none starts with `./` or `/`. | `ledger:relative-posix-paths` | ledger | scan |
| `ids.ledger-entry-fields` | 2 | Scan 30 units over 3 files. | Each entry has id, path, sectionPath, container, fp, ctxFp, quote, prefix, suffix, hint, status, labels, lineage, twinOf; for live entries `quote` equals the source slice at `hint` and `prefix + quote + suffix` occurs in the source. | `ledger:entry-fields` | ledger | scan |
| `ids.ledger-section-path` | 2 | A three-level outline with units at each level. | Each entry's `sectionPath` equals the composer's heading path. | `ledger:section-path` | ledger | scan |
| `ids.ledger-labels-per-set` | 2 | Two sets labelling the same units. | Each entry holds one object per set with label, source and setHash; the setHash is equal within a set and different between sets. | `ledger:labels-per-set` | ledger | scan |
| `ids.ledger-status-live` | 1 | Scan 20 units. | Every entry has status `live` and a last lineage event. | `ledger:status-live` | ledger | scan |
| `ids.ledger-safe-set-names` | 4 | Sets named `__proto__`, `constructor` and `hasOwnProperty`. | Each set's label is stored under its own name after a JSON round trip, and `Object.prototype` is not polluted. | `ledger:safe-set-names` | ledger | scan |

## re-anchoring

Level `anchor`, default component `anchor`, default needs scan. An old unit must find its new self: unchanged by order, moved by exact text, changed by similarity above a text floor, split, merged, or deleted, and never anchored to the wrong unit.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `re-anchoring.noop` | 1 | 40 long units over 4 files; rescan the same files with the first ledger. | Every old id is live with event `unchanged` at its own text; no new id, no deleted entry. | `anchor:unchanged-by-histogram-diff` | anchor | scan |
| `re-anchoring.rewrap` | 1 | Rewrap every paragraph at a different column. | Every old id live, event `unchanged`, same quote text after white space collapse. | `fingerprint:collapse-whitespace` | anchor | scan |
| `re-anchoring.crlf-conversion` | 1 | Convert all files from LF to CRLF. | Every old id live and `unchanged`. | `fingerprint:collapse-whitespace` | anchor | scan |
| `re-anchoring.bullet-swap` | 2 | Swap `-` to `*` in every list. | Every old id live and `unchanged`. | `fingerprint:strip-bullet-marker` | anchor | scan |
| `re-anchoring.renumber` | 2 | Shift every ordered list number by 3. | Every old id live and `unchanged`. | `fingerprint:strip-ordered-marker` | anchor | scan |
| `re-anchoring.blank-lines` | 1 | Add two blank lines between blocks and remove one elsewhere. | Every old id live and `unchanged`. | `anchor:unchanged-by-histogram-diff` | anchor | scan |
| `re-anchoring.paragraph-break-between-sentences` | 2 | Insert a blank line between two sentences of a paragraph. | Every old id live and `unchanged`; no split or merge event. | `anchor:unchanged-by-histogram-diff` | anchor | scan |
| `re-anchoring.heading-rename-keeps-units` | 3 | Rename the heading `## Closing duties` to `## Locking rounds`; the six units below stay as they are. | The six units keep ids, quotes and event `unchanged`, and their sectionPath now ends `Locking rounds`. | `anchor:context-change-keeps-id` | anchor | scan |
| `re-anchoring.move-within-file` | 2 | Move one 120 character unit from the top to the bottom of a 30-unit file. | Its id is live, event `moved`, same quote, at the new position; the other 29 ids are `unchanged`. | `anchor:exact-match-moved` | anchor | scan |
| `re-anchoring.move-section` | 3 | Move a heading and its four long units from the top to the bottom of a file of six sections. | The four long units keep their ids with event `moved`; the heading keeps its text and (it is under the length floor) its id with event `moved` or `changed`; the other units `unchanged`. | `anchor:exact-match-moved` | anchor | scan |
| `re-anchoring.move-swap-two` | 3 | Exchange the positions of two long paragraphs. | Each id still carries its own text (no swap of ids); events `moved` or `unchanged`. | `anchor:exact-match-moved` | anchor | scan |
| `re-anchoring.move-across-files` | 3 | Move one long unit from file A to file B. | Its id is live, event `moved`, path is B, quote unchanged. | `anchor:cross-file-move` | anchor | scan |
| `re-anchoring.file-rename` | 3 | Rename a file holding 12 long units, content unchanged. | All 12 ids live with the new path and the same quotes; events `moved` or `unchanged`; nothing deleted. | `anchor:cross-file-move` | anchor | scan |
| `re-anchoring.directory-rename` | 4 | Rename a folder holding 3 files of 10 long units. | All 30 ids live with new paths and the same quotes; nothing deleted. | `anchor:cross-file-move` | anchor | scan |
| `re-anchoring.move-and-reword` | 4 | Move a long unit to the bottom and replace one word. | Its id is live, event `changed`, quote is the new text. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.move-ambiguous-two-targets` | 4 | Remove unit U from its place and add two copies of its exact text at other places. | U's id has event `ambiguous`; both copies are live entries; neither is reported as a certain move. | `anchor:ambiguous-multiple-matches` | anchor | scan |
| `re-anchoring.twin-delete-is-not-a-move` | 4 | Files A and B hold the same long unit U; delete U from A only. | A's U is deleted (event `deleted`, quote kept); B's U keeps its id, event `unchanged`. | `anchor:twin-is-not-a-move` | anchor | scan |
| `re-anchoring.copy-keeps-original` | 3 | Append a copy of a long unit at the end of the file. | The original keeps its id and event `unchanged`; the copy has a fresh id. | `anchor:duplicate-is-new-unit` | anchor | scan |
| `re-anchoring.duplicate-section-insert` | 3 | Insert a copy of a 5-unit section in the middle of the file. | Each of the five old ids is carried by exactly one of the two copies; the other copy has five fresh ids; nothing deleted. | `anchor:duplicate-is-new-unit` | anchor | scan |
| `re-anchoring.reword-one-word` | 2 | Replace one word of a 110 character sentence. | Id live, event `changed`, quote the new text. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-two-words` | 2 | Replace two words of a 110 character sentence. | Id live, event `changed`. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-append-clause` | 3 | Append `, and log it` to a 100 character sentence. | Id live, event `changed`. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-prepend-clause` | 3 | Prepend `In every case, ` to a 100 character sentence. | Id live, event `changed`. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-case-flip-word` | 2 | Change `never` to `NEVER` in a 110 character sentence. | Id live, event `changed` (the fingerprint keeps case), quote the new text. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-negation` | 3 | Change `do` to `do not` in a 100 character sentence. | Id live, event `changed`. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-number` | 2 | Change `3` to `4` in a 100 character sentence. | Id live, event `changed`. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-list-item` | 2 | Replace one word in a long list item. | Id live, event `changed`. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-table-cell` | 2 | Replace one word in a long table cell. | Id live, event `changed`. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-heading` | 3 | Replace one word of a 60 character heading. | Id live, event `changed`; the units below keep their ids. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-quote-paragraph` | 3 | Replace one word in a wrapped quote paragraph. | Id live, event `changed`. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-front-matter-value` | 3 | Replace one word of a `description:` value. | Id live, event `changed`. | `anchor:pairwise-similarity-changed` | anchor | scan |
| `re-anchoring.reword-moderate` | 4 | Replace words of a 170 character sentence until its measured similarity to the source lies in 0.6 to 0.8. | Id live, event `changed`. | `anchor:moderate-reword-changed` | anchor | scan |
| `re-anchoring.rewrite-sentence` | 3 | Replace a 120 character sentence with an unrelated one (text similarity under 0.25), neighbours unchanged. | The old id is deleted (quote kept); the new unit has a fresh id; no `changed` event. | `anchor:text-similarity-floor` | anchor | scan |
| `re-anchoring.rewrite-list-item` | 3 | Replace a list item with an unrelated one in place. | Old id deleted, new unit fresh. | `anchor:text-similarity-floor` | anchor | scan |
| `re-anchoring.rewrite-table-cell` | 3 | Replace a table cell with unrelated text in place. | Old id deleted, new unit fresh. | `anchor:text-similarity-floor` | anchor | scan |
| `re-anchoring.rewrite-heading` | 3 | Replace a heading with an unrelated one in place; the units below stay. | Heading id deleted, new heading fresh; the units below keep their ids. | `anchor:text-similarity-floor` | anchor | scan |
| `re-anchoring.rewrite-ten-in-a-row` | 4 | Replace 10 consecutive units by unrelated ones (the offline run of design 10a mapped 47 of 50 such rewrites to the old unit). | All ten old ids deleted; ten fresh ids; zero wrong anchors. | `anchor:text-similarity-floor` | anchor | scan |
| `re-anchoring.rewrite-similar-to-neighbour` | 5 | Rewrite unit A into A' which is 0.7 similar to its unchanged neighbour B. | B keeps its id and event `unchanged`; A is deleted; A' has a fresh id. | `anchor:no-anchor-to-claimed-unit` | anchor | scan |
| `re-anchoring.reword-sweep-monotone` | 4 | Twelve units with 5, 13, 21 ... 93 percent of their words replaced; the similarity of each pair is measured. | A pair at similarity 0.55 or more keeps its id (`changed`); a pair at 0.3 or less is deleted and fresh; sorted by similarity the outcomes never turn from lost back to kept. | `anchor:monotone-acceptance` | anchor | scan |
| `re-anchoring.split-sentence` | 3 | Turn `A, and b.` (A about 80 percent of the text) into the sentences `A.` and `B.`. | The old id is live with event `split` and the quote of one half; the other half has a fresh id; nothing deleted. | `anchor:split-detection` | anchor | scan |
| `re-anchoring.split-list-item` | 3 | Turn one long item into two items. | Old id live with event `split`; one fresh id. | `anchor:split-detection` | anchor | scan |
| `re-anchoring.split-three-way` | 4 | Turn `A, B and C.` into three sentences. | Old id live with event `split`; two fresh ids. | `anchor:split-detection` | anchor | scan |
| `re-anchoring.merge-sentences` | 3 | Join two adjacent sentences with `, and`. | One old id is live with event `merged` and the joined quote; the other old id is deleted or merged and not live with different text; the live count equals the new unit count. | `anchor:merge-detection` | anchor | scan |
| `re-anchoring.merge-list-items` | 3 | Join two adjacent items into one. | Same oracle as the sentence merge. | `anchor:merge-detection` | anchor | scan |
| `re-anchoring.merge-with-reword` | 4 | Join two sentences and replace one word. | Same oracle as the sentence merge. | `anchor:merge-detection` | anchor | scan |
| `re-anchoring.delete-one` | 1 | Remove one long unit. | Its entry has event `deleted`, status not live, the old quote; all other ids `unchanged`. | `anchor:deleted-keeps-quote` | anchor | scan |
| `re-anchoring.delete-section` | 2 | Remove a heading and its five units. | Six entries `deleted` with quotes kept; the others `unchanged`. | `anchor:deleted-keeps-quote` | anchor | scan |
| `re-anchoring.delete-file` | 2 | Remove one file of 10 units from an estate of 4 files. | Ten entries `deleted` with quotes kept; other files `unchanged`. | `anchor:deleted-keeps-quote` | anchor | scan |
| `re-anchoring.replace-whole-file` | 3 | Replace a 20-unit file by 20 unrelated units under the same path. | 20 deleted, 20 fresh ids, zero wrong anchors. | `anchor:text-similarity-floor` | anchor | scan |
| `re-anchoring.script-mixed-6` | 4 | Segment script of 6 edits (reword, rewrite, delete, insert, move, split) among 30 kept units; every text that leaves is under 0.39 alike to every text that enters. | Every old unit's outcome class equals the script's; inserted units fresh; live count equals the new unit count. | `anchor:mixed-edit-script` | anchor | scan |
| `re-anchoring.script-mixed-20` | 5 | Segment script of 20 edits (all kinds including merge) among 100 kept units, same constraint. | Same oracle. | `anchor:mixed-edit-script` | anchor | scan |
| `re-anchoring.script-multi-file` | 5 | 10 files and about 165 units; 15 edits including three moves to another file. | Same oracle, with the path of each moved unit. | `anchor:multi-file-anchoring` | anchor | scan |
| `re-anchoring.no-wrong-anchors-fuzz` | 5 | 100 seeded random edit pairs (keep, reword, rewrite, delete, copy, reverse, insert) on documents of 8 units. | For every carried id the new quote is exact old text or has normalised similarity at least 0.3 to the old quote; ids unique; every new unit has exactly one live entry. | `anchor:no-wrong-anchor-invariant` | anchor | scan |

## grouping

Level `labels`, default component `atoms`, default needs scan. Ranges label consecutive units; a container unit is one atom; a gate quotes from its first to its second unit; every atom text is a source slice.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `grouping.range-covers-paragraph` | 1 | A paragraph of 4 sentences; the labeller answers one range `k-(k+3)` with `rule`. | Four atoms, one per sentence unit, each quote equal to its sentence slice, lines right, non-overlapping. | `atoms:one-atom-per-unit` | atoms | scan |
| `grouping.range-boundaries-inclusive` | 2 | A 12-unit file; the labeller answers `5-6` with `rule` and `none` for the rest. | Units 5 and 6 carry `rule`; units 4 and 7 do not. | `labeler:range-forms` | labeler | scan |
| `grouping.range-single-unit-and-whole-window` | 2 | Answers `7` and `1-12` over 12 units in two scans. | Unit 7 alone labelled in the first scan; all 12 labelled in the second. | `labeler:range-forms` | labeler | scan |
| `grouping.range-across-heading` | 3 | A range covering a sentence, a heading and the next two sentences. | All four units carry the label; atoms built for each mapped unit. | `atoms:one-atom-per-unit` | atoms | scan |
| `grouping.container-quote-paragraph-one-atom` | 2 | A block quote paragraph of 2 sentences labelled `rule`. | One atom whose quote is the whole paragraph slice (inner `> ` markers included). | `atoms:container-unit-whole-quote` | atoms | scan |
| `grouping.container-list-item-one-atom` | 2 | A list item `A. B.` labelled `prohibition`. | One atom, quote equal to the item slice. | `atoms:container-unit-whole-quote` | atoms | scan |
| `grouping.container-table-cell-one-atom` | 2 | A cell `Do this. Then that.` labelled `rule`. | One atom; quote equal to the cell slice; no pipe in the quote. | `atoms:container-unit-whole-quote` | atoms | scan |
| `grouping.lines-multi-line-unit` | 2 | A list item wrapped over 3 lines, a sentence wrapped over 2. | Atom start line and end line are the first and last line of the quote (1-based, inclusive). | `atoms:line-span-multi-line-unit` | atoms | scan |
| `grouping.gate-adjacent-sentences` | 2 | Sentences 5 and 6; the labeller answers `gate` on 5 with target 6. | One atom of kind `gate`; the quote occurs in the source, starts with unit 5's text and ends with unit 6's. | `atoms:gate-quote-first-to-second` | atoms | scan |
| `grouping.gate-target-earlier` | 3 | The target is unit 3 and the gate unit is unit 7. | The quote starts with unit 3's text and ends with unit 7's text. | `atoms:gate-file-order` | atoms | scan |
| `grouping.gate-across-sections` | 3 | Gate unit and target in two sections with a heading between. | The quote is verbatim source text from the first to the second unit. | `atoms:gate-quote-first-to-second` | atoms | scan |
| `grouping.gate-between-list-items` | 3 | Items 2 and 4 of a list, gate on 4 with target 2. | One atom; the quote starts with item 2's text and ends with item 4's. | `atoms:gate-quote-first-to-second` | atoms | scan |
| `grouping.gate-two-share-target` | 3 | Units 4 and 8 are gates with target 2. | Two atoms of kind `gate` with different `fields.unit`. | `atoms:gate-quote-first-to-second` | atoms | scan |
| `grouping.gate-chain` | 4 | Gate A before B and B before C over three consecutive units. | Two gate atoms; each quote is verbatim; both exist. | `atoms:gate-quote-first-to-second` | atoms | scan |
| `grouping.atom-kind-polarity-from-mapping` | 1 | Units labelled rule, prohibition, gate. | Atoms: instruction/obligation, instruction/prohibition, gate. | `atoms:kind-polarity-from-mapping` | atoms | scan |
| `grouping.atom-no-atom-without-mapping` | 2 | Units labelled `example` and `description` (no `atom` in the set). | Zero atoms for them; each has a ledger entry carrying its label. | `atoms:no-atom-without-mapping` | atoms | scan |
| `grouping.atom-none-builds-nothing` | 1 | Half the units labelled `none`. | No atom for them. | `atoms:no-atom-without-mapping` | atoms | scan |
| `grouping.atom-provenance-verbatim` | 2 | 20 units with entities, escapes, emphasis, NFD text and emoji. | Each atom quote equals the source slice of its unit. | `atoms:provenance-source-slice` | atoms | scan |
| `grouping.atom-flags` | 1 | Any labelled estate. | Each atom has producedBy `model`, approved false, fields.extraction `pointer`, fields.unit equal to the ledger id, fields.labelSet equal to the set name. | `atoms:pointer-atom-flags` | atoms | scan |
| `grouping.atom-evidence-prose-pointer` | 1 | Any labelled estate. | Each atom has exactly one evidence entry: type `custom`, name `prose_pointer`, reviewRequired true; the labeller's meta text appears in no atom. | `atoms:evidence-prose-pointer` | atoms | scan |
| `grouping.atom-no-labeler-text` | 2 | A labeller that returns a decoy quote `FAKE QUOTE` in its meta and extra keys. | No atom field contains `FAKE QUOTE`. | `atoms:no-labeler-text` | labeler | scan |
| `grouping.atom-unit-id-survives-edit` | 3 | Scan, reword one labelled unit, rescan. | The atom's fields.unit is the same id; its quote is the new text. | `ids:persist-through-change` | atoms | scan |
| `grouping.atom-count-equals-mapped-units` | 2 | A seeded 80-unit document with 5 labels. | Atom count equals the number of units with a mapped label (a gate counts once). | `atoms:one-atom-per-unit` | atoms | scan |
| `grouping.atom-order-deterministic` | 2 | Three files, labels everywhere. | Atoms are ordered by file path then start position, identically on two scans. | `atoms:deterministic-order` | atoms | scan |

## labels

Level `labels`, default component `labeler`, default needs scan. The labeller port, its windows, answer validation, carry-forward, label sets as data, and the two ports (Jev thresholds and call shapes, Haiku dense requests) behave as the design says.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `labels.perfect-labels-recovered` | 1 | A 60-unit document, set `agent-rules` with five labels, a labeller that answers the hidden truth. | Every unit's ledger label equals the planted label; no extra label. | `scan:labels-into-ledger` | scan | scan |
| `labels.perfect-atoms-exact` | 2 | Same document. | Atom set equals the planted atom set by quote, kind and polarity (precision and recall 1). | `atoms:one-atom-per-unit` | scan | scan |
| `labels.heading-keyed-labeller` | 2 | A labeller that answers `rule` for units under a heading named `Rules` (path-based) and `none` elsewhere, over a 3-level outline. | The window it receives lists each unit with the composer's heading path; the ledger equals its answers. | `labeler:window-heading-path` | labeler | scan |
| `labels.length-keyed-labeller` | 2 | A labeller that answers by text length (long: `description`, short: `rule`). | Each window unit's text equals the composer's unit text after white space collapse; the ledger equals its answers. | `labeler:window-unit-text` | labeler | scan |
| `labels.none-labeller` | 1 | All units answered `none`. | Zero atoms, zero `unlabeled` diagnostics, no failed window. | `scan:all-none-ok` | scan | scan |
| `labels.unlabeled-gap-listed` | 2 | The answer omits units 7 and 9 of 20. | Diagnostics `unlabeled` name exactly those two units; they have no atom; the other 18 are labelled. | `labeler:unlabeled-listed` | labeler | scan |
| `labels.label-on-every-container` | 2 | One unit each of list item, table cell, quote paragraph, heading, front matter value and sentence, all labelled `rule`. | Six ledger entries with the label and six atoms with the right quotes. | `scan:labels-into-ledger` | scan | scan |
| `labels.window-one-per-file-and-set` | 1 | Three small files, two sets. | Six labeller calls; each call lists exactly its file's units as labelable and carries one set. | `labeler:one-request-per-window-and-set` | labeler | scan |
| `labels.window-split-at-headings` | 3 | A 900,000 character file of 30 `##` sections. (seed-free) | At least 2 and at most 12 windows; each starts at a heading or the file start; every unit is labelable in exactly one window; no window holds more than 420,000 characters of units. | `labeler:window-split-at-headings` | labeler | scan |
| `labels.prompt-set-lines` | 2 | Haiku port on a fake transport; set `house-voice` with descriptions and two examples. | The request holds the set name and description, each label name and description, and each example, verbatim, and no label from another set. | `labelset:prompt-from-set` | labelset | transport |
| `labels.prompt-generic-template` | 3 | Build the request for `agent-rules` and for the bakery set `house-voice` on the same units. | Outside the set-derived lines the system text and the user text are identical, and neither contains: estate, agent, skill, nexus, claude, driftbench, helper, prompt, rule, gate, instruction, bakery, email. | `labelset:generic-prompt-template` | labelset | transport |
| `labels.prompt-examples-max-three` | 3 | A label with five examples. | The request shows at most three of them, or the set is refused with a message naming the label. | `labelset:examples-cap` | labelset | transport |
| `labels.prompt-one-line-per-unit` | 3 | A wrapped unit whose second line starts `[99] ` and another containing `SET other` and `WINDOW x#9` at line starts. | The request holds exactly one numbered line per labelable unit; one header per kind; the forged text appears only inside its own unit line. | `labeler:unit-per-line` | labeler | transport |
| `labels.prompt-header-and-enum` | 2 | Any window. | The request has `SET <name>`, `LABELS a \| b \| ... \| none` listing exactly the set's names plus `none`, and `WINDOW <file>#<k>` with the heading path. | `labelset:answer-enum` | labelset | transport |
| `labels.refuse-unknown-label` | 2 | First answer uses a label not in the set; the second is valid. | Two calls for the window; the ledger holds only the second answer's labels. | `labeler:validate-label-name` | labeler | scan |
| `labels.refuse-unit-not-in-window` | 2 | First answer names unit 999. | Two calls; only the second answer applies. | `labeler:validate-unit-references` | labeler | scan |
| `labels.refuse-range-leaves-window` | 2 | First answer `18-25` over a window of 20 units. | Two calls; only the second answer applies. | `labeler:validate-unit-references` | labeler | scan |
| `labels.refuse-reversed-range` | 3 | First answer `13-12`. | Two calls; only the second answer applies. | `labeler:validate-unit-references` | labeler | scan |
| `labels.refuse-non-integer-unit` | 3 | First answers `1.5`, `-3`, `1e2`, `abc` in four scans. | Each scan makes two calls and applies only the second answer. | `labeler:validate-unit-references` | labeler | scan |
| `labels.refuse-target-on-plain-label` | 2 | First answer puts `target` on `rule`. | Two calls; only the second answer applies. | `labeler:validate-target` | labeler | scan |
| `labels.refuse-missing-target` | 2 | First answer labels a unit `gate` with no target. | Two calls; only the second answer applies. | `labeler:validate-target` | labeler | scan |
| `labels.refuse-label-on-opaque-unit` | 2 | First answer labels the unit that is a fenced block. | Two calls; only the second answer applies; no atom from the fence. | `labeler:validate-opaque-and-context` | labeler | scan |
| `labels.refuse-label-on-context-unit` | 3 | Rescan with one dirty window; the planted labeller labels a unit that was shown as context. | Two calls; the context unit keeps its recorded label. | `labeler:validate-opaque-and-context` | labeler | scan |
| `labels.refuse-overlap` | 2 | First answer names unit 4 in two entries. | Two calls; only the second answer applies. | `labeler:validate-overlap` | labeler | scan |
| `labels.retry-once-then-fail` | 2 | The labeller is invalid on every call. | Exactly two calls; the window's units are `unlabeled`; no atom; a diagnostic names the window. | `labeler:retry-once-then-fail` | labeler | scan |
| `labels.failed-window-isolated` | 3 | A file of 1,400,000 characters (at least 3 windows); the second window is always invalid. (seed-free) | Every other window is labelled as planted; the second window's units are `unlabeled`; calls = windows + 1. | `labeler:retry-once-then-fail` | labeler | scan |
| `labels.carry-forward-unchanged-no-calls` | 2 | Scan 30 units, rescan the same files with the ledger. | Zero labeller calls; labels as before. | `scan:carry-forward-unchanged` | scan | scan |
| `labels.carry-forward-dirty-window-only` | 3 | A file of 1,400,000 characters (at least 3 windows); reword one unit; rescan. (seed-free) | Exactly one call, for the window holding it; there, every labelable unit is new, changed or has a changed context fingerprint, and the unchanged units are context only. | `scan:dirty-window-only` | scan | scan |
| `labels.carry-forward-keeps-recorded-labels` | 3 | Rescan with a labeller that answers `description` for everything it is asked about. | Only the edited unit gets `description`; all carried units keep their first labels. | `scan:carry-forward-unchanged` | scan | scan |
| `labels.carry-forward-context-changed-resent` | 4 | Reword a unit; read the old and new ledgers. | Every unit whose `fp` is equal and whose `ctxFp` differs was labelable in some call of the rescan. | `scan:ctxfp-triggers-relabel` | scan | scan |
| `labels.label-flip-not-deleted` | 3 | Scan with labeller 1; change one description of the set (new set hash); rescan the unchanged files with labeller 2 that answers `none` for three units labeller 1 called `rule`. | The three units stay live with event `unchanged` and label `none`; a `label_flip` diagnostic names each; none is reported `deleted`; their atoms are gone. | `scan:label-flip-diagnostic` | scan | scan |
| `labels.anchoring-independent-of-labeler` | 3 | The same edit script scanned with four different labellers (perfect, none, length-keyed, random). | The ids, events and quotes of all entries are identical in the four ledgers; only labels differ. | `scan:anchoring-independent-of-labels` | scan | scan |
| `labels.sets-independent` | 3 | Two sets on the same units; change one label description of set B; rescan. | Zero calls for set A windows; B windows all sent; every id unchanged; A labels unchanged. | `labelset:set-hash-per-set` | labelset | scan |
| `labels.set-hash-ignores-yaml-formatting` | 3 | Rewrite the labels file: comments, key order inside labels, quote style, indentation. | The set hash is unchanged and the rescan makes zero calls. | `labelset:canonical-form-hash` | labelset | scan |
| `labels.set-hash-covers-fields` | 3 | Five variants of one set: a changed label name, description, example, target, atom mapping. | Each gives a different set hash from the base and from each other. | `labelset:set-hash-per-set` | labelset | scan |
| `labels.set-validation-errors` | 2 | Sets with a repeated set name, a label named `none`, a repeated label name, a label name with a space, a `target` other than `required`. | Each is refused and the message names the offending set or label. | `labelset:validation` | labelset | scan |
| `labels.read-unit-not-labelable` | 3 | A skill whose `description` front matter value is read by the structured reader. | That unit is shown as `read`; a label on it is refused; every other unit is labelable. | `scan:read-units-marked` | scan | scan |
| `labels.default-set-is-data` | 3 | One scan with no labels file (the default `agent-rules` set), one with the same set written out as a file, one with a set named `bakes` whose labels are `weigh`, `proof`, `none-of-these`. | The first two ledgers and atoms are identical; the third stores its own label names with no code change. | `labelset:default-set-as-data` | labelset | scan |
| `labels.none-always-allowed` | 1 | A set that does not declare `none`; the labeller answers `none` for some units. | The answer is accepted. | `labelset:none-reserved-allowed` | labelset | scan |
| `labels.jev-threshold-window` | 2 | Jev port (window state) on a fake transport; 12 units with crafted probabilities around 0.4 (0.39 / 0.41 and others). | Label = the highest probability label when it is above 0.4, else `none` (values at 0.39 and 0.41 only; 0.4 itself is not asked). | `jev:threshold-window` | jev | transport |
| `labels.jev-threshold-unit` | 3 | Jev unit state; probabilities around 0.7. | Label = highest probability above 0.7, else `none`. | `jev:threshold-unit` | jev | transport |
| `labels.jev-highest-not-first` | 3 | Unit with rule 0.5 and prohibition 0.8 (rule first in the set). | Label `prohibition`. | `jev:highest-probability-decoding` | jev | transport |
| `labels.jev-none-below-threshold` | 2 | All five probabilities below 0.4. | Label `none`; no atom. | `jev:threshold-window` | jev | transport |
| `labels.jev-threshold-is-a-replay-setting` | 3 | Record at the default; replay with threshold 0.9. | Zero transport calls on the replay; the set of labelled units shrinks to those above 0.9. | `jev:threshold-is-replay-setting` | jev | transport,cassette |
| `labels.jev-question-keys` | 3 | Window of 20 units, five labels. | Each call carries one question per (unit, label) keyed `u<n>__<label>`; the keys cover all pairs once. | `jev:question-key-form` | jev | transport |
| `labels.jev-window-cap` | 3 | 100 units and five labels (500 questions). | At least 2 calls, none above 250 questions; every unit asked once. | `jev:window-cap-250-questions` | jev | transport |
| `labels.jev-halve-on-refusal` | 3 | A transport that answers HTTP 400 `max_tokens_exceeded` to any call above 130 questions; 40 units, five labels. | All 40 units labelled; no accepted call above 130 questions; at most 3 refused calls. | `jev:halve-window-on-refusal` | jev | transport |
| `labels.jev-unit-state-one-call-per-unit` | 3 | Jev unit state, 25 units, five labels. | 25 calls with five questions each. | `jev:unit-state-request-per-unit` | jev | transport |
| `labels.jev-probabilities-recorded` | 3 | Record a window with the fake Jev transport. | The cassette entry holds a number in [0,1] for every `u<n>__<label>` key of the window. | `jev:probabilities-recorded` | jev | transport,cassette |
| `labels.haiku-dense-request` | 2 | Haiku port on a fake transport; two files, one set. | One request per file; each answer covers every unit once with ranges allowed; labels reach the ledger. | `haiku:dense-request-per-window` | haiku | transport |
| `labels.haiku-thinking-block-first` | 3 | A response whose first block is a thinking block with unrelated text and whose second is the answer. | The answer is read and applied; the thinking text is ignored. | `haiku:read-blocks-by-type` | haiku | transport |
| `labels.haiku-stop-reason-refused` | 3 | First response has stop_reason `max_tokens`, another `refusal`; second responses valid. | Each is refused and retried once; only the valid answer applies. | `haiku:validate-response` | haiku | transport |
| `labels.haiku-refuse-wrong-window-or-set` | 3 | First answer echoes another window id; another time another set name. | Each is refused and retried once. | `haiku:validate-response` | haiku | transport |

## stack

Level `stack`, default component `stack`, default needs stack. The margin, the cut and the share, the accept rule, the person, failure handling and the pluggable labellers, on planted answers.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `stack.margin-is-top-minus-second` | 1 | Vectors of 6 labels with a chosen top, second and margin from 0.05 to 0.95, in a shuffled key order. | Each unit reports the planted margin (within 1e-9) and the top label. | `stack:margin-top-minus-second` | stack | stack |
| `stack.margin-in-unit-interval` | 1 | Thirty random vectors that sum to 1, including one-hot and uniform vectors. | Every reported margin is in [0, 1]; the one-hot vector gives 1, the uniform vector 0. | `stack:margin-range` | stack | stack |
| `stack.margin-tie-is-zero` | 2 | A vector with 0.4 on two labels; default cut. | Margin 0; the unit is sent to system 2. | `stack:margin-tie` | stack | stack |
| `stack.vector-sum-error` | 2 | System 1 answers one unit with a vector summing to 0.90, then one summing to 1.20. | Both runs fail with a message that names the sum; no unit is accepted from them. | `stack:vector-sum-check` | stack | stack |
| `stack.vector-sum-tolerance` | 3 | A vector that sums to 1.009 and one that sums to 0.992. | Both runs succeed and report their margins. | `stack:vector-sum-tolerance` | stack | stack |
| `stack.accept-above-cut` | 1 | Twenty units with margins from 0.7 to 0.99, cut 0.65, a system 2 that would answer another label. | Every unit takes route system1 with its top label; system 2 is never called. | `stack:accept-above-cut` | stack | stack |
| `stack.margin-equal-to-cut-accepted` | 2 | Vector 0.75 and 0.25 (margin exactly 0.5), cut 0.5; another unit at 0.5 minus 2^-10. | The first unit is accepted at system 1; the second goes to system 2. | `stack:cut-boundary` | stack | stack |
| `stack.default-cut-is-065` | 2 | Units with margins 0.60, 0.64, 0.66 and 0.70, no cut given. | The units at 0.60 and 0.64 go to system 2; the others stay at system 1. | `stack:default-cut` | stack | stack |
| `stack.unanimous-system2-accepted` | 1 | Ten units below the cut; system 1 says `rule`, the three runs say `gate`. | Each label is `gate`, route system2, none unsure. | `stack:accept-unanimous` | stack | stack |
| `stack.any-difference-goes-to-person` | 1 | Units below the cut with runs [a, a, b], [a, b, a], [b, a, a] and [a, b, c]. | Each is route person with no label; their votes are listed. | `stack:person-on-disagreement` | stack | stack |
| `stack.unanimity-fuzz` | 3 | Sixty units below the cut with runs drawn from the six labels, half unanimous. | A unit is accepted at system 2 exactly when its three votes are equal. | `stack:unanimity-rule` | stack | stack |
| `stack.cut-zero-is-system1` | 2 | Forty units with random margins, cut 0. | Every label is the system 1 top label, no unit is unsure, system 2 is never called. | `stack:cut-zero` | stack | stack |
| `stack.cut-one-sends-nearly-all` | 3 | Thirty units with margins below 1 and one one-hot unit (margin 1), cut 1. | The thirty are sent; the one-hot unit is not. | `stack:cut-one` | stack | stack |
| `stack.cut-monotone` | 3 | Fifty units with distinct margins; cuts from 0 to 1 in steps of 0.1. | The sent sets are nested; each equals the units with margin below its cut. | `stack:cut-monotone` | stack | stack |
| `stack.share-sends-lowest-margins` | 3 | Forty units with distinct margins, share 0.25. | The ten units with the lowest margins are sent; no other. | `stack:share-setting` | stack | stack |
| `stack.share-equals-cut` | 4 | Forty distinct margins; the cut set midway between the 12th and 13th margin; share 0.3. | The same units are sent with the share and with the cut. | `stack:share-setting` | stack | stack |
| `stack.require-agreement-default-off` | 2 | A unit below the cut whose system 1 top label differs from the unanimous system 2 label. | Accepted with the system 2 label when the setting is not given. | `stack:require-agreement-default` | stack | stack |
| `stack.require-agreement-on` | 3 | Units below the cut: some where system 2 is unanimous and equals the top label, some where it differs. | Equal ones are accepted; the differing ones are route person. | `stack:require-agreement` | stack | stack |
| `stack.require-agreement-subset` | 3 | Sixty units with mixed agreement; the same plan run with the setting off and on. | Every unit accepted with it on is accepted with it off, with the same label. | `stack:require-agreement` | stack | stack |
| `stack.moving-a-unit-changes-only-it` | 3 | The same plan twice; one unit gets a margin above the cut in the first and below in the second. | Every other unit has an identical result in both runs. | `stack:route-independence` | stack | stack |
| `stack.whole-window-context` | 3 | A file where half the units are above the cut; system 2 answers a wrong label for those. | System 2 receives every unit of the file; the units above the cut keep their system 1 labels. | `stack:system2-window-context` | stack | stack |
| `stack.three-runs-same-windows` | 3 | Two files with units below the cut; record each system 2 call. | Three calls per file, runs numbered 0 to 2, the same unit numbers and texts in each. | `stack:system2-runs` | stack | stack |
| `stack.one-call-per-file-per-run` | 3 | One file with 1 unit sent and one file with 20 units sent; a third file with none sent. | Three calls for each of the first two files; none for the third. | `stack:system2-calls` | stack | stack |
| `stack.system1-retry-once` | 3 | System 1 throws on its first call and answers on its second. | The units are accepted from the second answer; system 1 was called twice for the window. | `stack:system1-retry` | stack | stack |
| `stack.system1-fails-twice` | 4 | System 1 throws on both calls for one window of a file and answers for the other. | The failed window is all sent to system 2; the other window routes by margin. | `stack:system1-failure` | stack | stack |
| `stack.system2-run-missing` | 3 | Units below the cut: one with a run that throws, one with a run that omits the unit, one with a label outside the set. | All three are route person; a unit whose other two runs agree is still not accepted. | `stack:system2-failure` | stack | stack |
| `stack.no-unlabelled-accept` | 2 | System 1 answers every unit but one; system 2 says `gate` three times for it. | The unit goes to system 2 and is accepted there; with no system 2 answer it goes to a person. | `stack:never-unlabelled` | stack | stack |
| `stack.persons-list-exact` | 2 | Eighty units: 20 below the cut with split runs, 20 below with unanimous runs, 40 above. | Exactly the 20 split units are route person; accepted units are not sampled. | `stack:person-only-unsure` | stack | stack |
| `stack.user-labeller-as-system2` | 2 | A plain function that answers a fixed label per unit; system 1 is the planted one. | Its three runs agree and its labels are accepted. | `stack:pluggable-system2` | stack | stack |
| `stack.user-labeller-not-system1` | 3 | System 1 answers labels only, with no vector. | The run fails with a message that names the missing probabilities. | `stack:system1-needs-probabilities` | stack | stack |
| `stack.user-labeller-voting` | 4 | A system 2 that returns a different label on each call for half the units. | Those units go to a person; the stable ones are accepted. | `stack:pluggable-system2` | stack | stack |
| `stack.user-labeller-as-system1` | 4 | A hand-written system 1 with its own vectors, no connection to the planted one. | The stack routes by its margins exactly as for the planted system 1. | `stack:pluggable-system1` | stack | stack |
| `stack.empty-input` | 2 | An empty window list and a window with no unit. | The run succeeds with no unit and no call to system 2. | `stack:empty-input` | stack | stack |
| `stack.deterministic` | 2 | One plan run twice. | The two results are equal. | `stack:determinism` | stack | stack |
| `stack.estate-reference-outcome` | 5 | Nine files, 465 units: 279 confident and right, 186 below the cut; of those 149 have three equal right votes and 37 split votes. | Accepted at system 1: 279; accepted at system 2: 149; to a person: 37; accepted units are all correct; calls: 9 for system 1 and 27 for system 2. | `stack:estate-counts` | stack | stack |

## replay

Level `replay`, default component `cassette`, default needs transport, cassette. Determinism lives in the cassette: replay equals recording byte for byte, a miss never reaches the network and names the field that differs, and the key follows the request, not the clone.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `replay.record-then-replay-identical` | 1 | Record 3 files (2 sets) through the Haiku port on a fake transport; replay in CI mode with the transport closed. | Ledger text and atoms of the replay equal the recording run's; the transport counts 0 calls in the replay. | `cassette:replay-equals-record` | cassette | transport,cassette |
| `replay.replay-twice-identical` | 1 | Replay the same cassette twice. | Ledger text and atoms identical. | `cassette:replay-equals-record` | cassette | transport,cassette |
| `replay.two-recordings-same-cassette` | 2 | Record the same estate twice in fresh folders against the same scripted transport. | The two cassette files are byte-identical. | `cassette:deterministic-dump` | cassette | transport,cassette |
| `replay.miss-fails-without-network` | 1 | Replay with an empty cassette. | The run fails with a message; the transport counts 0 calls. | `cassette:ci-mode-no-network` | cassette | transport,cassette |
| `replay.record-is-explicit` | 2 | No cassette, record off; then record on; then record on again with the finished cassette. | 0 calls; then one call per window and set; then 0 calls (entries are reused). | `cassette:ci-mode-no-network` | cassette | transport,cassette |
| `replay.miss-names-description-edit` | 3 | Edit one label description in the set; replay the old cassette. | The failure names `setHash` or `part.user`. | `cassette:miss-names-field` | cassette | transport,cassette |
| `replay.miss-names-renamed-label` | 3 | Rename one label; replay. | The failure names `setHash`, `part.output` or `part.user`. | `cassette:miss-names-field` | cassette | transport,cassette |
| `replay.miss-names-added-example` | 3 | Add an example to a label; replay. | The failure names `setHash` or `part.user`. | `cassette:miss-names-field` | cassette | transport,cassette |
| `replay.miss-names-changed-unit` | 3 | Reword one unit; replay the old cassette with no previous ledger. | The failure names `part.user`. | `cassette:miss-names-field` | cassette | transport,cassette |
| `replay.miss-names-new-file` | 3 | Add a file; replay without a previous ledger. | The failure names `part.user`, `file` or `window`. | `cassette:miss-names-field` | cassette | transport,cassette |
| `replay.miss-names-cut-digest` | 3 | Change the cut digest in every entry of the cassette; replay. | The failure names `cutDigest`. | `cassette:miss-names-cut-digest` | cassette | transport,cassette |
| `replay.miss-names-labeler` | 3 | Record with the Jev arm, replay with the Haiku arm and the reverse. | Each failure names the labeller field (`labeler`). | `cassette:miss-names-labeler` | cassette | transport,cassette |
| `replay.miss-names-set-name` | 3 | Rename the set; replay. | The failure names `setName`, `set` or `setHash`. | `cassette:miss-names-field` | cassette | transport,cassette |
| `replay.miss-names-nearest-entry` | 4 | Reword one unit; replay. | The failure message contains the window id of the nearest recorded entry. | `cassette:miss-names-field` | cassette | transport,cassette |
| `replay.cut-digest-mismatch-names-versions` | 3 | Tamper the cut digest stored with the cassette; replay. | The error text contains the running `process.versions.node` and `process.versions.icu`. | `cassette:cut-digest-error-versions` | cassette | transport,cassette |
| `replay.key-is-sha256-hex` | 2 | Record any estate. | Every entry's key matches `^[0-9a-f]{64}$`; keys are distinct. | `cassette:key-sha256` | cassette | transport,cassette |
| `replay.key-ignores-threshold` | 3 | Record with the Jev arm at the default threshold; replay at 0.9. | No miss; zero transport calls. | `cassette:threshold-not-in-key` | cassette | transport,cassette |
| `replay.key-ignores-clone-path` | 3 | Record in folder A; copy the estate and the cassette to folder B; replay. | No miss; identical ledger text. | `cassette:key-path-independent` | cassette | transport,cassette |
| `replay.key-ignores-yaml-formatting` | 3 | Replay with the labels file reformatted (comments, key order, quotes). | No miss. | `cassette:key-canonical-set` | cassette | transport,cassette |
| `replay.cassette-no-file-text` | 2 | Units carry unique tokens such as `ZQ7-<n>-NOTE`; record. | No token appears anywhere in the cassette. | `cassette:no-file-text` | cassette | transport,cassette |
| `replay.cassette-readable-fields` | 2 | Record any estate. | Every entry has keys for file, window, prompt version, schema version, set name, set hash, labeler and cut digest (tolerant key names), all non-empty. | `cassette:readable-fields` | cassette | transport,cassette |
| `replay.cassette-stored-answer` | 2 | Record with the Haiku arm and with the Jev arm. | Every entry has labels, the returned model id, stop reason and usage; Jev entries also hold per-question probabilities. | `cassette:stored-answer-fields` | cassette | transport,cassette |
| `replay.model-mismatch-warns` | 3 | Record with a transport answering model `m-1`; record again into the same cassette after clearing one entry, now answering `m-2`. | The run succeeds and prints a warning that names both model ids. | `cassette:model-mismatch-warning` | cassette | transport,cassette |
| `replay.carry-forward-needs-only-dirty-entries` | 3 | Record 3 files, edit one unit, delete from the cassette every entry except those of the dirty window's old and new requests that are needed; replay with the old ledger. | The replay succeeds; transport calls 0. | `cassette:window-granularity` | cassette | transport,cassette |
| `replay.fresh-replay-needs-all-entries` | 2 | Remove one entry from a full cassette; replay without a previous ledger. | The run fails and names the window. | `cassette:window-granularity` | cassette | transport,cassette |
| `replay.failed-recording-keeps-valid-cassette` | 3 | The transport throws on the second window. | The cassette parses; the first window's entry is present, the second absent; a second record run makes exactly one call. | `cassette:atomic-append` | cassette | transport,cassette |
| `replay.answers-frozen-despite-random-transport` | 3 | A transport that answers randomly on every call; record once, replay twice. | Both replays give the recording run's ledger. | `cassette:replay-equals-record` | cassette | transport,cassette |
| `replay.jsonl-format` | 2 | Record any estate. | Each line parses as a JSON object; no blank line; the file ends with a newline. | `cassette:jsonl-lines` | cassette | transport,cassette |
| `replay.one-cassette-per-arm` | 3 | Record the Haiku arm and the Jev arm into two files; point each arm at the other's file. | Each fails by name; each own file replays. | `cassette:miss-names-labeler` | cassette | transport,cassette |
| `replay.fixture-haiku-replays-committed` | 3 | Scan the 14 fixture files with the Haiku arm, the committed cassette in replay mode and a transport that fails every call. (seed-free) | The scan succeeds, the transport is never called, and every labelable unit holds a label of the default set. | `cassette:fixture-replays` | cassette | scan,cassette,transport |
| `replay.fixture-jev-replays-committed` | 3 | The same scan with the Jev arm and the committed cassette. (seed-free) | The scan succeeds with no transport call; every unit holds a label of the default set. | `cassette:fixture-replays` | cassette | scan,cassette,transport |
| `replay.fixture-jev-unit-replays-committed` | 3 | The same scan with the Jev unit arm and its committed cassette. (seed-free) | The scan succeeds with no transport call; every unit holds a label of the default set. | `cassette:fixture-replays` | cassette | scan,cassette,transport |
| `replay.fixture-replay-twice-identical` | 3 | Replay the committed Haiku cassette twice, the second time against the first ledger. (seed-free) | Both ledgers are the same text. | `cassette:fixture-replays` | cassette | scan,cassette,transport |
| `replay.fixture-miss-names-model` | 4 | Change the model field of one committed entry and its key; replay. | The scan fails without a transport call and the message names `model`. | `cassette:miss-names-field` | cassette | scan,cassette,transport |
| `replay.fixture-miss-names-prompt-version` | 4 | Change the prompt version field of one committed entry and its key; replay. | The message names `promptVersion`. | `cassette:miss-names-field` | cassette | scan,cassette,transport |
| `replay.fixture-miss-names-schema-version` | 4 | Change the schema version field of one committed entry and its key; replay. | The message names `schemaVersion`. | `cassette:miss-names-field` | cassette | scan,cassette,transport |
| `replay.fixture-miss-names-set-hash` | 4 | Change the set hash field of one committed entry and its key; replay. | The message names `setHash`. | `cassette:miss-names-field` | cassette | scan,cassette,transport |
| `replay.fixture-miss-names-labeler` | 4 | Change the labeller field of one committed Haiku entry and its key; replay. | The message names `labeler`. | `cassette:miss-names-labeler` | cassette | scan,cassette,transport |
| `replay.fixture-miss-names-system-part` | 4 | Change the system part digest of one committed Haiku entry and its key; replay. | The message names `part.system` or `system`. | `cassette:miss-names-field` | cassette | scan,cassette,transport |
| `replay.fixture-miss-names-questions-part` | 4 | Change the questions part digest of one committed unit-level Jev entry and its key; replay. | The message names `part.questions` or `questions`. | `cassette:miss-names-field` | cassette | scan,cassette,transport |
| `replay.fixture-miss-names-cut-digest` | 4 | Change the cut digest field of one committed entry and its key; replay. | The message names `cutDigest` and holds the running Node and ICU versions. | `cassette:cut-digest-error-versions` | cassette | scan,cassette,transport |
| `replay.replay-env-independent` | 3 | Child replays under three TZ, four LANG values and two working folders. | Identical ledger text in all runs. | `cassette:env-independent` | cassette | transport,cassette,child |

## privacy

Level `privacy`, default component `privacy`, default needs scan, child. A planted secret in a private fixture stays in its folder: not in the cassette, not in stdout or stderr, not in a temp file, not in a request it should not be part of, and never a model key.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `privacy.secret-not-in-cassette` | 1 | Private estate with a secret in a sentence, a list item, a cell, a heading and a front matter value; record through a fake transport. | The secret is absent from the cassette. | `cassette:no-file-text` | privacy | transport,cassette,child |
| `privacy.secret-not-in-output` | 3 | Same estate; capture stdout and stderr of a successful scan and of a scan with one failing window. | The secret is absent from both streams in both runs. | `privacy:output-counts-only` | privacy | transport,child |
| `privacy.writes-stay-inside-root` | 2 | Snapshot HOME, TMPDIR, the working folder and its parents before and after a scan and an update. | Every new or changed file is under the estate root or the given ledger and cassette paths. | `privacy:writes-stay-inside-root` | privacy | scan,child |
| `privacy.ledger-only-where-asked` | 2 | Scan with the ledger path set to `<root>/ledger.json`. | No second ledger-like file (JSON with ids and quotes) exists anywhere else in the sandbox. | `privacy:writes-stay-inside-root` | privacy | scan,child |
| `privacy.model-key-never-in-outputs` | 2 | Key files with a planted key value placed under the sandbox `~/.nexus-secrets/` under four plausible names; Haiku port on a fake transport. | The key value is absent from the cassette, ledger, atoms, stdout, stderr and thrown errors. | `privacy:key-never-printed` | privacy | transport,cassette,child |
| `privacy.env-secret-not-printed` | 3 | Environment variables named like keys hold planted values; run a successful scan and a failing one. | The values are absent from every output and file. | `privacy:env-not-printed` | privacy | transport,child |
| `privacy.no-headers-in-cassette` | 3 | A transport that echoes the request headers (authorization, api-key) in its response body. | No header value appears in the cassette. | `privacy:no-headers-in-cassette` | privacy | transport,cassette,child |
| `privacy.thinking-text-not-stored` | 3 | A response with a thinking block that repeats a unit containing the secret, then the answer. | The secret is absent from the cassette. | `privacy:parsed-answer-only` | privacy | transport,cassette,child |
| `privacy.raw-response-text-not-stored` | 3 | A response whose text holds the secret next to the JSON answer. | The secret is absent from the cassette. | `privacy:parsed-answer-only` | privacy | transport,cassette,child |
| `privacy.replay-makes-no-network` | 1 | Replay a private estate with the transport closed and a socket canary that counts connection attempts. | 0 transport calls and 0 connection attempts. | `cassette:ci-mode-no-network` | privacy | transport,cassette,child |
| `privacy.fingerprints-are-hashes` | 2 | Units of 40 to 200 characters with planted tokens. | No `fp`, `ctxFp`, cut digest or key contains an 8 character substring of any unit text. | `privacy:fingerprints-are-hashes` | privacy | scan,child |
| `privacy.opaque-content-not-sent` | 3 | A fence whose 3rd line is the secret, an HTML comment whose 2nd line is the secret. | The secret is absent from every request the transport receives and from the cassette. | `privacy:opaque-content-not-sent` | privacy | transport,cassette,child |
| `privacy.request-scoped-to-window` | 3 | Two files; the secret is in file B only. | No request for file A contains it. | `privacy:request-scoped-to-window` | privacy | transport,child |
| `privacy.abs-path-not-recorded` | 2 | The estate sits under a folder named `PLANTED-USER-7q`. | That name is absent from the ledger, cassette, atoms and requests. | `privacy:relative-paths-only` | privacy | transport,cassette,child |
| `privacy.secret-in-front-matter-stays-inside` | 2 | A secret as a front matter value. | It occurs in the ledger quote and nowhere outside the root or the cassette. | `cassette:no-file-text` | privacy | transport,cassette,child |
| `privacy.secret-in-heading-stays-inside` | 2 | A secret in a heading text. | It occurs in the ledger section path only; the cassette readable fields hold no heading text. | `privacy:heading-not-in-cassette` | privacy | transport,cassette,child |
| `privacy.temp-files-removed` | 3 | Run a scan with a failing window and a successful one. | TMPDIR holds no file afterwards. | `privacy:temp-files-removed` | privacy | scan,child |
| `privacy.crash-leaves-no-secret` | 4 | The transport throws a non-JSON error that quotes the request text on the second window. | stdout, stderr, TMPDIR and HOME hold no secret; the root holds at most the ledger and a valid cassette. | `privacy:crash-path-no-leak` | privacy | transport,cassette,child |
| `privacy.error-messages-quote-no-unit-text` | 3 | A window refused twice whose units hold the secret. | The failure output names the window and the reason; the secret is absent. | `privacy:output-counts-only` | privacy | transport,child |
| `privacy.estate-files-unchanged` | 2 | Hash every private file before and after record, replay and update runs. | All hashes equal. | `ledger:estate-files-untouched` | privacy | scan,child |
| `privacy.label-set-text-only-in-requests` | 3 | A label description holding a planted phrase. | The phrase is in the request and the set hash input only; absent from stdout and stderr. | `privacy:output-counts-only` | privacy | transport,child |

## links

Level `links`, default component `links`, default needs scan, links. A link is an id plus a fingerprint; each scan says ok, suspect, advisory or ambiguous; only a mutation-verified link counts toward a claim; clearing needs a reason.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `links.ok-unchanged` | 1 | 12 rules, 8 tests with 1 to 3 links each; no edit. | Every link `ok`. | `links:fingerprint-compare` | links | scan,links |
| `links.ok-cosmetic-edits` | 2 | Rewrap, CRLF, bullet swap and renumber on the rule files. | Every link `ok`. | `links:fingerprint-compare` | links | scan,links |
| `links.suspect-reword` | 1 | Reword rule 3. | Links to rule 3 `suspect`; all others `ok`. | `links:suspect-state` | links | scan,links |
| `links.suspect-delete-unit` | 1 | Delete rule 5. | Links to rule 5 `suspect`; links to rules not next to it `ok`; links to its neighbours `ok` or `advisory`. | `links:suspect-state` | links | scan,links |
| `links.suspect-delete-file` | 2 | Delete a file holding 4 rules. | All links to those 4 rules `suspect`; others `ok`. | `links:suspect-state` | links | scan,links |
| `links.suspect-split` | 3 | Split rule 2 into two sentences. | Links to rule 2 `suspect`. | `links:suspect-state` | links | scan,links |
| `links.suspect-merge` | 3 | Join rules 6 and 7. | Links to either rule `suspect`. | `links:suspect-state` | links | scan,links |
| `links.ok-moved-in-file` | 2 | Move rule 4 to the end of its file. | Links to rule 4 `ok` or `advisory` (its neighbours changed), never `suspect` or `ambiguous`. | `links:fingerprint-compare` | links | scan,links |
| `links.ok-moved-across-files` | 3 | Move rule 4 to another file. | Links to rule 4 `ok` or `advisory` (its neighbours changed), never `suspect` or `ambiguous`. | `links:fingerprint-compare` | links | scan,links |
| `links.advisory-heading-rename` | 3 | Rename the heading above rules 8 to 10. | Links to those rules `advisory`; links to rules in other sections `ok` or, next to the heading, `advisory`. | `links:advisory-state` | links | scan,links |
| `links.advisory-neighbour-edit` | 3 | Replace the last word of the unit right above rule 9 (a unit of 100 characters or more), leaving rule 9 alone. | Links to rule 9 are `advisory` (own fingerprint equal, context changed); links to the reworded unit are `suspect`. | `links:advisory-state` | links | scan,links |
| `links.advisory-section-moved` | 3 | Move `## S` with its rules from under `# P1` to under `# P2`. | Links to its rules `advisory` (heading path changed, text same). | `links:advisory-state` | links | scan,links |
| `links.ambiguous-text-copied` | 4 | Delete rule 3 and add two exact copies of its text elsewhere. | Links to rule 3 `ambiguous`. | `links:ambiguous-state` | links | scan,links |
| `links.twin-edit-keeps-ok` | 3 | Rule 2 has an identical twin in another file; reword the twin. | Links to rule 2 `ok`. | `links:twin-edit-keeps-ok` | links | scan,links |
| `links.suspect-persists-until-cleared` | 3 | Reword rule 3, scan, scan again with no change. | Links to rule 3 `suspect` on both scans. | `links:suspect-state` | links | scan,links |
| `links.clear-records-reason` | 3 | Clear suspect links with each of `cosmetic`, `semantic-still-covered`, `test-updated`. | Each cleared link stores its reason and the current fingerprint; the next scan says `ok`. | `links:clear-with-reason` | links | scan,links |
| `links.clear-refuses-bad-reason` | 3 | Clear with no reason and with the reason `whatever`. | Both refused; the links stay `suspect` and unchanged. | `links:clear-with-reason` | links | scan,links |
| `links.verified-by-mutation` | 4 | For three links: delete the span and the test flips; delete it and the test stays; negate it and the test flips. | The first and third links get `createdBy: verified`; the second stays unverified. | `links:verified-by-mutation` | links | scan,links |
| `links.unverified-not-counted` | 3 | 10 rules; 4 with verified links, 3 with proposed links, 3 with none. | The claim counts 4 covered rules. | `links:only-verified-counts` | links | scan,links |
| `links.coverage-uncovered-set` | 3 | The same 10 rules. | The uncovered list equals the 6 rules without a verified link. | `links:only-verified-counts` | links | scan,links |
| `links.coverage-ignores-unmapped-labels` | 3 | Add 5 `example` spans (no atom mapping) with no links. | The uncovered list holds no `example` span. | `links:coverage-atom-mapped-only` | links | scan,links |
| `links.link-fields-no-offsets` | 2 | Create links through the reader. | Each serialised link has span, fp, relation, createdBy, accepted and no `start`, `end`, `hint`, `line` or `offset` key. | `links:no-offsets` | links | scan,links |
| `links.link-order-independent` | 2 | Classify the same 40 links in three orders. | Each link has the same state in all three runs. | `links:order-independent` | links | scan,links |
| `links.shared-span-all-suspect` | 2 | Five tests link to rule 3; reword it. | All five links `suspect`. | `links:suspect-state` | links | scan,links |
| `links.relation-preserved` | 2 | Links with relations `verifies`, `negates`, `example-of`, `x/y`. | The relations are unchanged after classification and clearing. | `links:relation-preserved` | links | scan,links |

## radius

Level `links`, default component `radius`, default needs scan, links. The set of tests to rerun after an edit is exactly the tests with a suspect link; section-level references are reported apart.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `radius.delete-one-rule` | 1 | 20 rules, 30 blocks with a seeded link matrix; delete one rule. | Rerun set equals the blocks linked to it. | `radius:suspect-tests` | radius | scan,links |
| `radius.negate-one-rule` | 2 | Insert `not` into one rule. | Rerun set equals the blocks linked to it. | `radius:suspect-tests` | radius | scan,links |
| `radius.reword-one-rule` | 2 | Replace one word of a rule. | Rerun set equals the blocks linked to it. | `radius:suspect-tests` | radius | scan,links |
| `radius.cosmetic-edit-empty` | 1 | Rewrap and bullet swap. | Rerun set empty. | `radius:only-suspect-links` | radius | scan,links |
| `radius.move-rule-empty` | 2 | Move a rule to another file. | Rerun set empty. | `radius:only-suspect-links` | radius | scan,links |
| `radius.rename-file-empty` | 3 | Rename a file holding 5 rules. | Rerun set empty. | `radius:only-suspect-links` | radius | scan,links |
| `radius.edit-unlinked-rule-empty` | 1 | Reword a rule with no link. | Rerun set empty. | `radius:only-suspect-links` | radius | scan,links |
| `radius.edit-two-rules-union` | 2 | Reword two rules with overlapping blocks. | Rerun set equals the union of their blocks. | `radius:suspect-tests` | radius | scan,links |
| `radius.block-with-three-links-once` | 2 | A block linked to 3 rules; reword all three. | The block occurs once. | `radius:sorted-unique` | radius | scan,links |
| `radius.block-without-links-never` | 1 | 5 blocks with no link; delete rules. | None of those 5 in any rerun set. | `radius:only-suspect-links` | radius | scan,links |
| `radius.delete-file-with-rules` | 3 | Delete a file of 4 linked rules. | Rerun set equals the union of their blocks. | `radius:suspect-tests` | radius | scan,links |
| `radius.split-rule` | 3 | Split one rule into two sentences. | Rerun set equals the blocks linked to it. | `radius:suspect-tests` | radius | scan,links |
| `radius.merge-rules` | 3 | Join two rules. | Rerun set equals the union of both. | `radius:suspect-tests` | radius | scan,links |
| `radius.advisory-same-section` | 3 | Reword one rule in a section of 6 rules. | Advisory set minus rerun set equals the blocks linked to the other 5 rules. | `radius:advisory-set` | radius | scan,links |
| `radius.advisory-excludes-other-sections` | 3 | Same edit. | No block linked only to rules of other sections is advisory. | `radius:advisory-set` | radius | scan,links |
| `radius.advisory-heading-rename` | 3 | Rename the heading above 6 linked rules. | Rerun set empty; advisory holds at least the blocks linked to those rules, and only blocks linked to those rules or to the rules next to the section. | `radius:advisory-set` | radius | scan,links |
| `radius.cleared-link-leaves-radius` | 3 | Reword rule A and scan; clear its links with a reason; reword rule B and scan. | The first rule's blocks are absent from the second rerun set. | `radius:cleared-link` | radius | scan,links |
| `radius.cross-file-blocks` | 3 | Blocks stored in 4 other files link to rules. | Rerun set equals the linked blocks in all files. | `radius:suspect-tests` | radius | scan,links |
| `radius.sequential-edits-not-cumulative` | 4 | Edit rule 1 and scan; review and accept its links again; edit rule 2 and scan. | The second rerun set holds rule 2's blocks only. | `radius:per-edit` | radius | scan,links |
| `radius.world-delete-30` | 4 | 30 rules, 60 blocks with a seeded link matrix; one delete mutant per rule (design experiment 11). | All 30 rerun sets equal the planted truth. | `radius:suspect-tests` | radius | scan,links |
| `radius.world-negate-30` | 4 | Same world, one negation mutant per rule. | All 30 rerun sets equal the truth. | `radius:suspect-tests` | radius | scan,links |
| `radius.world-mixed-precision-recall` | 5 | 100 rules, 150 blocks, 60 seeded mutants of delete, negate, reword, cosmetic and move. | Precision and recall against the planted truth are both 1.0. | `radius:precision-recall` | radius | scan,links |
| `radius.output-sorted-unique` | 2 | Any world. | Rerun and advisory lists are sorted ascending by test id and hold no duplicate. | `radius:sorted-unique` | radius | scan,links |

## scale

Level `scale`, default component `perf`, default needs scan, child. Cutting, scanning, re-anchoring, replay, links and radius stay correct and inside a time and memory budget at 10 and 100 times the size.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `scale.cut-1x` | 1 | Mixed document of 300 units. (seed-free) | Exact cut; under 1 s; peak memory under 300 MB. | `perf:cut-linear` | perf | scan,child |
| `scale.cut-10x` | 2 | Mixed document of 3,000 units over 10 files. (seed-free) | Exact cut per file; under 4 s total; under 400 MB. | `perf:cut-linear` | perf | scan,child |
| `scale.cut-100x` | 3 | Mixed documents of 30,000 units over 100 files. (seed-free) | Exact cut per file; under 25 s total; under 1.2 GB. | `perf:cut-linear` | perf | scan,child |
| `scale.scan-10x` | 3 | 3,000 units over 10 files, labeller answers the truth. (seed-free) | Ledger labels and atoms equal the truth; one call per window and set; under 8 s. | `perf:scan-linear` | perf | scan,child |
| `scale.scan-100x` | 4 | 30,000 units over 100 files. (seed-free) | Same oracle; under 60 s; under 1.5 GB. | `perf:scan-linear` | perf | scan,child |
| `scale.rescan-unchanged-100x` | 3 | Scan, then rescan with the ledger. (seed-free) | Zero labeller calls; ledger text equal; under 30 s. | `perf:rescan-linear` | perf | scan,child |
| `scale.rescan-edit-1pct-10x` | 3 | 3,000 units; reword 30, rescan. (seed-free) | Statuses exact (30 `changed`, rest `unchanged`); calls equal the dirty windows; under 8 s. | `perf:rescan-linear` | perf | scan,child |
| `scale.rescan-edit-1pct-100x` | 4 | 30,000 units; reword 300, rescan. (seed-free) | Same oracle; under 40 s. | `perf:rescan-linear` | perf | scan,child |
| `scale.rescan-move-100x` | 4 | Move 300 units to other files. (seed-free) | All 300 `moved` with their ids; under 40 s. | `perf:exact-match-index` | perf | scan,child |
| `scale.rescan-duplicates-100x` | 4 | 30,000 units of which 4,000 are the same 6 boilerplate sentences; reword 300 others. (seed-free) | Statuses exact; ids unique; under 40 s. | `perf:duplicate-index` | perf | scan,child |
| `scale.rescan-rewrite-10pct-10x` | 4 | 300 units replaced by unrelated text. (seed-free) | 300 `deleted`, 300 fresh, zero wrong anchors; under 30 s. | `perf:rewrite-pairing-candidate-pruning` | perf | scan,child |
| `scale.rescan-rewrite-10pct-100x` | 5 | 3,000 units replaced by unrelated text. (seed-free) | Same oracle; under 120 s (a pairwise scoring of all residue pairs does not fit). | `perf:rewrite-pairing-candidate-pruning` | perf | scan,child |
| `scale.ledger-canonical-100x` | 3 | Scan 30,000 units twice from scratch. (seed-free) | Identical ledger text; keys sorted; serialisation inside 10 s. | `perf:ledger-serialise` | perf | scan,child |
| `scale.links-100x` | 4 | 30,000 rules, 30,000 links, 1 percent edited. (seed-free) | States exact (300 suspect); under 20 s. | `perf:links-100x` | perf | scan,links,child |
| `scale.radius-100x` | 4 | 30,000 rules, 50,000 blocks; delete 100 rules. (seed-free) | Rerun set equals the linked blocks; under 20 s. | `perf:radius-100x` | perf | scan,links,child |
| `scale.replay-100x` | 4 | Record 30,000 units on a fake transport, replay. (seed-free) | Ledger equal to the recording run; zero calls; replay under 40 s. | `perf:replay-index` | perf | transport,cassette,child |
| `scale.long-paragraph` | 4 | A 1 MB paragraph of 12,000 sentences. (seed-free) | Exact cut of 12,000 units; under 10 s. | `perf:sentence-segmentation-linear` | perf | scan,child |
| `scale.wide-table` | 4 | 100 rows by 100 columns. (seed-free) | 10,000 cell units; under 10 s. | `perf:table-cells-linear` | perf | scan,child |
| `scale.many-small-files` | 4 | 5,000 files of 6 units. (seed-free) | Ledger holds 30,000 entries; under 60 s; under 1.5 GB. | `perf:many-files` | perf | scan,child |
| `scale.long-units-fingerprint` | 4 | 3,000 units of 5,000 characters. (seed-free) | Exact cut; under 15 s. | `perf:fingerprint-long-units` | perf | scan,child |
| `scale.memory-cut-100x` | 4 | Same as cut-100x, memory only. (seed-free) | Peak resident memory under 1.2 GB. | `perf:cut-linear` | perf | scan,child |
| `scale.memory-scan-100x` | 5 | Same as scan-100x. (seed-free) | Peak resident memory under 1.5 GB. | `perf:scan-linear` | perf | scan,child |
| `scale.growth-cut` | 5 | Cut 3,000 and 30,000 units. (seed-free) | When the 3,000-unit run takes over 0.3 s, the 30,000-unit run takes at most 40 times as long. | `perf:cut-linear` | perf | scan,child |
| `scale.growth-rescan` | 5 | Rescan 3,000 and 30,000 units with 1 percent edits. (seed-free) | The same ratio bound. | `perf:rescan-linear` | perf | scan,child |

## adversarial

Level `adversarial`, default component `scan`, default needs scan. Documents and edits aimed at the shortcut a pointer reader most likely took: a word list, a surface cue, a recursive parse without a limit, an object keyed by user text, a similarity scored against the wrong unit.

| id | tier | generator | oracle | cause | component | needs |
|---|---|---|---|---|---|---|
| `adversarial.deontic-words-labelled-none` | 2 | 30 narrative sentences, quotes and titles full of must, never, always, shall, should, required, forbidden, all labelled `none`; 10 plain statements labelled `rule`. | Exactly the 10 atoms; none from the 30. | `scan:no-word-list` | scan | scan |
| `adversarial.rule-without-deontic-words` | 2 | 20 statements such as `The till is counted twice before the shop closes.` labelled `rule`. | 20 atoms. | `scan:no-word-list` | scan | scan |
| `adversarial.rules-in-other-languages` | 3 | One rule each in French, German, Japanese, Arabic, Swahili, Russian, labelled `rule`, among English `none` units. | Six atoms with exact quotes. | `scan:no-word-list` | scan | scan |
| `adversarial.heading-decoy` | 3 | Under a heading `Rules`: descriptions labelled `description`; under `Notes`: rules labelled `rule`. | Atoms exactly the `Notes` rules. | `scan:no-heading-heuristic` | scan | scan |
| `adversarial.length-decoy` | 3 | Long sentences labelled `none`, five-word rules labelled `rule`. | Atoms exactly the short rules. | `scan:no-length-heuristic` | scan | scan |
| `adversarial.bullet-decoy` | 3 | Bulleted items labelled `none`, plain paragraph sentences labelled `rule`. | Atoms exactly the paragraph sentences. | `scan:no-bullet-heuristic` | scan | scan |
| `adversarial.bold-decoy` | 3 | Bold lead sentences labelled `none`, plain sentences labelled `rule`. | Atoms exactly the plain sentences. | `scan:no-emphasis-heuristic` | scan | scan |
| `adversarial.position-decoy` | 3 | Paragraphs of 3 sentences with only the last labelled `rule`. | Atoms exactly the last sentences. | `scan:no-position-heuristic` | scan | scan |
| `adversarial.quoted-instruction-decoy` | 3 | Block quotes holding `Never do X.` labelled `none`. | No atom from the quotes. | `scan:no-quote-heuristic` | scan | scan |
| `adversarial.example-imperatives` | 3 | Units labelled `example` (no atom mapping) full of imperatives. | No atom; ledger entries exist. | `scan:no-imperative-heuristic` | scan | scan |
| `adversarial.rules-inside-fences-and-comments` | 2 | Rule-like sentences in a fence and in an HTML comment between labelled rules. | Atoms exactly the outside rules; the planted labeller was never offered the fenced or commented text as a labelable unit. | `scan:opaque-units-not-offered` | scan | scan |
| `adversarial.mixed-decoys-100` | 4 | All the decoys above in one seeded document of 100 units. | Atom set equals the planted set (precision and recall 1). | `scan:mixed-decoys` | scan | scan |
| `adversarial.yaml-alias-bomb` | 5 | Front matter with nine levels of aliases each repeating the previous ten times, plus a normal sentence. | The scan returns inside 10 s with memory under 1 GB; the sentence is still a unit; no crash. | `cutter:yaml-alias-limit` | cutter | scan,child |
| `adversarial.yaml-custom-tags` | 4 | Front matter values tagged `!!js/function`, `!!python/object/apply:os.system`, `!!binary`, plus a canary path. | No file appears at the canary path; the scan finishes; the plain values are still units. | `cutter:yaml-safe-schema` | cutter | scan,child |
| `adversarial.deep-nested-lists` | 5 | A list nested 3,000 levels deep. | The cut returns inside 10 s with 3,000 list item units or a clear failure message for that file only; other files unaffected. | `cutter:nesting-depth-limit` | cutter | scan,child |
| `adversarial.deep-nested-quotes` | 5 | 1,000 `>` markers on one line. | Same oracle with one quote unit or a clear failure. | `cutter:nesting-depth-limit` | cutter | scan,child |
| `adversarial.binary-and-invalid-utf8` | 3 | A file of NUL bytes and invalid sequences among normal files. | The normal files are scanned exactly; the bad file is skipped with a note or cut consistently with offsets that slice the decoded text. | `cutter:invalid-bytes` | cutter | scan |
| `adversarial.bom-in-middle` | 3 | U+FEFF in the middle of a sentence and at the start of a second paragraph. | It stays in the unit text; offsets exact. | `cutter:bom-only-leading` | cutter | scan |
| `adversarial.many-empty-headings` | 3 | 5,000 lines of `#` with no text, then a sentence. | The sentence is cut exactly and heading paths hold no empty string; inside 5 s. | `cutter:empty-headings` | cutter | scan |
| `adversarial.zero-width-and-bidi` | 3 | Sentences with U+200B, U+200D, U+200E and U+202E inside words and at ends. | Exact cut; the marks stay in the raw text. | `cutter:invisible-characters` | cutter | scan |
| `adversarial.emoji-zwj-sequences` | 3 | Family and flag emoji (ZWJ and regional indicator sequences) before and after full stops. | Exact cut, offsets count UTF-16 units. | `cutter:grapheme-sequences` | cutter | scan |
| `adversarial.huge-heading-text` | 3 | Six nested headings of 10,000 characters each with a sentence below. | Exact cut; the sentence path holds six entries; ids and `ctxFp` present. | `cutter:long-headings` | cutter | scan |
| `adversarial.identical-files-100` | 4 | 100 copies of one 8-unit file under different names. | 800 distinct ids; twin marks on all copies; identical bytes on a rescan. | `ids:path-in-hash` | ids | scan |
| `adversarial.huge-single-line` | 4 | A single paragraph line of 500,000 characters with 6,000 sentences. | Exact cut inside 10 s. | `perf:sentence-segmentation-linear` | cutter | scan,child |
| `adversarial.giant-front-matter` | 4 | Front matter with 20,000 string keys. | 20,000 units, distinct paths, inside 10 s. | `cutter:large-front-matter` | cutter | scan,child |
| `adversarial.swap-texts-in-place` | 4 | Exchange the texts of two long units that sit 10 units apart; everything else stays. | Each id keeps its own text (both `moved`), neither is `changed` or `deleted`. | `anchor:exact-match-moved` | anchor | scan |
| `adversarial.swap-with-similar-neighbour` | 5 | Two units 0.75 similar to each other and adjacent; swap their positions. | Each id keeps its own exact text. | `anchor:exact-before-similar` | anchor | scan |
| `adversarial.edit-inside-duplicates` | 4 | Three identical units separated by unique units; reword the middle one. | The two untouched duplicates keep their two ids, `unchanged`; the middle one keeps its id as `changed`. | `anchor:duplicate-with-unique-anchors` | anchor | scan |
| `adversarial.hostile-file-names` | 3 | Files `__proto__.md`, `constructor.md`, `toString.md`, `a b.md`, `é.md`. | Five paths in the ledger exactly; `Object.prototype` unchanged. | `ledger:hostile-paths` | ledger | scan |
| `adversarial.label-named-like-prototype` | 4 | A set with labels `constructor`, `tostring`, `hasownproperty`; the labeller uses them. | The ledger stores each under its name; atoms follow the mapping; `Object.prototype` unchanged. | `labelset:safe-label-names` | labelset | scan |

