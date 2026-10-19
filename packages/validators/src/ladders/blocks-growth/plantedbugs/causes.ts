/**
 * The cause of every item of the growth lane "plantedbugs": the one change that turns green every item that names
 * it, and the doc section that states the rule. The lane closes the documented behaviours ten planted bugs broke
 * unseen by the bank (scratchpad/blocks-audit-bugs/NOTES.md). A rule the bank already states keeps the bank's own
 * sentence and contract, word for word, so the same change counts once; the others are new sentences.
 */

export const CAUSES = {
  // Existing sentences of the bank, reused because the same change turns these items green.
  'canonical-count': {
    text: 'the canonical assistant message of a teacher-forced prefix carries each expected call as many times as its count asks: its min for a range, once with no count, none for count 0',
    contract: 'docs/concepts/run-modes.md#Teacher-forced',
  },
  'ledger-add-later': {
    text: 'A fact a block adds with `ledger_add` is in the ledger of every later block, in free-running and in teacher-forced mode.',
    contract: 'docs/running.md#Given resolution and the hash',
  },
  'ledger-add-same-block': {
    text: "The ledger a block is compared with holds the block's own ledger_add.",
    contract: 'docs/concepts/drift.md#The ledger check',
  },
  'schema-version': {
    text: '`schema_version` is 1.',
    contract: 'docs/reference/spec.md#Spec',
  },
  'export-skips': {
    text: 'The export a child starts from skips .git and node_modules and carries every other file.',
    contract: 'docs/concepts/given-when-then.md#Parent blocks',
  },
  // New sentences: no earlier item states these rules in the case written here.
  'from-run-folder': {
    text: 'A workspace folder written as a relative path that does not start with ./ is read from the folder the run starts in, never from the folder of the spec file.',
    contract: 'docs/reference/spec.md#WorldState workspace',
  },
  'discovery-yml': {
    text: 'A folder given to a command that reads specs is searched recursively for *.yaml, *.yml and *.spec.json files, in sorted order, skipping entries whose name starts with a dot, node_modules and dist.',
    contract: 'docs/reference/cli.md#Paths',
  },
  'yaml-duplicate-key': {
    text: 'A YAML spec file that writes a key twice in one mapping is the error SPEC_PARSE, whatever the mapping and however it is written.',
    contract: 'docs/reference/cli.md#Issue codes',
  },
  'snapshot-skips-any-depth': {
    text: 'A workspace snapshot never enters a node_modules or .git folder, at any depth: the files under one are in no workspace diff.',
    contract: 'docs/adapters/process.md#Sandboxes',
  },
  'absolute-path-refused': {
    text: 'A sandbox refuses an absolute workspace path: a file seeded or an artifact read by an absolute path is never written or read.',
    contract: 'docs/adapters/process.md#Workspace paths',
  },
  'no-verdict-share': {
    text: 'Beside the suite headline, each share of runs that gave no verdict (did not complete, not run, blocked) is a share of every run of the suite, scored or not.',
    contract: 'docs/concepts/statistics.md#The suite headline',
  },
  // Round 2: the rules the round-2 planted bugs broke unseen (scratchpad/blocks-audit-bugs/NOTES.md, "Round 2").
  'workspace-one-form': {
    text: 'The workspace check compares paths in one form, in its three lists and in all three sets of the diff alike: a backslash reads as a forward slash and leading ./ segments are dropped.',
    contract: 'docs/reference/checks.md#Workspace',
  },
  'perturbation-world-wins': {
    text: "A world-only perturbation runs under block inject_at with its own world: a key the block's given world also writes takes the perturbation's value, and the block's other keys stay.",
    contract: 'docs/concepts/recovery.md#Writing a perturbation',
  },
  'count-range-invalid': {
    text: 'A count whose min is greater than its max, by one or by more, is the error COUNT_RANGE_INVALID; a min equal to the max is a valid range.',
    contract: 'docs/reference/cli.md#Issue codes',
  },
  'exact-strict-grouping': {
    text: 'In `exact` a strict thousands grouping leads with one to three digits: a comma after a leading group of four digits counts.',
    contract: 'docs/reference/checks.md#Text and language',
  },
  'snapshot-depth-bound': {
    text: 'A snapshot stops only past 32 folder levels: a workspace exactly 32 levels deep is within the bounds.',
    contract: 'docs/adapters/process.md#Sandboxes',
  },
  'export-at-the-bound': {
    text: 'An export fails only when the files pass `exportMaxBytes`: a workspace of exactly that size exports.',
    contract: 'docs/reference/block-contracts.md#The workspace of a child',
  },
} as const;

export type PlantedCause = keyof typeof CAUSES;
