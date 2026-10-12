# Map bank: the product need of each family

Each family of the map bank names the page, design section or command that needs what it checks. A family nothing needs is quarantined. Its items are kept and can be run, but they count toward no score, forecast or cause. The quarantine list lives in `QUARANTINED_CAUSES` in `packages/validators/src/ladders/map/bank/index.ts`.

Pages cited:

* **generating.md**: [docs/generating.md](../../docs/generating.md), the product page of `driftbench extract` and the space commands.
* **cli.md**: [docs/reference/cli.md](../../docs/reference/cli.md), the command reference.
* **validators.md**: [docs/validators.md](../../docs/validators.md). Section 2 is the design of the map validator. Section 12 lists the bank the hardness contract requires.

## Families in the bank (578 items)

| Family | Items | What it checks | Needed by |
|---|---|---|---|
| inventory-forms | 28 | behaviours, flows, deviation classes and channels read from inventories in the shapes teams write them | generating.md "The code pre-pass" (from the inventory); cli.md `extract --inventory` |
| tool-formats | 35 | tool schemas in the file shapes a team holds them | cli.md `extract --tools` ("tool schemas, or a spec whose `metadata.tool_schemas` lists them"); generating.md "The code pre-pass" |
| schema-keywords | 79 | one item per partition a JSON Schema keyword states | generating.md "The code pre-pass": "a value for each partition the schema states (enum members, booleans, the edges of a minimum or a maximum, a length limit, a format, an array size, `null`, an absent optional field)" |
| adversarial | 29 | tool schemas built to break the pre-pass: odd names, huge enums, open fields | generating.md "The code pre-pass" ("A field the schema leaves open gives no value and is listed in the notes"); validators.md 12, item 7 (degenerate and hostile inputs) |
| hostile-inputs | 23 | empty, unicode, very long and instruction-carrying inputs | validators.md 12, item 7; generating.md "The model sections" ("one bad entry never costs the rest"); cli.md `extract` exit codes |
| prompt-containers | 42 | the prompt in the files a team holds it in (markdown, code, JSON, README) | cli.md `extract --prompt` ("the agent prompt or policy; repeat it for several files"); generating.md "Extract: propose the map" |
| styles | 21 | rules planted in each prompt style, alone and mixed | validators.md 2 (levels 2 and 3); validators.md 12 (map: "at least twelve prompt styles") |
| style-pairs | 91 | every pair of prompt styles | validators.md 12 (map: "every pair of styles") |
| semantics | 55 | what a rule states that the map must carry: condition, exception, limit, deadline, priority, weight, required, reply text | generating.md "The map of situations" (constraints, phrases with `when` and `binds`, relations); validators.md 2 (level 2) |
| relations | 24 | path, uses_tool, binds, recovery and reply_language relations | generating.md "Relations" (the table of the five kinds) |
| constraints | 20 | constraints stated in prose | generating.md "The map of situations" (Constraints); validators.md 2 (level 4) |
| constraints (space) | 13 | allowed cells, subsets, weights, codes, placement and coverage of the space map, each against brute force | generating.md "The space map and its coverage"; cli.md `driftbench space coverage` |
| constraints (plumbing) | 7 | the quote check, `extract map`, `extract approve`, Chao coverage, the printable rule, `space declare` and partial weights, each against a reference | generating.md "The model sections" (a quote found in its source); cli.md `extract map`, `extract approve` ("0 were already set"), `space complete` ("exits 1 when there are fewer conversations than cells"), `space declare`, the space map's optional `weight` |
| transforms | 20 | the map is unchanged when sections are permuted, a rule is split, a synonym or a decoy is added | validators.md 2 (level 5, metamorphic invariance) |
| composition | 20 | two half-prompts give the union of the maps; one more constraint gives exactly one more | validators.md 2 (level 6, additivity and unit response) |
| roles | 28 | each persona dimension carries the role the prompt declares, whichever id sorts first | validators.md 2 (level 7: "roles (axis or detail) match the specification's declared roles"). See the conflict below. |
| scale | 36 | prompts of 100k characters and more under a time budget | validators.md 12 (map: "prompts of 100k characters"); validators.md 12, item 7 ("100k-character") |
| v1 items | 7 | the seven levels of the first map ladder, one item each, in the family of their level | validators.md 2 (levels 1 to 7) |

## Quarantined (17 items)

| Items | Cause | Why no page needs them |
|---|---|---|
| 8 in schema-keywords: long-enum-short-members, long-enum-long-members, long-enum-integers, long-enum-spaced, long-enum-nested, long-enum-described, long-enum-two-properties, long-pattern-with-lengths | `tools:whole-long-quote` | They ask for a quote over 1000 characters, returned whole. generating.md asks for quotes of 4 to 400 characters, and the proposal format caps a quote at 1000 (`MAX_QUOTE_LENGTH`). |
| 9 in inventory-forms: long-channel-list, long-channel-list-json, long-behaviour-channels, long-flow-behaviours, long-behaviour-title-line, long-flow-title-line, two-long-items, long-item-json, long-flow-json | `inventory:whole-long-quote` | Same reason. |

These 17 were added to bring the score after the pilot under 0.4. That is a gate-driven choice, so they are quarantined.

For the same reason, the four items the audit hardened against clamped quotes no longer ask for a whole quote over 1000 characters: adversarial.very-long-enum, inventory-forms.long-item, inventory-forms.long-flow-title and schema-keywords.long-pattern. Each now asks for a valid proposal whose quotes are found in the file and stay within the limit. Clamping a long quote to 1000 characters therefore counts as a fix the pages allow, not as a cheat. That fix gains these four items.

## Conflict between two pages: roles

generating.md "The map of situations" says: "Code proposes the roles: every dimension read from a tool schema is a detail, and the first dimension of each kind is an axis, the others details. A person may flip any role." The extractor does that today.

validators.md 2, level 7, asks for the roles the specification declares. The roles family checks the roles a prompt declares in words ("Each of these makes a different kind of conversation"), which the first-of-kind rule does not read. The family stays in the bank on validators.md 2. If the product page is the authority, the roles family and the two v1 role items should be quarantined. That is the owner's call.
