# Estate pointer reader

Status: revision 3. Layers A and B are built behind `driftbench estate scan --pointer` (section 14); links (layer C), the gold-set study and the removal of the word-list finder are not. It follows the research report "Pointing to exact text spans" and replaces the word-list rule finder (`candidates.ts`, `clause-rule.ts`) and the quoting model pass (`prose.ts`).

## The shape: three layers with three owners

| Layer | Owner | Job |
|---|---|---|
| A. Units, fingerprints, ledger | Code, deterministic | Cut each file into units, fingerprint them, give each a persistent id, track ids across edits. |
| B. Labels | A labeler (a model), recorded | Say which label from a user-declared label set applies to each unit. Returns names and unit numbers only. |
| C. Links | People and tests | A test or block links to a span by ledger id plus the fingerprint it was reviewed against. |

Three rules hold the layers apart:

- The labeler never writes text and never decides whether a span changed. Code copies every byte of text from the file.
- Code never decides whether a sentence is a rule. No word list, phrase pattern or grammar tagger is used anywhere.
- Change detection never depends on the labeler. A model that stops selecting a unit on a re-record produces a `label_flip` diagnostic, never a false `deleted`.

The core is generic. It knows units, labels, fingerprints, ledgers, cassettes and links. It contains no estate, agent or Nexus word. Estates are one label set that ships as data (section 1).

## 1. Label sets are user configuration

"Rule, gate, example" is one way of labelling prose. A label set is a named list of labels the user declares and describes. Labels are data, not code.

```text
# driftbench.estate.yaml (or a file named by `labels: path` in it)
labels:
  - set: agent-rules            # shipped as the default set for agent estates
    description: What an instruction file asks of the agent.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: gate
        description: A unit that sets an order, one act before another.
        target: required        # the labeler also names the unit that holds the other end
        atom: { kind: gate }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.

  - set: house-voice            # a user's own set, on the same units
    description: How a style guide for a bakery's customer emails is written.
    labels:
      - name: voice-rule
        description: A unit that fixes a tone or a word choice for customer emails.
        examples:
          - "Write as if you were speaking over the counter."
          - "Say 'loaf', never 'unit'."
      - name: claim-needs-source
        description: A unit that states a fact about an ingredient, a price or an allergen.
      - name: legal-line
        description: A unit that must appear word for word in a message.
        examples:
          - "Allergen details are on the label."
```

Fields:

| Field | Meaning |
|---|---|
| `set` | The set's name. Unique in the file. |
| `labels[].name` | Lower-case identifier the labeler may return. `none` is reserved and always allowed. |
| `labels[].description` | One or two sentences. Becomes part of the labeler's prompt. |
| `labels[].examples` | Optional. Up to three short strings shown to the labeler. They are user text, not repo text. |
| `labels[].target` | Optional: `required` when the label links two units (a gate). Default: none. |
| `labels[].atom` | Optional. If present, a unit with this label becomes an estate atom of this kind (and polarity). A label without `atom` is stored in the ledger and can be linked to tests, but builds no atom. |

Rules:

- The labeler's prompt is generated from the set name, its description, and the label names, descriptions and examples. Its answer is limited to the names in the set plus `none`.
- Several sets may label the same units. Each set is labelled in its own request and stored apart in the ledger (section 4).
- Each set has a **set hash**: the hash of its canonical form (names, descriptions, examples, targets, atom mappings). The set hash is part of the cassette key. Editing one label of one set changes only that set's hash, so only that set is re-labelled; other sets and the units' ids are untouched.
- The default `agent-rules` set above is data in a shipped file, loaded the same way as a user set. No label name is known to the core.

## 2. Layer A: cutting

Code reads each prose file (standing instructions, memory, skill bodies and files, helper bodies, and any file the user names for a set) and cuts it into units.

Parser and offsets:

- Parse with `unified`, `remark-parse`, `remark-gfm` and `remark-frontmatter`. Every node carries UTF-16 start and end offsets; a unit's text is always `source.slice(start, end)`, never a node's `value` (a blockquote's value drops the `> ` markers).
- A leading byte-order mark is stripped and its length recorded as a base offset, so every offset still points into the original file.

Units:

| Container | Rule |
|---|---|
| Sentence | Prose is masked (inline code, URLs and link destinations become same-length placeholders; newlines become spaces), segmented with `Intl.Segmenter`, and the indices are mapped back. When unsure the cutter merges: a wrong merge costs granularity, a wrong split costs a wrong quote. |
| List item | One unit per item and per nested item. A wrapped item is one unit. |
| Table cell | One unit per cell, spanning its text (not the pipes). The row's header cell is shown with it as display-only context. |
| Block quote | One unit per paragraph, offsets covering the text after the `>`. |
| Heading | One unit per heading. Headings also form the heading path of every unit under them. |
| HTML block | Blocks such as `<role>...</role>` are parsed inside: the markdown within is cut into units like any other prose. |
| Front matter | Each string value is a unit keyed by its YAML path (a skill's `description`, for example). Structure keys are not units. |
| Fence and comment | Opaque: one unit each, shown to the labeler as the fence kind and its first line only. A label cannot be pointed at it. |

Every prose character belongs to exactly one unit. Spans never overlap.

**Cut digest.** The cutter hashes the ordered list of unit fingerprints into a digest and stores it. Replay recomputes the cut and compares digests. A mismatch stops with an error that names the Node and ICU versions, so a cutter that varies between environments fails loudly instead of renumbering silently. Experiment 6 decides whether `Intl.Segmenter` may stay or a deterministic splitter must ship.

### Example

File `.claude/skills/shelf-audit/SKILL.md` (fictional):

```
# Shelf audit

**Keys.** A key opens one door. Return every key before you leave.

- Count the till twice
- Never leave the desk unattended

Read `references/closing.md` before you lock up.
```

Units as the cutter builds them (offsets illustrative):

```json
{
  "file": ".claude/skills/shelf-audit/SKILL.md",
  "cutDigest": "5d1c…a0",
  "units": [
    { "n": 1, "container": "heading", "span": [0, 13], "fp": "9f2e…", "path": [] },
    { "n": 2, "container": "sentence", "span": [15, 24], "fp": "1b77…", "path": ["Shelf audit"] },
    { "n": 3, "container": "sentence", "span": [25, 48], "fp": "c04a…", "path": ["Shelf audit"] },
    { "n": 4, "container": "sentence", "span": [49, 78], "fp": "77d3…", "path": ["Shelf audit"] },
    { "n": 5, "container": "list_item", "span": [82, 105], "fp": "e5b0…", "path": ["Shelf audit"] },
    { "n": 6, "container": "list_item", "span": [108, 140], "fp": "0a9c…", "path": ["Shelf audit"] },
    { "n": 7, "container": "sentence", "span": [142, 190], "fp": "4be8…", "path": ["Shelf audit"] }
  ]
}
```

The number `n` is a display handle inside one request. It is not an identity (section 4).

## 3. Layer B: the labeler port

A labeler is a port with one input and one output, the same for every implementation:

```
label(window, labelSet) -> { labels: [{ units, label, target? }], meta }
```

- Input: a window of numbered units (below) and a label set.
- Output: for every unit of the window, one label name from the set or `none`. Ranges (`5-6`) are allowed. Nothing else: no text, no ids that are not in the window.

### Window

A window is a heading-bounded run of units that stays under 100,000 tokens. A file is one window if it fits; otherwise it is split at headings. Units of neighbouring windows may appear as context-only lines (not labelable). The window prints each unit as `[n] text`, with the heading path as non-selectable lines.

```
SET house-voice
LABELS voice-rule | claim-needs-source | legal-line | none
WINDOW emails.md#2  path: Customer emails > Tone
[12] Write as if you were speaking over the counter.
[13] Say "loaf", never "unit".
[14] Allergen details are on the label.
[15] Our rye loaf uses stone-ground flour.
```

Answer (dense: every unit once, ranges allowed):

```json
{
  "window": "emails.md#2",
  "set": "house-voice",
  "labels": [
    { "units": "12-13", "label": "voice-rule" },
    { "units": "14", "label": "legal-line" },
    { "units": "15", "label": "claim-needs-source" }
  ]
}
```

For a label with `target: required` the entry carries `"target": <n>`.

Why dense: each unit is considered, a missing unit shows as a gap (`unlabeled`), and a file with no rule looks different from a file the model skipped. Cost stays small (a few tokens per unit).

### Implementations

| Labeler | How it answers | Notes |
|---|---|---|
| Haiku (`claude-haiku-5-5`) | One request per window and set; JSON with an enum of the set's names; response blocks read by type (thinking blocks may precede the text). Temperature cannot be pinned, so determinism lives in the cassette. | Key read by path from `~/.nexus-secrets`, never printed. |
| Jev (system 1, `packages/judges/src/clients/system1.ts`) | A yes/no probability model: one binary question per (unit, label), 5 questions per unit for a 5-label set. One call carries a batched window of 30 to 50 numbered units (150 to 250 questions). The port takes the label with the highest probability above a threshold chosen per window shape, else `none`, and handles ranges by labelling units singly. Two states exist: `jev` (the state is the numbered window with its heading path; one request per window and set, split only when units times labels pass the cap) and `jev-unit` (the state is one unit with all its labels as questions; one request per unit). Questions are keyed `u<n>__<label>`. | The probabilities are kept in the cassette so the threshold can change without a re-record. Call shape, cap, window size, id form and threshold are measured on one planted estate (section 10a); the settings below follow from those numbers. |
| Replay | Reads a cassette; no network. | Used by CI and validators. |
| Planted | Built by a validator from the labels it planted. | Tests the cutter, ledger and parser with no model. |

Haiku and Jev see the same numbered units and return the same shape. Both are recorded in the same cassette format (section 5).

### Jev settings (measured, section 10a)

Measured on one fictional estate with gold written by the helper (395 units, 5 labels, `jev-1.13.0`). The numbers show a direction, not a calibrated default. Section 10a holds the tables.

- **Batched windows of 150 to 250 questions.** A call with 30 to 50 numbered units and all 5 label questions each scored 86.8 and 86.3 accuracy. A window of 20 units scored 84.9, one unit per call 77.8. The estate took 8 to 14 calls, against 395 for one unit per call. The Jev window is sized by question count, not by the 100,000 token bound above.
- **Cap of 1,300 questions per call with normal question text.** 1,300 answered and 1,350 was refused with HTTP 400 `max_tokens_exceeded`. A refused call returns no answer at all, and the refusal does not follow request bytes. Accuracy does not rise above 250 questions, so the port stays at 150 to 250 and halves the window on a 400.
- **Flat labels, not a tree.** A two-level tree took 41 calls against 20 for the flat form, scored 84.1 against 84.9, and agreed less between runs (kappa 0.927 against 0.959).
- **The label wording is the largest lever.** Two wordings of the same five definitions moved accuracy by 13 points (71.7 and 84.9). The exclusive wording, where each definition rules out the others, is the better one. Label descriptions are therefore the quality surface of a label set (section 1), and experiment 15 keeps the builder text generic around them.
- **Any short numeric tag works as the display handle.** `[12]` scored 84.9, `<s12>` 85.0, the ledger id 84.5. The bare number scored 80.8 and quoting the unit text in the question 81.9. No id was invalid or missing in any arm. Code maps the window number back to the ledger id.
- **The threshold is set per window shape.** For windows the best value is 0.4 (88.2 at 150 questions). For one unit per call it is 0.7. The port stores the probabilities and the threshold is a setting of the shape.
- **Label from the highest probability.** The rule "first label above the threshold in a fixed order" scored 81.9 against 84.9.
- **Linking is a separate pass.** Filter units by label (rule, prohibition or gate), then send one call per block asking for each kept unit, and accept a link at probability 0.8 (F1 85.8). Its links are proposals only: section 7 counts a link towards a claim once a mutation has verified it.

### Validation of an answer

Code refuses, with a listed reason:

1. An answer that is not the agreed JSON, is for another window or set, or stopped at `max_tokens` or a refusal.
2. A label name not in the set, a unit number not in the window, a range that leaves the window, or a `target` on a label without `target: required` (or missing on one with it).
3. A label on an opaque or context-only unit.
4. An overlap: a unit named twice.

A refused answer is retried once, then recorded as a failed window. A unit missing from an accepted answer is `unlabeled`, listed, and gets no atom.

## 4. Layer A: the ledger

Unit numbers change with every edit. The ledger gives each unit a stable identity and remembers what each set said about it.

- **Id.** One id per unit that is labelled or linked: the first ten base32 characters of the hash of (estate key, path, fingerprint, occurrence index), minted once and then persisted and never recomputed. Derivation keeps independent clones consistent; persistence keeps the id after edits.
- **Fingerprint.** NFC-normalised text, white space collapsed, container markers (bullets, `>`, pipes) stripped. Case and emphasis are kept, because prompts use capitals and bold for force. No NFKC.
- **Sidecar.** The ledger is a committed file beside the estate (for example `driftbench.ledger.json`), canonical sorted JSON with no timestamps. The estate's own files are never changed by the scan. `scan --update` writes it; `scan --check` fails in CI when files changed but the committed ledger did not, like a lockfile check.

Entry:

```json
{
  "id": "k7m2q9x4ab",
  "path": ".claude/skills/shelf-audit/SKILL.md",
  "sectionPath": ["Shelf audit"],
  "container": "list_item",
  "fp": "0a9c…",
  "ctxFp": "d3f1…",
  "quote": "- Never leave the desk unattended",
  "prefix": "- Count the till twice\n",
  "suffix": "\n\nRead `references/clo",
  "hint": { "start": 108, "end": 140 },
  "status": "live",
  "labels": {
    "agent-rules": { "label": "prohibition", "source": "cassette:3fa1…", "setHash": "c9e0…" }
  },
  "lineage": [{ "scan": 4, "event": "unchanged" }],
  "twinOf": null
}
```

`twinOf` marks identical boilerplate in another file so duplicates are not confused with moves.

### Re-anchoring on a changed file

Cheapest first, on units:

1. A histogram diff of the old and new unit sequences fixes the unchanged anchors (`unchanged`).
2. Exact text elsewhere in the file or estate, above a length floor: `moved`; several matches: `ambiguous` (all kept, as the W3C model says).
3. The residue is scored pairwise: 0.6 × normalised Levenshtein on text plus 0.4 × context similarity (prefix, suffix, heading path). A pair is accepted as `changed`, with its score, only when the score is above the threshold (starting value 0.45) **and** the text similarity alone is above a floor (starting value 0.4). Without the floor, context alone carries a fully rewritten unit over the threshold: the offline run mapped 47 of 50 large rewrites to the old unit (experiment 9 results).
4. A new unit whose neighbours' concatenation scores higher than either alone: `split`; the reverse: `merged`.
5. Nothing clears the threshold: `deleted`; the quote is kept and the link falls back to the section.

CRDT-style ids are not used: the files are rewritten by git, formatters and models, which produce no operations.

## 5. Cache and cassette

Determinism lives entirely in the cassette, because the models cannot be pinned to temperature zero.

- **Key.** SHA-256 of the canonical request (model, system, messages, output settings, `max_tokens`, thinking setting). The request already contains the label-set text, so the **label-set hash is in the key**. Editing a label re-labels only under that set.
- **Readable fields** beside the key, so a miss can name what differs from the nearest entry: file, window, prompt version, schema version, set name and hash, labeler id, **cut digest**.
- **Stored answer.** The labels, the returned model id, `stop_reason`, usage, and for Jev the per-question probabilities. No file text is stored.
- **Modes.** CI mode fails on a miss (no network). Record is explicit. Entries never expire. A returned-model mismatch on re-record warns.
- **Seam.** The model port's HTTP `fetch` is the single recording seam.
- **Where.** Fixture estates commit `examples/estates/<name>/cassette.jsonl`. Private estates keep theirs in an uncommitted `.cache/` folder.

### Windows and carry-forward

The cache entry is per window, not per file. After re-anchoring, a unit whose fingerprint and context fingerprint are unchanged keeps its recorded label for each set, with no call. Only dirty windows are sent, with their unchanged neighbours marked context-only so the labeler labels only new or changed units. A context change that should flip a label is the stale-label risk; the context fingerprint is meant to catch it (experiment 7 measures it).

## 6. From labels to atoms

For a label with an `atom` mapping, code builds the estate atom:

- `kind` and `polarity` from the mapping. `provenance`: file, line span, and the verbatim `source.slice` of the unit (for a gate: the text of both units in file order).
- `producedBy: model`, `approved: false`, `fields.extraction: pointer`, `fields.unit` (the ledger id), `fields.labelSet`, `fields.cassette` (the key).
- `evidence`: one `custom` predicate `prose_pointer` with `reviewRequired: true`. The labeler does not write evidence.
- A unit that a code reader already turned into an atom is shown to the labeler as `read` and cannot be labelled again.

A label without an `atom` mapping builds no atom. Its ledger entry exists so a test can link to the span.

## 7. Layer C: links and monitoring

A test or block links to a span with `{ span: <ledger id>, fp, relation, createdBy, accepted }`. `fp` is the span fingerprint at the last accept; offsets are never stored in a link. Each scan classifies every link:

| State | Meaning |
|---|---|
| `ok` | The span's fingerprint matches. |
| `suspect` | The span is changed, split, merged or deleted. |
| `advisory` | Only the context fingerprint or the heading path changed. |
| `ambiguous` | The span matches in several places. |

The **blast radius** of an edit is the set of tests with `suspect` links, plus a separately reported advisory set (tests linked to the same section) for references a precise link may hide ("except as described above"). Only links with `createdBy: verified` count towards a claim; a link becomes verified by mutation (deleting or negating the span flips the test). Clearing a suspect link records a reason (`cosmetic`, `semantic-still-covered`, `test-updated`). Coverage reports the inverse: spans labelled with an `atom` mapping and no verified link.

## 8. How the validators replay it

- Validators never call a model and never read a key. They run `estate scan --replay <cassette>` on committed fixture cassettes, and on planted estates for which the validator writes the labels itself (so the cutter, ledger and parser are tested without mirroring a model's mistakes).
- The cutter, ledger and parser are pure functions of files, previous ledger and cassette. The same inputs give the same ledger and map, byte for byte (experiment 12).
- A changed prompt, schema, set, model, cutter or fixture file changes the key. A stale cassette is refused and the field that differs is named. Re-recording is one reviewed commit whose diff is the label changes.
- No validator item depends on a cassette that the item itself produced.

## 9. What it replaces

| Today | With the pointer reader |
|---|---|
| `candidates.ts`, `clause-rule.ts` (grammar and word lists) | Removed. Structure cuts; a labeler labels. |
| `prose.ts` (the model quotes text and writes evidence) | Replaced. The labeler returns names and numbers; code copies and builds evidence. |
| `estate scan --no-model` code-found candidates | Structured atoms only, as before the candidate pass. Prose atoms need a cassette or a labeler. |
| Cache keyed on chunk text | Cassette keyed on the whole request; carry-forward by unit fingerprint. |
| Atom ids from a slug of the title | The existing id scheme for atoms; the ledger id in `fields.unit` for tracking. |

Structured readers (frontmatter, settings, registries, routing tables, fixed-form gates, references, hazards) are unchanged.

## 10. Experiments

All use one gold set: 40 prompt and agent files from several estates, with span-level labels by two annotators, **inter-annotator agreement reported before any model score**. A subset has at least 100 commits of edits labelled for span transitions. Thresholds are starting values set before any run. Offline experiments make no model call.

| # | Hypothesis | Experiment | Falsified if | Cost |
|---|---|---|---|---|
| 1 | Plain integer ids give fewer invalid ids than prefixed forms; dense beats sparse. | Gold set, 3 runs, arms `12`, `L12`, `[12]`, `<s12>`, dense. | Arms differ by under 2 F1 and invalid ids under 1%. | ~600 calls |
| 1 (Jev side) | Done for Jev on the planted estate (section 10a): `[12]`, `<s12>` and the ledger id are within 0.5 points, the bare number is 4 points lower. No invalid id in any arm. The Haiku side and the gold set are still open. | Planted estate, 3 runs per arm. | Not applicable (measured). | Spent |
| 2 | Id-only labelling is within 3 F1 of quote-then-locate and of Citations, at lower cost. | Three pipelines on the gold set. | Either alternative wins by over 3 F1 at under 3x the cost. | ~400 calls |
| 3 | 95% of gold boundaries coincide with unit boundaries; under 15% of rules span several units. | Offline: cut the gold files. | Alignment under 95%. | Offline |
| 4 | Under 5% of gold rules sit in regions kept opaque. | Offline: count by region. | Any region over 5%. | Offline |
| 5 | Masked `Intl.Segmenter` agrees with hand cuts on 95% of boundaries; wrong splits under 2%. | Offline: 200 paragraphs hand cut. | Wrong splits over 2%. | Offline |
| 6 | The cut digest is identical across Node and ICU builds. | Offline: Node 20, 22, 24, small-icu, 200 files. | Zero files differ (then a version stamp is enough). | Offline |
| 7 | One recorded pass is stable (Jaccard 0.9 across runs); window carry-forward keeps unrelated flips under 1%. | 10 live runs per file; 100 edits; file-keyed against window-keyed. | Agreement under 0.9 (then majority of 3). | ~1,500 calls |
| 8 | Large windows fail more; integer enums cut invalid ids. | Sweep window size and selection ratio. | Range check alone leaves under 0.5% invalid. | ~300 calls |
| 8 (Jev side) | Done for Jev on the planted estate (section 10a): accuracy peaks at 150 to 250 questions per call, a hard cap sits at 1,300, and no answer below the cap was invalid. The Haiku side is open. | Planted estate, 9 window sizes from 25 to 1,250 questions. | Not applicable (measured). | Spent |
| 9 | The ladder gets 90% of units in the right class, zero wrong anchors on unambiguous cases, 15 points over diff alone. | 50 synthetic edits per class plus the labelled history; threshold sweep 0.3 to 0.7. | Any wrong anchor on an unambiguous case. | Offline |
| 10 | The normaliser flags under 2% of cosmetic commits and never merges a semantic flip. | Offline over history; 200 minimal mutations. | A semantic miss, or cosmetic suspects over 2%. | Offline |
| 11 | Verified span links give blast-radius precision and recall of 0.8 against a full rerun. | 30 spans, 3 mutants each. | Recall under 0.8 and advisory links do not help. | ~90 suite runs |
| 12 | Cassette replay is byte-identical, and a one-field change misses and names the field. | Offline: replay twice, perturb each key field. | Any difference or silent hit. | Offline |
| 13 | **Jev against Haiku** on the same labelled set: accuracy, cost, speed and run-to-run agreement. **Status: the Jev side ran on the planted estate (section 10a). On the fictional fixture all three arms ran once against a coarse reference (section 14); the gold-set comparison has not run.** | Same units and sets, three arms, 3 runs each: Haiku (one dense request per window), Jev with window state (one request per window and set) and Jev with unit state (one request per unit, all labels as questions), so the window state is measured against the unit state; Jev with its probability threshold swept. Metrics: per-unit accuracy and F1 against gold, cost per file, wall time per file, pairwise agreement across runs. | Reported, not falsified: it decides which labeler is the default and whether Jev needs a calibration step. | ~600 calls each |
| 14 | Editing one label re-labels only under its set. | Offline with a fake labeler: edit one label of one of two sets. | Any call under the unedited set, or any unit id change. | Offline |
| 15 | The labeler prompt generated from a set is generic: the same prompt text builds for an agent set and a bakery style set. | Offline: build prompts for both sets and check no estate word is in the template. | A fixed word in the template. | Offline |

Order: offline first (3, 4, 5, 6, 9, 10, 12, 14, 15), then the pointing experiments (1, 2, 7, 8, 13) before the schema is frozen, then 11. No paid run starts without approval.

## 10a. Offline results so far (prototype in `research/pointer-reader/`)

The table below ran on a throwaway prototype, with no model call. The Jev measurements after it are live recorded calls (subsection "Jev measurements"). Nothing here is the gold-set study: experiments 3 and 4 wait for the two-annotator gold set, and the gold in 5 and 9 is built by construction from hand-written sentences and synthetic edits, so the numbers show what the machinery can do on cases the author thought of.

| # | Result |
|---|---|
| 5 | 200 paragraphs, 629 gold sentence boundaries (half hard-wrapped at 50 columns). Raw `Intl.Segmenter`: recall 95.9%, precision 77.4% (176 wrong splits, 22.6%). Masked plus shape merge: recall 95.7%, precision 97.4%, wrong splits 16 (2.6%), all of them "Prof. Ito" (a four-letter title; a shape rule cannot tell it from an ordinary word before a full stop). The falsifier (wrong splits under 2%) is missed by that one case. Missed boundaries (4.3%) are sentences that start in lower case ("iOS ..."), which the merge rule joins to the previous sentence. |
| 6 | 108 markdown files, 25,195 units, cut under Node 24.18 (ICU 78.3, Unicode 17.0) and Node 22.18 (ICU 77.1, Unicode 16.0): 0 files differ in cut digest. Only these two builds exist on this machine; Node 20 and a small-icu build are untested. |
| 9 | 9 edit classes x 50 synthetic edits on 11 real files (450 edits). As written (0.6 text + 0.4 context, threshold 0.45): accuracy 89.6%, **47 wrong anchors**, all large rewrites mapped to the old unit by context. With a text-similarity floor of 0.4: accuracy 100%, 0 wrong anchors, 0 false deletes. Diff-only baseline (unchanged plus exact moves): 66.7%, 150 false deletes (small rewords, splits, merges). Threshold sweep with the floor: 0.3 and 0.6 give 100%; 0.7 gives 94.9% with 19 false deletes and 4 wrong anchors. Floor sweep at 0.45: 0.3 leaves 4 wrong anchors, 0.5 gives 100%. The small reword here is one or two words; a meaning-preserving rewrite with many changed words is not in the set. |
| 10 | 200 rules (sentences and list items holding must, never, always, should, only, before, after, every) x 5 cosmetic edits and 8 semantic edits. Fingerprint as designed (NFC, white space, container markers stripped, case and emphasis kept): 2 of 1,000 cosmetic edits flagged (both a CRLF rewrap that put "- " or "1. " at a line start, which marker stripping erases), 0 of 663 semantic edits missed. Case-folded: 0 flagged, **82 of 663 missed** (all capitalisation flips). Case-folded and emphasis stripped: 97 of 663 missed (82 capitalisation, 15 removed emphasis). Bullet swap and renumbering through the cutter: 0 of 200 flagged. |
| 12 | Recording the fixture (5 files, 2 sets, 20 windows) and replaying it twice in CI mode gives the same 43,303-byte ledger as the recording run; a second independent recording dumps a byte-identical cassette. Six perturbations (a label description, a renamed label, an added example, a changed unit, a new file, a tampered cut digest) all missed, and the miss named the differing field (`setHash`, `part.user`, `part.output`, `cutDigest`). |
| 14 | Editing one label of the `agent-rules` set: 10 labeler calls (one per `agent-rules` window), 0 for `house-voice`; every unit id and every `house-voice` label unchanged. |
| 15 | The system text and the user text outside set-derived lines are identical for the `agent-rules` and the `house-voice` set, and contain none of the words estate, agent, skill, nexus, claude, driftbench, helper, prompt, rule, gate, instruction, bakery, email. |

Findings that change the design:

- The ladder needs the text-similarity floor above (section 4).
- The cutter must stop recursing into HTML blocks: an `<role>` line that is not a tag-only line re-parses as the same HTML block. The prototype cuts nested HTML at depth 2 as opaque.
- The fingerprint's container-marker stripping erases a real "- " or "1. " that a hard wrap puts at a line start. It is rare (0.2%) and errs towards a suspect link, not a missed change.

### Jev measurements (research/jev-id-experiments, 5f985e100)

Full tables, run files and the recorded answers are in `research/pointer-reader/jev-experiments/RESULTS.md` on that branch. All numbers below come from that file.

**Caveats that bind every number here.**

- One fictional estate (a bakery, 13 files, 395 planted units, 20 test blocks with 37 true links), written by one person.
- The gold labels were written by the helper, then changed once after it saw Jev's errors (25 units relabelled, the question text unchanged). Against the first gold the three main arms score 2 points apart and no ranking changes.
- The label definitions were rewritten once after the first run. The 13-point wording effect below compares the first wording with the rewrite, so part of it is the author learning where Jev failed.
- The units are short imperative sentences. Real prose, several estates, units longer than a sentence and other label sets are not covered.
- Haiku was not run. There is no Jev against Haiku comparison (experiment 13).
- No USD cost is known, because no Jev price is on file. Measured use was 9,206,100 tokens in and 3,345,114 out over 2,405 answered requests.

**Window size (5 labels per unit, threshold 0.5, accuracy %, Macro F1 in brackets).**

| Questions per call | Calls for 395 units | Accuracy (F1) |
|---|---|---|
| 5 (one unit) | 395 | 77.8 (79.4) |
| 25 | 79 | 83.9 (82.8) |
| 100 | 20 | 84.9 (84.5) |
| 150 | 14 | 86.8 (87.2) |
| 250 | 8 | 86.3 (87.1) |
| 400 | 5 | 85.8 (86.8) |
| 1,250 | 2 | 83.4 (85.4) |

**Cap.** 1,300 questions per call answered with the normal question text, and 1,350 was refused (HTTP 400 `max_tokens_exceeded`, no partial answer). One-line questions went to 2,500 and were refused at 3,000. The refusal does not follow request size or output tokens, and the rule was not isolated. Below the cap, 0 answers were invalid or missing in every arm.

**Design choices.**

| Choice | Result |
|---|---|
| Label wording | First wording 71.7 accuracy, rewritten exclusive wording 84.9. |
| Flat labels against a two-level tree | 84.9 in 20 calls against 84.1 in 41 calls. |
| Id form (20-unit window) | `<s12>` 85.0, `[12]` 84.9, ledger id 84.5, quoted text 81.9, bare number 80.8. |
| Threshold | 20-unit window and 150-question window best at 0.4 (86.3 and 88.2). One unit per call best at 0.7 (81.0). |
| Decoding | Highest probability 84.9, fixed-order first-above-threshold 81.9. |
| Agreement between runs | 94 to 98% of units get the same label in two runs (kappa 0.93 to 0.97). Averaging 3 runs did not help the best arm (87.1 against 86.8). |

**Where it errs (150 questions per call, run 1).** Prohibition (F1 95.2) and example (93.3) are easy. A gate called a rule is the largest confusion (12 of 46 gates); gate recall is 71%. Descriptive table cells and headings fall between description and none (11 of 124 description units became none).

**Linking (20 blocks, 37 true links, one call per block, F1 at 0.8).**

| Pool sent for each block | Calls | F1 at 0.8 |
|---|---|---|
| All 395 units | 20 | 79.3 |
| All units, 100 per call | 80 | 81.3 |
| Units labelled rule, prohibition or gate by the labeler (155 to 159 kept) | 14 labelling + 20 linking | 85.8 |
| Units with the gold labels (upper bound only) | 20 | 90.1 (91.5 at 0.7) |

Sending the whole estate at 0.5 gives recall 95% and precision 35%, because Jev says yes to many neighbours. The probability threshold, 0.8, matters more than the pool.

**Run time.** 395 units took 22 to 23 s at one unit per call, 3.8 s at 150 questions per call (14 calls, one at a time) and 2.7 s at 250 (8 calls, one at a time).

Cost on the fixture (13 files that go to the model today): 8,384 characters of prose, 149 units (14 headings, 37 sentences, 40 list items, 30 table cells, 28 front-matter values), 18 windows, 22,450 request characters for one set. That is about 5,600 input tokens by the characters-divided-by-four rule, so about $0.0006 on the Haiku 5.5 input price the research report gives ($0.10 per million tokens, not re-checked). The provider's own token count replaces the estimate before any run.

## 11. Model, key and cost

- Haiku: `claude-haiku-5-5`, key read by path from `~/.nexus-secrets`, never printed or put in a recording.
- Jev: `JEV_URL`, `JEV_API_KEY` and `JEV_MODEL` as the judges package reads them.
- The fixture today sends 13 prose chunks of 6,649 characters to the model. The pointer reader sends the same prose with a number per unit. Before any spend I report unit count and request characters for the fixture, a token count with the provider's counting call (no generation), and the cost on the live price list; the private estate is sized by counts only.

## 12. Open questions

- Whether `Intl.Segmenter` is deterministic enough (experiment 6).
- Whether Jev's per-unit binary questions can match Haiku's single dense pass on accuracy, and at what cost (experiment 13).
- Whether a gate may target a unit in another file of the skill.
- How the reviewer sees `description`-like labels without an atom mapping.
- Whether the advisory (section-level) set is worth its noise (experiment 11).

## 13. Build order

1. Unit cutter, fingerprints, cut digest; experiments 3 to 6.
2. Ledger with the ladder and `scan --check`/`--update`; experiments 9, 10.
3. Cassette, replay seam, planted labeler; experiments 12, 14, 15.
4. Label sets, prompt builder, Haiku port, window carry-forward.
5. Links and blast radius.
6. Jev port; experiments 1, 2, 7, 8, 13.
7. Remove the word-list finder and its tests; move the corpora into labeler tests.

## 14. What is built

Behind an opt-in flag, `driftbench estate scan <root> --pointer --cassette <file> [--record] [--labeler haiku|jev|jev-unit] [--labels <file>] [--ledger <file> [--ledger-check]] [--labeler-threshold <p>]`. Code is in `packages/estate/src/pointer/` (cutter, ledger, cassette, label sets, labelers, scan, atoms) and `packages/cli/src/commands/estate-pointer.ts`. Without the flag the scan is as before.

| Part | State |
|---|---|
| Cutter, fingerprint, cut digest | Built. No word list: sentence breaks come from `Intl.Segmenter` over masked text, merged by shape only. |
| Ledger with the ladder (unchanged, moved, ambiguous, changed, split, merged, deleted) and `--ledger-check` | Built, with the text-similarity floor of section 4. |
| Cassette keyed by the whole request, readable fields, a miss that names the differing field | Built. One cassette file per labeler arm. |
| Label sets as data, the shipped `agent-rules` set loaded by the same parser | Built. |
| Haiku port (`claude-haiku-5-5`, one dense request per window and set, hidden reasoning off) | Built. |
| Jev port, window state and unit state | Built. Questions keyed `u<n>__<label>`; the probabilities are recorded, so the threshold is a replay setting. |
| Atoms from labels (quote and lines are `source.slice` of the file, one reviewed `prose_pointer` check) | Built. A gate takes the quote from its first to its second unit. |
| Window halving on a refused Jev call | Built. |
| Links and blast radius (layer C), `scan --update` | Not built. |
| Removal of `candidates.ts`, `clause-rule.ts`, `prose.ts` | Not done: the flag is opt-in. |

### Fixture recording (fictional Northwind estate, one run per arm)

Haiku `claude-haiku-5-5`, 154 units in 14 files, 18 windows (Jev window state: 19, because its cap is 250 questions), hidden reasoning off. Before hidden reasoning was turned off, one window stopped at the 2,048-token limit while it was thinking; the recorded run has none.

| Arm | Requests | Tokens in / out | Cost (USD) |
|---|---|---|---|
| Haiku, dense window | 18 | 9,597 / 1,867 | about 0.0019 |
| Jev, window state | 19 | not reported by the endpoint | not on file |
| Jev, unit state | 154 | not reported by the endpoint | not on file |

The Haiku price is derived from the recorded receipts of the repository (USD 0.10 per million input tokens and 0.50 per million output tokens fit three receipts to four digits). Three earlier runs while fixing the request (hidden reasoning, an echoed window id that the model did not return) cost about 0.0067 more. No Jev price is on file.

Reference for the next table: the 57 prose atoms of the fixture map that its author approved. It is coarse: a pointed atom counts as right when its lines overlap an approved atom, and an approved atom counts as found when a pointed atom overlaps it. It is not the gold set of section 10.

| Arm (threshold) | Atoms built | Overlap an approved atom (precision) | Approved atoms found (recall) |
|---|---|---|---|
| Haiku | 58 | 55 (94.8%) | 53 of 57 (93.0%) |
| Jev window state (0.4, the default) | 79 | 60 (75.9%) | 55 of 57 (96.5%) |
| Jev window state (0.7) | 68 | 56 (82.4%) | 54 of 57 (94.7%) |
| Jev window state (0.9) | 32 | 31 (96.9%) | 35 of 57 (61.4%) |
| Jev unit state (0.7, the default) | 79 | 54 (68.4%) | 52 of 57 (91.2%) |
| Jev unit state (0.9) | 23 | 23 (100%) | 25 of 57 (43.9%) |

Agreement on the 154 units: Haiku and Jev window state 35.7% on the exact label and 88.3% on rule-or-not; Haiku and Jev unit state 46.8% and 85.7%; the two Jev states 47.4% and 89.6%. The same question gives a different probability in the two states (the label `example` for one unit: 0.36 alone, 0.64 in its window), so the state is a real setting.

Reading: on this one small fictional estate Haiku is the more precise at the same recall, and the window state beats the unit state on precision at every threshold. One estate, one run per arm and a reference built by overlap prove no ranking. They make experiment 13 on the gold set worth its cost. The private estate has not been sent to any model.

### Jev request size on the fixture

The window of 48 units with 6 labels (288 questions) was answered. Repeating its units to larger windows: 504 and 1,002 questions were answered, 1,500 and above were refused with HTTP 400 `max_tokens_exceeded`. The cap is a token budget, not a count, which matches the 1,300 and 1,350 of section 10a. The port defaults to 250 questions per request and halves a window that the endpoint refuses.
