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
} as const;

export type PlantedCause = keyof typeof CAUSES;
