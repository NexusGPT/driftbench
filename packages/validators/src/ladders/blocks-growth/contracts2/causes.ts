/**
 * The causes of the growth lane "contracts2": rules of docs/reference/block-contracts.md that no earlier item tests.
 * A key stands for one sentence, the one change that turns green every item naming it, with the doc heading
 * that states the rule. A key marked `reused` carries, word for word, the cause sentence an earlier item of the
 * bank already names: the item fails for the same missing change, so the bank counts one cause for both.
 */

const D = 'docs/reference/block-contracts.md';
const HASH = `${D}#Content hash`;
const LAYERS = `${D}#Layer precedence`;
const UNKNOWN = `${D}#Unknown parent`;
const ITEMS = `${D}#Items`;
const CLI = `${D}#Command line layer`;
const USES = `${D}#Uses and the hashes`;
const MOVES = `${D}#Item moves`;
const BY = `${D}#Verdict.by`;
const STEPS = `${D}#Steps`;
const EXACT = `${D}#Exact by declaration`;
const IDENTITY = `${D}#Identity`;
const FALLBACK = `${D}#Exact fallback`;
const FORMS = `${D}#Other assertion forms`;
const RECOMPUTE = `${D}#Recompute`;
const DIFF = `${D}#State diff`;
const ATTRIBUTION = `${D}#attributionOf`;
const BADGE = `${D}#Fix plan and badge`;
const BLAME = `${D}#Blame and value facts`;
const STEP = `${D}#The evidence step`;
const REGISTRY = `${D}#Registry commands`;
const LOCALIZE = `${D}#Localize`;

type Cause = { text: string; contract: string; reused?: true };

