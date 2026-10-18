/**
 * The cause of every item of the growth lane "docgaps" (a blind lane that wrote its items from the shipped docs
 * alone): the one change that turns green every item that names it, and the doc section that states the rule.
 * A key stands for one sentence, so the bank can count distinct causes by key. Rules stated only on a help page
 * of the command line cite the docs heading of the same command (the bank accepts only `docs/` contracts).
 */

const CHECKS = 'docs/reference/checks.md';
const TEXT = `${CHECKS}#Text and language`;
const TOOLS = `${CHECKS}#Tools, skills, guards, references and subagents`;
const CARDS = `${CHECKS}#Cards`;
const SAFETY = `${CHECKS}#Safety`;
const STRICT = `${CHECKS}#Strict tool schemas`;
const CUSTOM = `${CHECKS}#Custom checks`;
const RULES = `${CHECKS}#Rules for the whole spec`;
const OVERLAP = `${CHECKS}#Overlap and SQL`;
const CLI_CODES = 'docs/reference/cli.md#Issue codes';
const CLI_PATHS = 'docs/reference/cli.md#Paths';
const CLI_VALIDATE = 'docs/reference/cli.md#`driftbench spec validate`';
const DRIFT_STAGE = 'docs/concepts/drift.md#The stage classifier';

export const CAUSES = {
  // checks: text, values, cards, custom, strict schemas, sql, budget
  'budget-over-note': {
    text: 'A failing budget cost_usd or latency_ms verdict names how far over its limit the block went, a limit of 0 included.',
    contract: TEXT,
  },
  'exact-number-evidence': {
    text: "The exact verdict's evidence gives both normalised forms, or both digit signatures for numbers, on a pass and on a fail.",
    contract: TEXT,
  },
  'json-bare-assert': {
    text: 'A json path assertion written as a bare string, number, boolean or null is an equality: it passes on the equal value and fails as a json.path.<i> verdict on another value or a path that reads nothing.',
    contract: TEXT,
  },
  'one-message-text-plus-card': {
    text: 'rules.one_message_per_turn counts a card as a message of its own when the block also sends text: one text and one card is two messages and fails.',
    contract: CARDS,
  },
  'trailing-mark-strip': {
    text: 'With match_case false, must ignores one trailing punctuation mark of the reply whatever the mark and whatever space follows it; with match_case true it counts.',
    contract: RULES,
  },
  'custom-name-leading-mark': {
    text: 'registerCheck accepts any name of letters, digits, dots, underscores and hyphens, one that starts with a dot, an underscore or a hyphen included, and files its verdicts under custom.<name>.',
    contract: CUSTOM,
  },
  'strict-openai-function-forms': {
    text: 'schema_strict reads an OpenAI-style function schema by its parameters, nested under function or flat beside type function, and refuses a call key the parameters do not declare.',
    contract: STRICT,
  },
  'strict-pattern-identity-escape': {
    text: 'schema_strict compiles a pattern as a JavaScript regular expression without the unicode flag, so an escaped punctuation mark such as \\- or \\_ matches itself.',
    contract: STRICT,
  },
  'sql-inconclusive-nongating': {
    text: 'An sql verdict the golden query or its database cannot decide is inconclusive and does not gate: the block passes on it.',
    contract: OVERLAP,
  },
  'sql-statement-reading': {
    text: 'sql reads statements as SQLite does: a semicolon or an ORDER BY inside a string literal or a comment is text, and a leading comment or a doubled final semicolon leaves one read statement.',
    contract: OVERLAP,
  },
  // tools, stage, safety
  'exact-order-first-difference': {
    text: 'A failing tool_order exact verdict names the first call where the observed calls leave the expected ones, expected and seen, also when a count is a range or a max-only bound.',
    contract: TOOLS,
  },
  'tool-f1-max-zero': {
    text: 'tool_f1 reads a count of { max: 0 } as a call that must not happen: the tool adds nothing to recall, and a call of it is unexpected.',
    contract: TEXT,
  },
  'safety-confirmed-after-dedupe': {
    text: 'A delete through a tool whose input names a path the diff lists counts once, and that one operation stays confirmed when the block expects the tool with a count above 0.',
    contract: SAFETY,
  },
  'flow-verdict-classifier-only': {
    text: 'The runner adds flow verdicts only when the stage came from the classifier: a stage the runtime reports, in the block or carried from an earlier block, gets none, in modes T, F and P.',
    contract: DRIFT_STAGE,
  },
  'flow-evidence-stages': {
    text: 'A flow.order verdict names in its evidence the stage the block reached and, when the flow went back, the stage before it.',
    contract: DRIFT_STAGE,
  },
  // the loader and spec check
  'stage-unknown-listed': {
    text: 'With stages listed, an expect.stage or a recovery.stage_after that names a stage not in the list is the error STAGE_UNKNOWN.',
    contract: CLI_CODES,
  },
  'check-layers-gate': {
    text: 'spec validate checks in layers and runs a later layer only when the earlier ones pass: a parse or shorthand error hides every schema error, a schema error every semantic one.',
    contract: CLI_VALIDATE,
  },
  'given-verifier-perturbation-worlds': {
    text: 'The Given verifier reads the world of every perturbation too: a tool its world.tools forces must be a key of metadata.tool_schemas (tool_known), and with --summaries its workspace folder needs a summary.',
    contract: CLI_CODES,
  },
  'json-duplicate-key': {
    text: 'A .spec.json file that repeats a key in one object is the error SPEC_PARSE, as YAML is.',
    contract: CLI_CODES,
  },
  'missing-path-spec-parse': {
    text: 'Every command that reads specs reports a path that does not exist as an invalid spec with the code SPEC_PARSE, spec coverage included.',
    contract: CLI_PATHS,
  },
  // running
  'replay-attempt-events': {
    text: 'onEvent reports one block start and one block end per block of the run, whether the cache is empty, holds a prefix of the blocks or holds the whole run.',
    contract: 'docs/running.md#Run events',
  },
  'realized-hash': {
    text: "A block's realized.hash is the SHA-256 of the user messages the agent received, joined by newlines, and is recorded only when the driver sent other text than the spec wrote.",
    contract: 'docs/running.md#The run record',
  },
  'early-stop-machine-fail': {
    text: 'runCampaign with earlyStop stops the later F repeats of a spec only when its F repeats 0 and 1 both fail a gating machine verdict: an inconclusive verdict, a passing repeat, or a T cell never stops it.',
    contract: 'docs/concepts/run-modes.md#Around the modes',
  },
  'replaced-block-keeps-given': {
    text: 'A block a world-only perturbation replaces keeps its own given: its prefix, ledger and vars apply from that block on in mode P as in mode F.',
    contract: 'docs/concepts/given-when-then.md#Given',
  },
  'forced-latency-with-result': {
    text: 'The vercel-ai adapter answers a forced result that comes with latency_ms: the tool returns the forced value, after the forced latency.',
    contract: 'docs/concepts/given-when-then.md#Given',
  },
  'anchor-workspace-from': {
    text: "A workspace folder written ./<path> in a block's given or a perturbation's world is read from the spec file's folder, and that resolved path enters the spec hash, as at the spec level.",
    contract: 'docs/reference/spec.md#WorldState workspace',
  },
  'partial-cache-cost': {
    text: 'A partly cached run costs only its live blocks: Spent counts the blocks the agent answered in this command, never the blocks read back from the cache.',
    contract: 'docs/running.md#The cache and replay',
  },
  'resume-no-cache-suite': {
    text: 'campaign resume takes no --cache-suite: the option is refused as an unknown option, exit 2.',
    contract: 'docs/running.md#`driftbench campaign resume`',
  },
  // campaigns: status, export, localisation
  'status-merged-line': {
    text: 'campaign status of a campaign that carries results prints the merged line: the runs fresh and the runs carried, and the agent version the carried runs were measured on beside the version the campaign runs.',
    contract: 'docs/concepts/blast-radius.md#In the statistics and the report',
  },
  'bundle-manifest-hashes': {
    text: "campaign export writes a manifest.json that holds the SHA-256 of every file of the bundle: the campaign, each run and spec, and each source's version.json and files.",
    contract: 'docs/datasets.md#Run a campaign again elsewhere',
  },
  'refuted-section-unranked': {
    text: 'radius localize ranks no section that only refuted links reach: a refuted link adds no covering block, so such a section is not ranked.',
    contract: 'docs/concepts/blast-radius.md#Localisation over sections',
  },
  'status-spent-fresh-only': {
    text: 'A carried run costs nothing: the Spent of a radius campaign, on its run summary and in campaign status, counts its fresh runs alone.',
    contract: 'docs/concepts/blast-radius.md#Fresh and carried',
  },
  'reply-checks-line': {
    text: 'perturb prints Reply checks: <a> of <t> applied, <n> not applicable (<reason>) for a drawn phrasing with stage-bound patterns: tied to another stage when the spec states a stage the pattern is not tied to, no stage when it states none.',
    contract: 'docs/attack.md#Stage-bound reply patterns',
  },
  'replay-summary-line': {
    text: 'replay ends with the summary line <n> specs replayed: <p> pass, <f> fail. Campaign replay-<hash> (in memory).',
    contract: 'docs/reference/cli.md#`driftbench replay`',
  },
} as const;

export type DocgapCause = keyof typeof CAUSES;
