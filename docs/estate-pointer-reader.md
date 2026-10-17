# Estate pointer reader (design, not built)

Status: proposal. Nothing on this page exists in code yet. It replaces the word-list rule finder (`candidates.ts`, `clause-rule.ts`) and the quoting model pass (`prose.ts`) with one reader in which a model points and code copies.

## The rule that shapes everything

- The model never writes text. It returns numbers.
- Code cuts the prose into numbered units by structure only. Code copies the exact text of each unit the model points to.
- A rule's text is always a verbatim slice of the file. A pointer to a unit that does not exist is refused.
- No word list, no phrase pattern, no grammar tagger decides what a rule is. Structure decides where a unit starts and ends. The model decides what a unit is.

## 1. Units: structure only

Code reads each prose file (standing instructions, memory, skill bodies and files, helper bodies) and cuts it into units. Each unit has an id, a kind of container, and the exact character span in the file.

Boundaries come from punctuation and markup alone:

| Container | Where a unit starts and ends |
|---|---|
| Sentence | The sentence segmenter's boundary (full stop, question mark, exclamation mark), and a semicolon. |
| List item | One markdown list item (`-`, `+`, `*`, `1.`), nested items separate. A wrapped item is one unit. |
| Table cell | One cell of a table row. The header row is marked `header`. |
| Block quote | One `>` paragraph. |
| Heading | One heading line. It is a unit so a rule can point to the section it belongs to. |
| Fence, comment, front matter | One unit each, marked `opaque`. The model sees the fence kind and first line only, and cannot point to a line inside. |

Rules for cutting:

- Spans never overlap and never leave a gap inside prose, so every prose character belongs to one unit.
- A unit keeps its original characters. Folding (white space, typographic quotes) is applied only when comparing, never to the stored text.
- A paragraph that wraps over several lines is one sentence unit per sentence. Line numbers are kept for display only.

### Example

File `.claude/skills/shelf-audit/SKILL.md`:

```
# Shelf audit

**Keys.** A key opens one door. Return every key before you leave.

- Count the till twice
- Never leave the desk unattended

Read `references/closing.md` before you lock up.
```

Units, as code builds them (fictional text):

```json
{
  "file": ".claude/skills/shelf-audit/SKILL.md",
  "fileHash": "b3a1…e9",
  "units": [
    { "u": 1, "container": "heading", "span": [0, 13], "text": "# Shelf audit" },
    { "u": 2, "container": "sentence", "span": [15, 24], "text": "**Keys.**" },
    { "u": 3, "container": "sentence", "span": [25, 48], "text": "A key opens one door." },
    { "u": 4, "container": "sentence", "span": [49, 78], "text": "Return every key before you leave." },
    { "u": 5, "container": "list_item", "span": [80, 105], "text": "- Count the till twice" },
    { "u": 6, "container": "list_item", "span": [106, 140], "text": "- Never leave the desk unattended" },
    { "u": 7, "container": "sentence", "span": [142, 190], "text": "Read `references/closing.md` before you lock up." }
  ]
}
```

(Spans above are illustrative. The real spans are character offsets in the file.)

## 2. What the model receives and returns

The model receives a numbered rendering of one file (or one window of a long file) and a fixed instruction. It receives no earlier answers and no list of known rules.

Request body (the units, one per line, with the container):

```
FILE .claude/skills/shelf-audit/SKILL.md
U1 [heading] # Shelf audit
U2 [sentence] **Keys.**
U3 [sentence] A key opens one door.
U4 [sentence] Return every key before you leave.
U5 [list_item] - Count the till twice
U6 [list_item] - Never leave the desk unattended
U7 [sentence] Read `references/closing.md` before you lock up.
```

Answer (JSON only; no text of the file appears in it):

```json
{
  "file": ".claude/skills/shelf-audit/SKILL.md",
  "pointers": [
    { "unit": 4, "kind": "rule", "context": [2] },
    { "unit": 5, "kind": "rule" },
    { "unit": 6, "kind": "prohibition" },
    { "unit": 7, "kind": "gate", "target": 7 },
    { "unit": 3, "kind": "description" }
  ]
}
```