export const CAUSES = {
  // Objects
  'hash-content': {
    text: 'the hash is the first 8 hex of the SHA-256 of the resolved content: same items and values, same hash whatever the id; a change moves it',
    contract: HASH,
    reused: true,
  },
  'hash-recorded-12': {
    text: 'The resolved object records its hash as 12 hex characters in BlockResult.resolved, and Verdict.by names the object by the first 8 of them.',
    contract: HASH,
  },
  'layers-resolve': {
    text: 'uses is resolved weakest first with a stronger layer winning: suite, spec, block, command line',
    contract: LAYERS,
    reused: true,
  },
  'unknown-message': {
    text: 'An OBJECT_UNKNOWN refusal names the place of the reference as a spec path, the kind, the id, the layers searched and the known ids of the kind.',
    contract: UNKNOWN,
  },
  'params-invalid': {
    text: 'The resolver refuses an item whose params do not fit its implementation with OBJECT_PARAMS_INVALID, naming the path.',
    contract: ITEMS,
  },
  'impl-needed': {
    text: 'an enabled item needs an implementation from driftbench or a plugin; a disabled item needs none',
    contract: ITEMS,
    reused: true,
  },
  'cli-flag-invalid': {
    text: 'The command line layer refuses a --use or --set flag with no known kind, a kind named twice, or no #<item>.<param>=<value>, with OBJECT_INVALID.',
    contract: CLI,
  },
  'cli-list-exit': {
    text: 'driftbench object list exits as docs/reference/cli.md documents.',
    contract: CLI,
    reused: true,
  },
  'cli-explain-exit': {
    text: 'driftbench object explain exits as docs/reference/cli.md documents.',
    contract: CLI,
    reused: true,
  },
  'uses-hash': {
    text: 'uses is part of the spec hash and is left out of the block cache key.',
    contract: USES,
    reused: true,
  },
  'uses-sandbox-reruns': {
    text: 'A code block run in a sandbox is never replayed from the cache, so a change to its uses runs its agent again.',
    contract: USES,
  },
  'move-after': {
    text: 'The loader resolves spec and block uses against the shipped objects.',
    contract: MOVES,
    reused: true,
  },
  'value-stamp': {
    text: 'A tool input decided by the value policy names the policy object, the deciding rung as item, and the layer that defines the policy object.',
    contract: BY,
  },
  // Value ladder
  'exact-only-exact': {
    text: 'A compare exact passes only the exact value and prints <value> is not exactly <expected> (<reason>) on a fail.',
    contract: EXACT,
    reused: true,
  },
  'exact-pass-evidence': {
    text: 'A compare exact that passes prints exactly <expected> (<reason>) in its evidence.',
    contract: EXACT,
  },
  'exact-never-default': {
    text: 'rung4_exact runs only for compare: { exact: <reason> }; the default compare never decides a value exactly by declaration.',
    contract: EXACT,
  },
  'fallback-evidence': {
    text: 'The exact fallback writes exact_fallback: no decider configured for <tool>.<field>; compared exactly: <value> is not <expected>, with the reason of each item that ran.',
    contract: FALLBACK,
  },
  'exact-form-ladder': {
    text: 'An { exact: <value> } assertion on a tool input goes through the ladder as a bare value does.',
    contract: FORMS,
  },
  'policy-order': {
    text: 'The ladder runs its items in the order of the policy/value-check object, and the first item that settles the value decides it.',
    contract: STEPS,
  },
  'mode-cannot-apply': {
    text: 'A named compare mode that cannot apply leaves the value to the exact fallback.',
    contract: STEPS,
    reused: true,
  },
  'mode-runs-alone': {
    text: 'A named compare mode runs only the item that implements it, whatever the other items could decide.',
    contract: STEPS,
    reused: true,
  },
  'diff-skips-identity': {
    text: 'A workspace diff skips identity: only the state-diff rung decides it, even when it equals the expected value.',
    contract: IDENTITY,
  },
  // Value checks for code
  recompute: {
    text: 'The recompute rung runs the produced and the gold computation on the given and changed inputs.',
    contract: RECOMPUTE,
    reused: true,
  },
  'changed-inputs-fail': {
    text: 'The recompute rung emits changed_inputs_fail: true when the given inputs agree and a changed input set differs, and only then.',
    contract: RECOMPUTE,
  },
  'significant-digits': {
    text: 'The recompute rung compares numbers at numbers_significant_digits, 12 by default.',
    contract: RECOMPUTE,
  },
  'state-diff': {
    text: 'The state-diff rung compares the net workspace diff with the expected and allowed changes.',
    contract: DIFF,
    reused: true,
  },
  // Attribution
  'attribution-undefined': {
    text: 'attributionOf returns undefined when no block carries a diagnosis and no fix plan is given, and a summary otherwise.',
    contract: ATTRIBUTION,
  },
  'attribution-unassigned-no-failure': {
    text: 'attributionOf counts a run with no block failure as unassigned when its end state does not match or it has no blocks.',
    contract: ATTRIBUTION,
  },
  'attribution-rate-text': {
    text: 'The scorecard writes the agent rate with its denominator: <k> of <n> assigned runs; <u> unassigned.',
    contract: ATTRIBUTION,
  },
  'badge-hash8': {
    text: 'attributionOf writes each non-default object as kind:id@hash8, the first 8 hex of the recorded hash.',
    contract: BADGE,
  },
  'badge-html': {
    text: 'The HTML scorecard prints a non-default badge when a block was scored with an object whose id is not default.',
    contract: BADGE,
  },
  'fix-fields-kept': {
    text: 'attributionOf keeps every field of each fix of the plan as it was given.',
    contract: BADGE,
  },
  'blame-facts': {
    text: "Blame reads the value's source and change, and the tool's contract, from the run's value facts.",
    contract: BLAME,
    reused: true,
  },
  'blame-r3-disposition': {
    text: 'R3 sets the disposition by the next action: asked the user, retried canonically or recovered is setup; continued, gave up or looped is shared.',
    contract: BLAME,
  },
  'blame-facts-in-verdict': {
    text: 'The step that evaluates the value check writes the value facts, source and change included, into the verdict record of the tool input.',
    contract: BLAME,
  },
  'blame-no-calls': {
    text: 'Blame replays no tool and calls no agent: a run with diagnostics sends each block to the agent once.',
    contract: BLAME,
  },
  // The evidence step
  'step-names': {
    text: 'computeEvidence computes every name without names, returns only the known names asked for, and throws on a name no provider registers, listing the known names.',
    contract: STEP,
  },
  'step-derived': {
    text: 'A derived evidence name is computed after the names it reads, even when it is asked for alone.',
    contract: STEP,
  },
  'step-input-only': {
    text: 'The evidence step reads only its input: a frozen input, or one with only the block and the verdict, is answered without a throw.',
    contract: STEP,
  },
  'step-links': {
    text: 'The links of a failing verdict are the links whose verdict is its id, or a prefix of it ending with *.',
    contract: STEP,
  },
  'step-subject': {
    text: 'The subject tool of a verdict is the tool of its first value fact, else the tool its id names, a label with dots included.',
    contract: STEP,
  },
  'step-paths': {
    text: 'A skill path is skills/<name>/... at any depth, and a main file is a SKILL.md body or a file outside every skill folder, agents/ and guards/.',
    contract: STEP,
  },
  // Section registry and localize
  'init-unique-quote': {
    text: 'radius sections init exits 2 when a section holds no quote that is unique in the prompt.',
    contract: REGISTRY,
  },
  'localize-stale': {
    text: 'radius localize leaves stale links out of the Ochiai counts and reports them as advisory.',
    contract: LOCALIZE,
  },
  'localize-covers': {
    text: 'radius localize ranks local sections by Ochiai over the linked blocks of the stored runs.',
    contract: LOCALIZE,
    reused: true,
  },
} as const satisfies Record<string, Cause>;

export type C2Cause = keyof typeof CAUSES;
