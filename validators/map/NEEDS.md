# Map bank: the product need of each family

Each family of the map bank names the page, design section or command that needs what it checks. A family nothing needs is quarantined. Its items are kept and can be run, but they count toward no score, forecast or cause. The quarantine list lives in `QUARANTINED_CAUSES` in `packages/validators/src/ladders/map/bank/index.ts`.

Pages cited:

* **generating.md**: [docs/generating.md](../../docs/generating.md), the product page of `driftbench extract` and the space commands.
* **cli.md**: [docs/reference/cli.md](../../docs/reference/cli.md), the command reference.
* **Planned**: generating.md "Planned: what extract does not read yet", the capabilities users need that the code lacks today.
* **validators.md**: [docs/validators.md](../../docs/validators.md), the design of the validator. The lead ruled that it describes the validator, not the product, so it is never the only need cited.

## Families in the bank (578 items)

| Family | Items | What it checks | Needed by |
|---|---|---|---|
| inventory-forms | 28 | behaviours, flows, deviation classes and channels read from inventories in the shapes teams write them | generating.md "The code pre-pass" (from the inventory); cli.md `extract --inventory` |
| tool-formats | 35 | tool schemas in the file shapes a team holds them | cli.md `extract --tools` ("tool schemas, or a spec whose `metadata.tool_schemas` lists them"); generating.md "The code pre-pass" |
| schema-keywords | 79 | one item per partition a JSON Schema keyword states | generating.md "The code pre-pass": "a value for each partition the schema states (enum members, booleans, the edges of a minimum or a maximum, a length limit, a format, an array size, `null`, an absent optional field)" |
| adversarial | 29 | tool schemas built to break the pre-pass: odd names, huge enums, open fields | generating.md "The code pre-pass" ("A field the schema leaves open gives no value and is listed in the notes"); cli.md `extract` exit codes |
| hostile-inputs | 23 | empty, unicode, very long and instruction-carrying inputs | generating.md "The model sections" ("one bad entry never costs the rest"); cli.md `extract` exit codes (0, 1 or 2, never a crash) |
| prompt-containers | 42 | the prompt in the files a team holds it in (markdown, code, JSON, README) | cli.md `extract --prompt` ("the agent prompt or policy; repeat it for several files"); generating.md "Extract: propose the map" |
| styles | 21 | rules planted in each prompt style, alone and mixed | Planned "Every prompt style" and "What a rule states"; generating.md "The model sections" (the `rules` section) |
| style-pairs | 91 | every pair of prompt styles | Planned "Every prompt style" ("Any two of these styles can be mixed in one prompt") |
| semantics | 55 | what a rule states that the map must carry: condition, exception, limit, deadline, priority, weight, required, reply text | Planned "What a rule states", "What a value states" and "More relations" |
| relations | 24 | path, uses_tool, binds, recovery and reply_language relations | generating.md "Relations" (the table of the five kinds) |
| constraints | 20 | constraints stated in prose | generating.md "The map of situations" (Constraints: "a combination of values ... that can never occur, with the reason") |
| constraints (space) | 13 | allowed cells, subsets, weights, codes, placement and coverage of the space map, each against brute force | generating.md "The space map and its coverage"; cli.md `driftbench space coverage` |
| constraints (plumbing) | 7 | the quote check, `extract map`, `extract approve`, Chao coverage, the printable rule, `space declare` and partial weights, each against a reference | generating.md "The model sections" (a quote found in its source); cli.md `extract map`, `extract approve` ("0 were already set"), `space complete` ("exits 1 when there are fewer conversations than cells"), `space declare`, the space map's optional `weight` |
| transforms | 20 | the map is unchanged when sections are permuted, a rule is split, a synonym or a decoy is added | Planned "A map that depends only on what the prompt says" |
| composition | 20 | two half-prompts give the union of the maps; one more constraint gives exactly one more | Planned "A map that depends only on what the prompt says" |
| roles | 28 | each persona dimension carries the role the prompt declares, whichever id sorts first | Planned "Declared roles" |
| scale | 36 | prompts of 100k characters and more under a time budget | Planned "Long prompts" |
| v1 items | 7 | the seven levels of the first map ladder, one item each, in the family of their level | the page of each level's family above: inventory and tools (level 1), rules and precision (levels 2 and 3), constraints (level 4), the Planned invariance and declared roles (levels 5 to 7) |

## Quarantined (17 items)

| Items | Cause | Why no page needs them |
|---|---|---|
| 8 in schema-keywords: long-enum-short-members, long-enum-long-members, long-enum-integers, long-enum-spaced, long-enum-nested, long-enum-described, long-enum-two-properties, long-pattern-with-lengths | `tools:whole-long-quote` | They ask for a quote over 1000 characters, returned whole. generating.md asks for quotes of 4 to 400 characters, and the proposal format caps a quote at 1000 (`MAX_QUOTE_LENGTH`). |
| 9 in inventory-forms: long-channel-list, long-channel-list-json, long-behaviour-channels, long-flow-behaviours, long-behaviour-title-line, long-flow-title-line, two-long-items, long-item-json, long-flow-json | `inventory:whole-long-quote` | Same reason. |

These 17 were added to bring the score after the pilot under 0.4. That is a gate-driven choice, so they are quarantined.

For the same reason, the four items the audit hardened against clamped quotes no longer ask for a whole quote over 1000 characters: adversarial.very-long-enum, inventory-forms.long-item, inventory-forms.long-flow-title and schema-keywords.long-pattern. Each now asks for a valid proposal whose quotes are found in the file and stay within the limit. Clamping a long quote to 1000 characters therefore counts as a fix the pages allow, not as a cheat. That fix gains these four items.

## Roles: ruled, then planned

generating.md had code propose the first dimension of each kind as the axis. validators.md 2, level 7, asked for declared roles. The lead ruled that the product page is the authority, and the roles items were quarantined (commit 25166d7b). Measured on the replay of lane/v-map 848a52aa without the 30 roles items: 548 items, 222 pass at iteration 0 (0.4051) and 237 after the pilot (0.4325). None of the 30 passed at either point.

The owner then asked for the capabilities users would want to be written into the docs. generating.md now plans declared roles ("Declared roles" in the Planned section), so the 30 items count again.

## Long quotes stay quarantined

No real use needs a quote over 1000 characters returned whole. A quote stands for the entry it justifies, and a passage within the limit does that. The 17 items stay quarantined.
