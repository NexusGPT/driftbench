/**
 * The cause of every item of the estate bank (docs/validators.md section 12.4 point 4): the one change to the
 * component that would make the item pass, written by the bank's author. Items sharing a cause count once in the
 * hardness gate. Three sources, first match wins: the items a pilot change made pass carry that change; the
 * failing items carry the change their failure names (the gap marker of a generated spec, the reader form a
 * planted line uses); every other item is its own cause. An item that needs two changes carries the one its
 * failure names first, so the count of causes never exceeds the changes an executor makes.
 */

/** Items whose cause a first pilot (on the reader before the reader lane merged) named by the change that fixed them. */
const FIXED: ReadonlyArray<readonly [string, string]> = [
  ['scan.frontmatter.colon-in-value', 'read a frontmatter value holding a colon and a space'],
  ['scan.frontmatter.colon-twice', 'read a frontmatter value holding a colon and a space'],
  ['scan.frontmatter.colon-in-other-key', 'read a frontmatter value holding a colon and a space'],
  ['scan.frontmatter.agent-colon-in-value', 'read a frontmatter value holding a colon and a space'],
  ['scan.symlink.skill-folder-inside', 'follow symbolic links when walking the estate'],
  ['scan.symlink.skill-folder-outside', 'follow symbolic links when walking the estate'],
  ['scan.symlink.skill-folder-absolute', 'follow symbolic links when walking the estate'],
  ['scan.symlink.skill-folder-hidden-target', 'follow symbolic links when walking the estate'],
  ['scan.symlink.skill-folder-spaced-target', 'follow symbolic links when walking the estate'],
  ['scan.symlink.skill-folder-chain', 'follow symbolic links when walking the estate'],
  ['scan.symlink.skill-file', 'follow symbolic links when walking the estate'],
  ['scan.symlink.skill-renamed', 'follow symbolic links when walking the estate'],
  ['scan.symlink.agent-file', 'follow symbolic links when walking the estate'],
  ['scan.symlink.references-folder', 'follow symbolic links when walking the estate'],
  ['scan.symlink.script-file', 'follow symbolic links when walking the estate'],
  ['scan.symlink.nested-link', 'follow symbolic links when walking the estate'],
  ['scan.symlink.dangling', 'follow symbolic links when walking the estate'],
  ['scan.symlink.loop', 'follow symbolic links when walking the estate'],
  ['scan.symlink.guard-script', 'follow symbolic links when walking the estate'],
  ['scan.symlink.memory-folder', 'follow symbolic links when walking the estate'],
  ['scan.symlink.steps-file', 'follow symbolic links when walking the estate'],
  ['scan.symlink.skills-folder', 'follow symbolic links when walking the estate'],
  ['scan.symlink.agents-folder', 'follow symbolic links when walking the estate'],
  ['scan.symlink.settings-file', 'follow symbolic links when walking the estate'],
  ['scan.symlink.agent-in-linked-skill-library', 'follow symbolic links when walking the estate'],
  ['scan.registry.md-adapter', 'know the registry column names estates use'],
  ['scan.registry.md-name', 'know the registry column names estates use'],
  ['scan.registry.md-file', 'know the registry column names estates use'],
  ['scan.registry.md-handler', 'know the registry column names estates use'],
  ['scan.registry.md-gates', 'know the registry column names estates use'],
  ['scan.registry.md-covers', 'know the registry column names estates use'],
  ['scan.registry.md-enforced-rules', 'know the registry column names estates use'],
  ['scan.registry.md-rule-ids', 'know the registry column names estates use'],
  ['scan.registry.md-bold-headers', 'know the registry column names estates use'],
  ['scan.registry.json-rules-key', 'read a catalogue of checks'],
  ['scan.registry.json-hook-key', 'read a catalogue of checks'],
  ['scan.steps.process-map', 'read process maps as step lists'],
  ['scan.steps.process-map-two', 'read process maps as step lists'],
  ['scan.steps.next-string', 'read a step successor given as one id or under then'],
  ['scan.steps.then-key', 'read a step successor given as one id or under then'],
  ['scan.steps.hooks-lib', 'read process maps as step lists'],
  ['scan.catalogue.upper-json', 'read a catalogue of checks'],
  ['scan.catalogue.lower-json', 'read a catalogue of checks'],
  ['scan.catalogue.american-spelling', 'read a catalogue of checks'],
  ['scan.catalogue.prefixed-name', 'read a catalogue of checks'],
  ['scan.catalogue.in-hooks-folder', 'read a catalogue of checks'],
  ['scan.catalogue.hooks-key', 'read a catalogue of checks'],
  ['scan.catalogue.entries-key', 'read a catalogue of checks'],
  ['scan.catalogue.guard-script-key', 'read a catalogue of checks'],
  ['scan.catalogue.guard-file-key', 'read a catalogue of checks'],
  ['scan.catalogue.guard-path-key', 'read a catalogue of checks'],
  ['scan.catalogue.enforces-key', 'read a catalogue of checks'],
  ['scan.catalogue.gates-key', 'read a catalogue of checks'],
  ['scan.catalogue.two-rules', 'read a catalogue of checks'],
  ['scan.catalogue.pretty', 'read a catalogue of checks'],
  ['scan.catalogue.markdown-table', 'read a catalogue of checks'],
  ['scan.dispatcher.quiet-prefix', 'find the script behind a command prefix'],
  ['scan.dispatcher.test-prefix', 'find the script behind a command prefix'],
  ['scan.dispatcher.env-runner', 'find the script behind a command prefix'],
  ['scan.dispatcher.assignment-prefix', 'find the script behind a command prefix'],
  ['scan.dispatcher.time-limit', 'find the script behind a command prefix'],
  ['scan.dispatcher.exec', 'find the script behind a command prefix'],
  ['scan.dispatcher.uv-run', 'find the script behind a command prefix'],
  ['scan.gates.bold-act', 'strip markup from a gate act and its first file'],
  ['scan.hazards.decoy-compact-table', 'read compaction only from the noun, not the adjective compact'],
  ['scan.paths.link-anchor', 'name the file of a path with an anchor, a query or a title'],
  ['scan.paths.link-title', 'name the file of a path with an anchor, a query or a title'],
  ['scan.paths.query', 'name the file of a path with an anchor, a query or a title'],
  ['scan.paths.decoy-url', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.linked+colon', 'read a frontmatter value holding a colon and a space'],
  ['scan.combination.linked+block', 'follow symbolic links when walking the estate'],
  ['scan.combination.linked+anchorlink', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.linked+hazarddecoy', 'read compaction only from the noun, not the adjective compact'],
  ['scan.combination.linked+gatebold', 'strip markup from a gate act and its first file'],
  ['scan.combination.linked+prefixguard', 'find the script behind a command prefix'],
  ['scan.combination.linked+crlf', 'follow symbolic links when walking the estate'],
  ['scan.combination.linked+urldecoy', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.colon+anchorlink', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.colon+hazarddecoy', 'read compaction only from the noun, not the adjective compact'],
  ['scan.combination.colon+gatebold', 'strip markup from a gate act and its first file'],
  ['scan.combination.colon+prefixguard', 'find the script behind a command prefix'],
  ['scan.combination.colon+urldecoy', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.block+anchorlink', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.block+hazarddecoy', 'read compaction only from the noun, not the adjective compact'],
  ['scan.combination.block+gatebold', 'strip markup from a gate act and its first file'],
  ['scan.combination.block+prefixguard', 'find the script behind a command prefix'],
  ['scan.combination.block+urldecoy', 'name the file of a path with an anchor, a query or a title'],
  [
    'scan.combination.anchorlink+hazarddecoy',
    'read compaction only from the noun, not the adjective compact',
  ],
  ['scan.combination.anchorlink+gatebold', 'strip markup from a gate act and its first file'],
  ['scan.combination.anchorlink+prefixguard', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.anchorlink+crlf', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.anchorlink+urldecoy', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.hazarddecoy+gatebold', 'read compaction only from the noun, not the adjective compact'],
  [
    'scan.combination.hazarddecoy+prefixguard',
    'read compaction only from the noun, not the adjective compact',
  ],
  ['scan.combination.hazarddecoy+crlf', 'read compaction only from the noun, not the adjective compact'],
  ['scan.combination.hazarddecoy+urldecoy', 'read compaction only from the noun, not the adjective compact'],
  ['scan.combination.gatebold+prefixguard', 'strip markup from a gate act and its first file'],
  ['scan.combination.gatebold+crlf', 'strip markup from a gate act and its first file'],
  ['scan.combination.gatebold+urldecoy', 'strip markup from a gate act and its first file'],
  ['scan.combination.prefixguard+urldecoy', 'name the file of a path with an anchor, a query or a title'],
  ['scan.combination.crlf+urldecoy', 'name the file of a path with an anchor, a query or a title'],
  ['lint.defect.unanchored-behind-prefix', 'find the script behind a command prefix'],
  ['lint.defect.missing-by-anchored-link', 'name the file of a path with an anchor, a query or a title'],
  ['lint.defect.orphan-in-linked-skill', 'follow symbolic links when walking the estate'],
  ['lint.defect.catalogue-entry-without-guard', 'read a catalogue of checks'],
  ['lint.clean.catalogue', 'read a catalogue of checks'],
  ['lint.clean.guard-behind-prefix', 'find the script behind a command prefix'],
  ['lint.clean.reference-by-anchored-link', 'name the file of a path with an anchor, a query or a title'],
  ['lint.clean.linked-guard-script', 'follow symbolic links when walking the estate'],
];

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Registries, catalogues and step lists.
  [
    /^(scan\.registry\.yaml|scan\.catalogue\.yaml|scan\.steps\.yaml|lint\.clean\.yaml-registry)$/,
    'read YAML wherever a JSON registry, catalogue or step list is read',
  ],
  [/^scan\.registry\.md-label-lowercase$/, 'match registry labels without regard to case'],
  [/^scan\.registry\.md-guard-no-extension$/, 'match a guard named without its file extension'],
  [/^scan\.registry\.md-guard-link$/, 'read a guard cell written as a markdown link'],
  [/^scan\.registry\.json-guards-key$/, 'read a JSON registry whose rows sit under a guards key'],
  [
    /^scan\.(registry\.json-enforces-string|catalogue\.rules-string)$/,
    'read a rules field given as one string',
  ],
  [
    /^scan\.(registry\.json-enforces-objects|catalogue\.rules-objects)$/,
    'read a rules field given as objects with ids',
  ],
  [/^scan\.catalogue\.keyed-by-id$/, 'read catalogue entries keyed by their id'],
  [/^scan\.catalogue\.by-event$/, 'read catalogue entries grouped by event'],
  [/^scan\.catalogue\.wrapped$/, 'read a catalogue inside a version wrapper'],
  [/^scan\.catalogue\.guard-command-key$/, 'match a catalogue guard given by its command'],
  [/^scan\.steps\.process-array$/, 'read processes given as an array of named processes'],
  [/^scan\.steps\.keyed-by-id$/, 'read step lists keyed by stage id'],
  [/^scan\.steps\.nested-workflow$/, 'find a step list nested under another key'],
  [/^scan\.steps\.same-ids$/, 'scope stage ids to their process'],
  [/^scan\.steps\.(comments|trailing-commas)$/, 'parse JSON with comments and trailing commas'],
  [/^scan\.steps\.name-key$/, 'read a stage named under a name key'],
  // Dispatchers.
  [
    /^(scan\.dispatcher\.dispatcher(-with-prefix)?|lint\.defect\.dispatcher-target-missing|lint\.clean\.guard-by-dispatcher)$/,
    'resolve the script a dispatcher runs from its target argument',
  ],
  [/^scan\.dispatcher\.change-folder$/, 'count a script reached through a change of folder as anchored'],
  [/^scan\.dispatcher\.shell-wrapper$/, 'unwrap a quoted shell wrapper to find its script'],
  [/^scan\.dispatcher\.dispatcher-flag$/, 'resolve a dispatcher target given by a flag'],
  // Reference files.
  [/^scan\.reference-prose\.(large|huge-chunked)$/, 'split a reference over 40,000 characters into chunks'],
  [/^scan\.reference-prose\.nested-folder$/, 'read references in nested folders'],
  [/^scan\.reference-prose\.text-file$/, 'read plain text references'],
  [
    /^(scan\.reference-prose\.chained|lint\.defect\.missing-inside-reference|lint\.clean\.nested-reference)$/,
    'follow references named inside references',
  ],
  [
    /^scan\.reference-prose\.outside-skill$/,
    'read references the standing instructions name outside any skill',
  ],
  [/^scan\.reference-prose\.named-twice$/, 'read a reference two skills share once'],
  [/^scan\.reference-prose\.(fixed-gate-inside|hazard-inside)$/, 'run the code readers over reference files'],
  // A combination fails on the form the reader lacks: the first in this order.
  [
    /^scan\.combination\..*(anchorlink|urldecoy)/,
    'name the file of a path with an anchor, a query or a title',
  ],
  [/^scan\.combination\..*gatebold/, 'strip markup from a gate act and its first file'],
  [/^scan\.combination\..*hazarddecoy/, 'read compaction only from the noun, not the adjective compact'],
  [
    /^scan\.(reference-prose\.|combination\..*refprose)/,
    'send the reference files a skill names to the prose splitter',
  ],
  [
    /^scan\.combination\.(colon\+crlf|prefixguard\+crlf)$/,
    'strip carriage returns from a skill definition before reading it',
  ],
  // Gates.
  [/^scan\.gates\.act-(update|rename)$/, 'map act verbs to the tool they use'],
  [/^scan\.gates\.markdown-link$/, "read a gate's first file given as a markdown link"],
  [/^scan\.gates\.two-on-one-line$/, 'read two gates on one line'],
  [
    /^scan\.gates\.decoy-(lunch|panic|time|history)$/,
    'read a gate only when its event is an act of the agent',
  ],
  [/^(scan\.gates\.decoy-example|scan\.decoys\.hazard-in-example-quote)$/, 'skip quoted examples'],
  [/^scan\.gates\.then-form$/, 'read the gate form: read Y first, then X'],
  [/^scan\.gates\.without-form$/, 'read the gate form: never X without reading Y'],
  [/^scan\.gates\.only-after-form$/, 'read the gate form: X only after reading Y'],
  [/^scan\.gates\.question-form$/, 'read the gate form: X? read Y first'],
  [/^scan\.gates\.prior-to-form$/, 'read prior to as a synonym of before in a gate'],
  // Hazards.
  [/^scan\.hazards\.(summarized|window-full)$/, 'know the synonyms of compaction'],
  [/^scan\.hazards\.status-429$/, 'know the synonyms of a rate limit'],
  [/^scan\.hazards\.reboot$/, 'know the synonyms of a restart'],
  [/^scan\.hazards\.resumed$/, 'know the synonyms of a session boundary'],
  [
    /^scan\.hazards\.decoy-(printer|contract|customer|course)$/,
    "read a hazard only when it concerns the agent's own runtime",
  ],
  [/^scan\.hazards\.decoy-price$/, 'read a nudge only when a guard gives it'],
  // Paths.
  [
    /^(scan\.paths\.(link-angle|spaced-name)|lint\.clean\.reference-with-space)$/,
    'read file names holding a space',
  ],
  [/^scan\.paths\.backslashes$/, 'read paths written with backslashes'],
  [/^scan\.paths\.bold-path$/, 'read paths in bold'],
  [/^scan\.paths\.import-syntax$/, 'read @path imports'],
  [/^scan\.paths\.line-number$/, 'read a path followed by a line number'],
  [/^scan\.paths\.bare-path$/, 'read a bare path with no markup'],
  [/^scan\.paths\.(single|double)-quoted$/, 'read paths in quotes'],
  [/^scan\.paths\.html-link$/, 'read HTML links'],
  [/^scan\.paths\.project-dir$/, 'read a path from the project folder variable'],
  [/^scan\.paths\.angle-autolink$/, 'read a path in angle brackets'],
  [/^scan\.paths\.wiki-link$/, 'read wiki links and add their extension'],
  // Standing instructions.
  [
    /^scan\.standing\.(plain-name|bold-name|helper-plain-name)$/,
    'read a routing cell naming a skill or helper without backticks',
  ],
  [/^scan\.standing\.linked-file$/, 'read a routing cell linking to the skill file as a route'],
  [/^scan\.standing\.slash-command$/, 'read a routing cell naming the skill as a slash command'],
  [/^scan\.standing\.skill-first$/, 'read a routing table whose first column names the skill'],
  [/^scan\.standing\.no-outer-pipes$/, 'read tables written without outer pipes'],
  [/^scan\.standing\.(list-item|sentence)$/, 'read routing written outside tables'],
  [/^scan\.standing\.heading-per-skill$/, 'read routing written as a heading per skill'],
  [/^scan\.standing\.nested-standing$/, 'read standing files in subfolders'],
  [/^scan\.standing\.imported-standing$/, 'read the files a standing file imports'],
  // Hostile inputs.
  [/^scan\.hostile\.empty-(definition|standing)$/, 'anchor no atom in an empty file'],
  [/^scan\.hostile\.wide-folder$/, 'scan a folder of two thousand files within budget'],
  [/^scan\.hostile\.settings-bom$/, 'strip a byte order mark before parsing JSON'],
  [/^scan\.hostile\.hooks-wrong-shape$/, 'note hooks given in the wrong shape'],
  [/^scan\.hostile\.prompt-hook$/, 'read a prompt hook as a guard without a script'],
  [/^scan\.hostile\.duplicate-names$/, 'note two skills sharing a name'],
  [/^scan\.hostile\.helper-subfolder$/, 'read helpers in subfolders'],
  [/^scan\.hostile\.tabs-in-frontmatter$/, 'read frontmatter indented with tabs'],
  // Decoys.
  [/^scan\.decoys\.owner-table$/, 'tell a routing table from another table naming skills'],
  [/^scan\.decoys\.negated-(route|dispatch|reference)$/, 'skip negated sentences'],
  [/^scan\.decoys\.(dispatch|reference|gate|hazard|routing|registry)-in-fence$/, 'skip code fences'],
  [/^scan\.decoys\.reference-in-comment$/, 'skip HTML comments'],
  [/^scan\.decoys\.changelog-reference$/, 'skip change notes'],
  [/^scan\.decoys\.form-number-label$/, 'cite a rule label only where a label can stand'],
  [/^scan\.decoys\.guard-message-overlap$/, 'tie a guard to a rule by its row or label, not by quoted words'],
  [/^scan\.decoys\.script-name-in-prose$/, 'anchor a script only where it is run'],
  // Plan.
  [/^plan\.contract\.journey-route$/, 'walk every route the standing instructions state in a journey'],
  [/^plan\.relevance\./, 'cross each situation only with the atom kinds it acts on'],
  // Generation and agent mutants: the gap marker the generated specs carry.
  [/^(gen\.asks\.|gen\.complete\.route_positive-)/, 'ask k distinct positive phrases per route'],
  [
    /^gen\.complete\.guard_negative-/,
    'expect no fire on an every-turn event only from a guard with a registry verdict',
  ],
  [
    /^gen\.complete\.guard_positive-/,
    'write an approved phrase and a workspace outcome for a pairwise guard row',
  ],
  [/^mutant\.agent\.tool-deny-bare$/, 'report the tools the runtime offers in a replayed session'],
  [/^gen\.complete\.guard_register-/, 'write a guard message check'],
  [/^gen\.complete\.guard_speed-/, 'write a guard timing check'],
  [/^gen\.complete\.invariant-/, 'run invariant specs on a static runner'],
  [
    /^(gen\.complete\.(stage_anytime|stage_order)-stage-anytime|mutant\.agent\.stage-anytime)$/,
    'write a stage reach check',
  ],
  [
    /^gen\.complete\.outside_trigger-instruction-(after-compaction|after-restart|cites|grounded-values|no-webfetch|verify-before-report)$/,
    'plan no outside trigger row for a rule that applies always',
  ],
  [
    /^(gen\.complete\.(dispatch-subagent|journey-|misroute-|obligation-instruction-(dispatch|script)|ordered_pair-|outside_trigger-instruction-(dispatch|script)|read_when-|register_sample-|route_near_miss-|script_fixture-|skip_pressure-|stop_resume-|twin-instruction-(dispatch|script))|mutant\.agent\.(gate|gate-fixed-gate|instruction-dispatch|instruction-script|reference-skill|reference-standing|route-desc-helper|route-table-helper|script)$)/,
    'write a check that some call matches',
  ],
  [
    /^(gen\.complete\.|mutant\.agent\.(hazard|instruction|tool)-)/,
    'write a registered custom check for the rule',
  ],
  [/^mutant\.agent\.gate-read-before-edit$/, 'test the read before the edit so deleting the gate fails it'],
  [/^mutant\.agent\.register-json$/, 'check the JSON register so deleting it fails a test'],
  [
    /^mutant\.agent\.register-lead-with-result$/,
    'check the lead-with-result register so deleting it fails a test',
  ],
  [/^mutant\.agent\.register-reply-length$/, 'check the reply length register so deleting it fails a test'],
  [/^mutant\.agent\.subagent$/, 'test the dispatch so deleting the helper fails it'],
  // Maintenance.
  [
    /^maintain\.impact\.[a-z]+-retires-its-tests$/,
    'retire a test only when all its metadata atoms leave; regenerate it when other atoms remain',
  ],
  [
    /^maintain\.impact\.subagent-retires-nothing-else$/,
    'keep tests with remaining metadata atoms and unrelated tests',
  ],
  [/^maintain\.impact\.addition-touches-nothing$/, 'regenerate nothing for an added rule'],
  [/^maintain\.impact\.spacing-touches-nothing$/, 'compare rules without their spacing'],
  [/^maintain\.impact\.rename-/, 'follow a renamed skill folder by its name'],
  // Scale.
  [/^scale\.(scan|lint)-/, 'read routing rows that continue past the end of a prose chunk'],
  [/^scale\.generate-/, 'generate in time linear in the atoms'],
  [/^scale\.plan-/, 'plan in time linear in the atoms'],
];

const fixed = new Map(FIXED);

/** The cause of an item: the change that would make it pass. */
export function causeOf(id: string, title: string): string {
  const known = fixed.get(id);
  if (known) return known;
  for (const [pattern, cause] of RULES) {
    if (!pattern.test(id)) continue;
    return cause === REGISTERED ? registeredCause(id) : cause;
  }
  return `${id}: ${title}`;
}

const REGISTERED = 'write a registered custom check for the rule';

/**
 * A spec is incomplete for want of a registered check of its custom predicate (generate's
 * `needs-registered-check`): each predicate is its own check, so its own fix. The predicate is the one the
 * estate plants for the role of the atom under test.
 */
const PREDICATES: ReadonlyArray<readonly [RegExp, string]> = [
  [/instruction-after-compaction$/, 'reread_after_compaction'],
  [/instruction-after-restart$/, 'helper_state_after_restart'],
  [/instruction-brief$/, 'brief_fields'],
  [/instruction-cites$/, 'holds_under_pressure'],
  [/instruction-grounded-values$/, 'grounded_values'],
  [/instruction-no-force-push$/, 'command_absent'],
  [/instruction-prohibition$/, 'no_value_change'],
  [/instruction-readonly$/, 'helper_read_only'],
  [/instruction-stop-word$/, 'stops_on_word'],
  [/hazard-after-(compaction|restart)$/, 'hazard_recovery'],
  [/tool-(allow|ask|declared|deny)$/, 'permission'],
];

function registeredCause(id: string): string {
  const found = PREDICATES.find(([pattern]) => pattern.test(id));
  return found ? `register a check for the custom predicate ${found[1]}` : REGISTERED;
}
