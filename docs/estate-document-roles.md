# Document authority and lint precision

The estate reader classifies document authority before reading declarations or splitting prose. Runtime file kinds and document roles are separate: a skill reference can be a live procedure, a template, or a historical record.

## Roles and evidence

| Role | Structural evidence |
|---|---|
| `normative` | Live content without whole-document navigation structure |
| `changelog` | A changelog or release-notes heading and dated entries |
| `history` | A history heading with dated entries or an append-only log; alternatively, a document consisting of repeated dated entries |
| `journal` | A journal, diary, work-log or session-log heading and dated entries |
| `template` | A template heading with placeholders, repeated placeholder value slots, or a template folder |
| `example` | An example heading or an examples, samples or demos folder |
| `fixture` | A fixtures folder |
| `archive` | An archive or attic folder |

A declared unit folder identifies that unit, so a skill named `demo` remains live; navigation folders below it keep their roles.

A single incidental date or a variable path in an operational instruction does not turn the document into a log or template. Names alone do not establish history. A mixed document keeps its live role; example and historical sections carry their own line spans. A section ends at the next heading of equal or lesser depth. Explicit `For example` and `e.g.` lines are local illustrative spans. Fenced examples remain excluded by the existing fence reader.

The map records each file's `path`, `role`, classification `reasons`, and any non-normative `sections` as optional `documents` metadata. Older maps without this metadata remain valid. The source text and quote offsets are retained.

Non-normative documents remain navigation targets. Their bodies supply no declarations, rules, gates, hazards or downstream file reads. A live instruction to read a template is still a real prerequisite. Lint does not turn navigation-only documents into orphan or unreachable defects.

## Missing, unresolved and illustrative targets

A concrete path that does not exist remains `MISSING_REFERENCE`. A bare name with no resolution becomes informational `UNRESOLVED_REFERENCE`: the scan has not established where it belongs. Ambiguous names retain `AMBIGUOUS_REFERENCE` with their candidates. Placeholders and illustrative examples do not establish missing files. A path excluded by an ignore rule is not a broken live dependency, even if no physical fixture currently exists at that path.

## Reproducible synthetic measurement

The hand-written estate in `packages/estate/test/scan/document-role-estate.ts` contains each navigation role, mixed example and operational sections, placeholder paths, an ignored fixture path, an unresolved name, two concrete missing live references, and one real recovery hazard. It contains no private estate text or validator fixture strings.

Precision counts correct failing lint findings over all failing lint findings. Hazard precision counts the real recovery hazard over all hazard atoms. Informational findings do not count as failures. The role tests also check preservation of real read gates, map serialization, arbitrary log and form titles, and live procedures containing dates and variables.

The synthetic measurement measures these constructed inputs. It does not estimate precision on an unseen private estate.

Run the synthetic measurement from the repository root:

```sh
pnpm exec tsx packages/estate/test/scan/document-role-precision.ts
```

The runner prints the true-positive counts, reported counts and precision. It removes only its own temporary fictional estate.

Measured on the same synthetic input against base `a91598b5e153dc9c734188abc4027f47073eeae6` and the role-aware scanner:

| Metric | Before | After | Retained truth |
|---|---|---|---|
| Failing lint precision | 2/16 (12.5%) | 2/2 (100%) | Both concrete missing live references |
| Hazard precision | 1/8 (12.5%) | 1/1 (100%) | The live compaction recovery rule |

These are constructed-estate measurements, not a private-estate remeasurement.