Fields:

| Field | Meaning |
|---|---|
| `unit` | The id of a unit in this request. Required. |
| `kind` | `rule`, `prohibition`, `gate`, `description`, `example`, `other`. |
| `target` | For a gate only: the unit that names what must come first or what is gated. May equal `unit` when one unit holds both ends. |
| `context` | Optional: ids of units that scope the rule (a bold label, a heading, the sentence before). Code stores them as links and never merges their text into the rule. |

Only `rule`, `prohibition` and `gate` become atoms. `description`, `example` and `other` are recorded in the pointer file so a reviewer can see what the model decided and so a re-record shows drift, but they give no atom.

The model may answer with an empty list. It may not add a key, a unit text or an id that is not in the request.

## 3. The parser: refusals and extraction

Code reads the answer and, for each pointer:

1. Refuses the whole answer if it is not JSON of the agreed shape, or if `file` is not the file asked about.
2. Refuses a pointer whose `unit` is not an id of the request, whose `kind` is unknown, whose `target` is not an id of the request, or whose `target` is set on a kind other than `gate`.
3. Refuses a pointer to an `opaque` unit (fence, comment, front matter).
4. Skips, with a note, a second pointer to the same unit and kind.
5. Copies `text` from the file at the unit's span. The text is never taken from the answer.
6. Builds the atom:
   - `kind`: `instruction` for `rule` and `prohibition`, `gate` for `gate`. A rule about the reply itself (today's `register` atom) stays an `instruction` until the first recordings show whether the model separates it (open question 2).
   - `provenance`: the file, the line span of the unit, the verbatim quote.
   - `polarity`: `obligation` or `prohibition`, from the pointer kind.
   - `producedBy: model`, `approved: false`, `fields.extraction: pointer`, `fields.unit`, `fields.context` (ids and spans), `fields.recorded` (the recording key).
   - `evidence`: one `custom` predicate named `prose_pointer` with `reviewRequired: true`, as code-found candidates carry today. The model does not write evidence predicates.
7. A refusal is listed with its reason and counted, never dropped silently. Exit code 1 of `estate scan` keeps its current meaning.

A gate pointer builds a gate atom with two anchors: the unit pointed to and its `target` unit. If they are different units, the gate quote is the verbatim text of both, in file order.

What the parser does not do: it does not read the words of a unit to decide it is a rule. If the model points to a description, the atom exists and the reviewer rejects it; no code filters it by vocabulary.

## 4. Stable ids (open: research pending)

The model sees short ids (`U1`, `U2` …) that exist only inside one request. Atoms need ids that survive edits to the file. The current atom id is `<kind>.<scope>.<slug of the title>`, which is stable only while the text is.

Proposal until the research report arrives:

- Unit address: `sha256(normalised unit text)` first 12 characters, plus an occurrence number among identical texts in the same file. An unrelated edit elsewhere in the file does not change it. An edit inside the unit changes it, and the old pointer is reported as `moved or changed`.
- Atom id: the existing id scheme, with the title taken from the verbatim text (code slugs it), so ids match the ones produced today for the same text.
- A changed file is re-cut. Units whose address is unchanged keep their recorded pointers without a model call. Only changed or new units, with one unit of context on each side, are sent again.

Open questions for the research: whether a text address plus occurrence number is enough, whether a position hint should break ties, and how a unit that is split or merged by an edit is matched to its old pointer.

## 5. Cache and recordings

Two layers:

- Local cache (not committed): `.cache/estate-pointers/` beside the output map, one JSON file per request. Key: `sha256(file hash, model id, prompt version, unit-cutter version, window)`. Private source never leaves the machine and the folder stays out of version control, as `.cache/estate-prose/` does today.
- Recordings (committed, fixtures only): `examples/estates/<name>/pointers.yaml`, one entry per request, holding the key, the model id, the prompt version and the pointers. No file text is stored in a recording; the units come from the committed fixture files.

A recording is valid only if its key matches. A changed prompt, model id, unit cutter or fixture file changes the key and the recording is reported as stale. `estate scan --replay-pointers <file>` refuses a stale recording and names the key that differs. A person re-records with the same command without `--replay-pointers` and a key, and reviews the diff of `pointers.yaml`.

## 6. How the validators replay it

- The validators never call a model. They run `estate scan` with `--replay-pointers` on the committed recordings of the fixture estates and on the planted estates the validator builds.
- For the planted estates, the validator writes the pointers itself (the planted rules are known by construction) in the same format and replays them. This tests the unit cutter and the parser (refusals, verbatim copy, gate pairing) without a model, and it never mirrors a model's mistakes.
- Determinism: the cutter and the parser are pure functions of the file text and the answer. The same recording on the same files gives the same map byte for byte.
- A prompt change re-records the fixture recordings in one reviewed commit. A validator item never depends on a recording the item itself produced.
- Offline CI: no key is read, no network is used.

## 7. Model, key and cost

- Model: the newest Haiku, `claude-haiku-5-5`, called through the existing model port (`family`, `model` recorded in the map as `producedBy`).
- Key: read from `~/.nexus-secrets/anthropic-driftbench.key` by path inside the process; never printed, never put in a command line, a log, a recording or a brief.
- Window: a file is sent whole up to a character limit (the existing 20,000-character chunk budget is the starting value) and in windows with one unit of overlap above it.
- Output is small: one pointer is about 15 tokens, so an answer is tens to a few hundred tokens.

### Cost on the fixture (measured input size; price not yet applied)

On the Northwind fixture the scan today sends 13 prose chunks of 6,649 characters in total (standing 1, memory 2, skill bodies 4, skill files 3, helper bodies 3). The pointer reader sends the same prose with one id and one container tag per unit, so input is the prose plus a small overhead per unit. Token count is the character count divided by a tokenizer ratio the model's own counter gives; I have not made a call, so I give no token figure and no price. Before any spend I will:

1. Cut the fixture into units and report the unit count and total request characters.
2. Count tokens with the model's token-count endpoint (no generation) and multiply by the price on the live price list.
3. Report cost for the fixture and for a size ratio on the private estate (10.7 MB of prose, 750 chunks, counts only), and wait for approval.

The private estate is read locally only; only counts leave the machine.

## 8. What it replaces

| Today | With the pointer reader |
|---|---|
| `candidates.ts`, `clause-rule.ts`: grammar and word lists find rules without a model | Removed. The model points; structure cuts. |
| `prose.ts`: the model quotes text and writes evidence predicates | Replaced. The model returns ids; code copies and builds evidence. |
| `estate scan --no-model`: proposes code-found candidates | Reads structured atoms only, as before the candidate pass; prose atoms need a recording or a model. |
| Cache keyed on chunk text | Cache keyed on file hash, model id, prompt version, cutter version. |

The structured readers (frontmatter, settings, registries, routing tables, gates in fixed form, references, hazards) are unchanged. A rule they already read is not asked of the model again: a unit whose span a code atom occupies is shown to the model marked `read` and cannot be pointed to.

## 9. Open questions

- Ids that survive edits (section 4): waits for the research report.
- Whether `register` (a rule about the reply itself) is a fourth pointer kind or stays `instruction` with a flag.
- Whether the model should see the units of a whole skill folder at once, so a gate in `SKILL.md` can point to a unit of a reference file. Today a gate target is in the same file.
- How the reviewer sees `description` pointers: listed after the atoms, or hidden by default.

## 10. Build order (after approval)

1. Unit cutter and its tests on hand-written files (no model).
2. Parser with its refusals and the planted-estate pointer writer for the validators.
3. Model port call, request and answer shapes, local cache.
4. Recordings for the fixture estates, `--replay-pointers`, and the stale-key report.
5. Remove the word-list finder and its tests, and move the corpora into pointer-reader tests.
6. Cost measurement and a private-estate run, counts only.
