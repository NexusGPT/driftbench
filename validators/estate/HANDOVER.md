# Handover: validator estate

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
| 2 | 0 |
| 3 | 0 |
| hidden | 0 |
<!-- level-table:end -->

Iteration 25, source 0c47eb60e3d18548d8f7db3237768c5361577d7d plus the change recorded in this journal row. Hidden seed {'seed': 207039904, 'source': 'head', 'head': '0c47eb60e3d18548d8f7db3237768c5361577d7d'}.
Reader passes 582/641 on seed 1. Other seeds are recorded in the journal and capture.

## Floor

Estate has no floor. No floor or validator item is edited by this executor.

## Open items

- scan.registry.md-label-lowercase: [scan.registry, tier 3] the guard enforces the rules of a label written in lower case: missed the enforces edge scan.registry.md-label-lowercase:guard to scan.registry.md-label-lowercase:rule0
- scan.steps.process-array: [scan.steps, tier 3] the reader reads the stages of an array of named processes: missed stage shelf4-s1 at .claude/shelf4-processes.json:4; missed stage shelf4-s2 at .claude/shelf4-processes.json:5; missed stage shelf4-s3 at .claude/shelf4-processes.json:6; missed stage shelf4-s4 at .claude/shelf4-processes.json:7
- scan.steps.keyed-by-id: [scan.steps, tier 3] the reader reads the stages of steps keyed by their id: missed stage route5-s1 at .claude/route5-steps.json:3; missed stage route5-s2 at .claude/route5-steps.json:4; missed stage route5-s3 at .claude/route5-steps.json:5; missed stage route5-s4 at .claude/route5-steps.json:6
- scan.steps.nested-workflow: [scan.steps, tier 3] the reader reads the stages of steps nested under a workflow key: missed stage invoice11-s1 at .claude/invoice11-workflow.json:4; missed stage invoice11-s2 at .claude/invoice11-workflow.json:5; missed stage invoice11-s3 at .claude/invoice11-workflow.json:6; missed stage invoice11-s4 at .claude/invoice11-workflow.json:7
- scan.steps.comments: [scan.steps, tier 4] the reader reads the stages of JSON with comments: missed stage roster15-s1 at .claude/roster15-steps.jsonc:4; missed stage roster15-s2 at .claude/roster15-steps.jsonc:5; missed stage roster15-s3 at .claude/roster15-steps.jsonc:6; missed stage roster15-s4 at .claude/roster15-steps.jsonc:7
- scan.steps.trailing-commas: [scan.steps, tier 4] the reader reads the stages of JSON with trailing commas: missed stage invoice16-s1 at .claude/invoice16-steps.json:3; missed stage invoice16-s2 at .claude/invoice16-steps.json:4; missed stage invoice16-s3 at .claude/invoice16-steps.json:5; missed stage invoice16-s4 at .claude/invoice16-steps.json:6
- scan.catalogue.guard-command-key: [scan.catalogue, tier 4] the reader reads the guard by its command: missed the enforces edge scan.catalogue.guard-command-key:guard to scan.catalogue.guard-command-key:rule0; scan.catalogue.guard-command-key:guard: registry is undefined, expected "C15"
- scan.dispatcher.change-folder: [scan.dispatcher, tier 3] a guard declared with a change into the project folder first names and finds its script: scan.dispatcher.change-folder:guard: anchored is false, expected true
- scan.dispatcher.shell-wrapper: [scan.dispatcher, tier 4] a guard declared with a shell wrapper with a quoted command names and finds its script: scan.dispatcher.shell-wrapper:guard: script is "python3 $CLAUDE_PROJECT_DIR/.claude/guards/crate-review-oh9oal.py", expected ".claude/guards/crate-review-oh9oal.py"; scan.dispatcher.shell-wrapper:guard: anchored is false, expected true
- scan.reference-prose.text-file: [scan.reference-prose, tier 3] the scan reads the rules of a plain text reference: missed instruction at .claude/skills/crate-sort-1ki10ij/references/notes.txt:2
- scan.reference-prose.chained: [scan.reference-prose, tier 4] the scan reads the rules of a reference naming a second reference with its own rule: missed the reference edge scan.reference-prose.chained:skill to scan.reference-prose.chained:inner-ref
- scan.reference-prose.outside-skill: [scan.reference-prose, tier 3] the scan reads the rules of a reference outside any skill, named by the standing instructions: missed instruction at .claude/docs/voucher-check-138qwq4.md:2
- scan.gates.act-update: [scan.gates, tier 3] code reads an act of updating, which is an edit: the pair is Read before updating a ledger, expected Read before Edit
- scan.gates.act-rename: [scan.gates, tier 3] code reads an act of renaming, which is a shell move: the pair is Read before renaming a permit file, expected Read before Bash
- scan.gates.markdown-link: [scan.gates, tier 3] code reads a first file named by a markdown link: the path is undefined
- scan.gates.two-on-one-line: [scan.gates, tier 4] code reads two gates on one line: missed gate at .claude/skills/pallet-plan-18ua4sm/SKILL.md:9
- scan.gates.decoy-example: [scan.gates, tier 4] code reads a decoy: the form quoted as an example: found gate gate.roster-plan-kfv8rz.read-the-before-editing at .claude/skills/roster-plan-kfv8rz/SKILL.md:9, never planted
- scan.gates.then-form: [scan.gates, tier 3] code reads read Y first, then X: missed gate at .claude/skills/crate-check-13atzkc/SKILL.md:9
- scan.gates.without-form: [scan.gates, tier 3] code reads never X without reading Y: missed gate at .claude/skills/permit-pack-w8j8t1/SKILL.md:9
- scan.gates.only-after-form: [scan.gates, tier 3] code reads X only after reading Y: missed gate at .claude/skills/menu-pack-1yxt01q/SKILL.md:9
- scan.gates.question-form: [scan.gates, tier 4] code reads the act as a question: X? read Y first: missed gate at .claude/skills/voucher-check-1xamgvx/SKILL.md:9
- scan.gates.prior-to-form: [scan.gates, tier 3] code reads prior to X, read Y: missed gate at .claude/skills/ledger-check-tyeeiv/SKILL.md:9
- scan.hazards.status-429: [scan.hazards, tier 3] code reads a rate limit called a 429: missed hazard rate_wave at .claude/skills/menu-count-dqzflh/SKILL.md:9
- scan.hazards.reboot: [scan.hazards, tier 3] code reads a restart called a reboot: missed hazard restart at .claude/skills/route-check-c9u5qq/SKILL.md:9
- scan.hazards.resumed: [scan.hazards, tier 3] code reads a session resumed the next day: missed hazard session_boundary at .claude/skills/pallet-check-mokh4w/SKILL.md:9
- scan.hazards.decoy-price: [scan.hazards, tier 3] code reads a decoy: nudging a price: found hazard hazard.pallet-update-14rrbst.recover-from-repeated-guard-nudges at .claude/skills/pallet-update-14rrbst/SKILL.md:9, never planted
- scan.paths.backslashes: [scan.paths, tier 4] code reads a path written with backslashes: missed reference .claude/skills/permit-update-3jjukw/references/guide.md at .claude/skills/permit-update-3jjukw/SKILL.md:9; found reference reference.permit-update-3jjukw.read-references-guide-md at .claude/skills/permit-update-3jjukw/SKILL.md:9, never planted
- scan.paths.bold-path: [scan.paths, tier 4] code reads a path in bold, not in backticks: missed reference .claude/skills/ledger-pack-1s3cep/references/guide.md at .claude/skills/ledger-pack-1s3cep/SKILL.md:9
- scan.paths.import-syntax: [scan.paths, tier 4] code reads an import written @path: missed reference .claude/skills/voucher-check-5tiw43/references/guide.md at .claude/skills/voucher-check-5tiw43/SKILL.md:9
- scan.paths.line-number: [scan.paths, tier 3] code reads a path followed by a line number: missed reference .claude/skills/badge-close-5qmys8/references/guide.md at .claude/skills/badge-close-5qmys8/SKILL.md:9
- scan.paths.bare-path: [scan.paths, tier 3] code reads a bare path with no markup: missed reference .claude/skills/badge-price-5pf588/references/guide.md at .claude/skills/badge-price-5pf588/SKILL.md:9
- scan.paths.project-dir: [scan.paths, tier 4] code reads a path from the project folder variable: missed reference .claude/skills/voucher-sort-7gnm1j/references/guide.md at .claude/skills/voucher-sort-7gnm1j/SKILL.md:9
- scan.paths.angle-autolink: [scan.paths, tier 3] code reads a path in angle brackets: missed reference .claude/skills/ledger-check-179s3xt/references/guide.md at .claude/skills/ledger-check-179s3xt/SKILL.md:9
- scan.paths.wiki-link: [scan.paths, tier 4] code reads a wiki link without its extension: missed reference .claude/skills/voucher-close-1xf755r/references/guide.md at .claude/skills/voucher-close-1xf755r/SKILL.md:9
- scan.combination.colon+crlf: [scan.combination, tier 4] the reader reads a skill with both colon and crlf: missed route shelf-review-3dpxle at .claude/skills/shelf-review-3dpxle/SKILL.md:3; missed the route edge scan.combination.colon+crlf:route to scan.combination.colon+crlf:skill
- scan.combination.prefixguard+crlf: [scan.combination, tier 4] the reader reads a skill with both prefixguard and crlf: missed route permit-update-f38gr8 at .claude/skills/permit-update-f38gr8/SKILL.md:3; missed guard check.sh at .claude/skills/permit-update-f38gr8/SKILL.md:10; found script script.permit-update-f38gr8.script-scripts-check-sh at .claude/skills/permit-update-f38gr8/scripts/check.sh:2, never planted; missed the route edge scan.combination.prefixguard+crlf:route to scan.combination.prefixguard+crlf:skill
- scan.hostile.hooks-wrong-shape: [scan.hostile, tier 3] the scan survives hooks given as an object, not a list: noted: no note names .claude/settings.json
- scan.hostile.prompt-hook: [scan.hostile, tier 3] the scan survives a hook of type prompt is a guard with no script: missed guard check-the-reply at .claude/settings.json:3
- scan.hostile.duplicate-names: [scan.hostile, tier 3] the scan survives two skill folders with one name: both read, noted: no note names the shared name
- scan.hostile.helper-subfolder: [scan.hostile, tier 3] the scan survives a helper in a subfolder of the helpers folder: missed subagent voucher-audit-1xtpv3h at .claude/agents/team/voucher-audit-1xtpv3h.md:2; missed route voucher-audit-1xtpv3h at .claude/agents/team/voucher-audit-1xtpv3h.md:3
- scan.hostile.tabs-in-frontmatter: [scan.hostile, tier 3] the scan survives a frontmatter indented with tabs: found tool tool.menu-count-1dxpozt.declared-read at .claude/skills/menu-count-1dxpozt/SKILL.md:5, never planted
- scan.decoys.owner-table: [scan.decoys, tier 3] code is not fooled: a table of owners that names a skill is no routing table: found route route.standing.an-ask-to-ana-loads-shelf at CLAUDE.md:4, never planted
- scan.decoys.changelog-reference: [scan.decoys, tier 4] code is not fooled: a file named in a change note is no reference: found reference reference.parcel-review-14oprfr.read-references-legacy-md at .claude/skills/parcel-review-14oprfr/SKILL.md:12, never planted
- scan.decoys.form-number-label: [scan.decoys, tier 4] code is not fooled: a form number that reads like a rule label cites no rule: a form number cited a rule
- scan.decoys.guard-message-overlap: [scan.decoys, tier 4] code is not fooled: a guard message that quotes part of a rule's words is no enforcement: the guard enforces a rule it only quotes in passing
- scan.decoys.script-name-in-prose: [scan.decoys, tier 3] code is not fooled: a script's name mentioned in passing anchors no script on that line: missed script .claude/skills/label-review-18xh08m/scripts/tally.py at .claude/skills/label-review-18xh08m/SKILL.md:10; found script script.label-review-18xh08m.script-scripts-tally-py at .claude/skills/label-review-18xh08m/SKILL.md:9, never planted
- scan.decoys.hazard-in-example-quote: [scan.decoys, tier 4] code is not fooled: a hazard word inside a quoted example is no hazard: found hazard hazard.menu-audit-6c2zvj.recover-from-a-wave-of-rate at .claude/skills/menu-audit-6c2zvj/SKILL.md:10, never planted
- scan.standing.linked-file: [scan.standing, tier 3] the reader reads a routing cell linking to the skill file: missed route route-pack-j6n1na at CLAUDE.md:7; found reference reference.standing.read-claude-skills-route-pack-j6n1na at CLAUDE.md:7, never planted
- scan.standing.slash-command: [scan.standing, tier 3] the reader reads a routing cell naming the skill as a slash command: missed route crate-count-10pk7r5 at CLAUDE.md:7
- scan.standing.skill-first: [scan.standing, tier 4] the reader reads a routing table whose first column names the skill: missed route route-check-11jwa9m at CLAUDE.md:5
- scan.standing.no-outer-pipes: [scan.standing, tier 3] the reader reads a routing table written without outer pipes: missed route pallet-price-11y7li9 at CLAUDE.md:5
- scan.standing.list-item: [scan.standing, tier 3] the reader reads routing written as a list item: missed route crate-audit-1wyhk4c at CLAUDE.md:5
- scan.standing.sentence: [scan.standing, tier 4] the reader reads routing written as a sentence: missed route voucher-close-1713qix at CLAUDE.md:5
- scan.standing.heading-per-skill: [scan.standing, tier 4] the reader reads routing written as a heading per skill: missed route roster-count-ftj8gw at CLAUDE.md:5
- scan.standing.nested-standing: [scan.standing, tier 3] the reader reads a standing file in a subfolder: missed instruction at src/badge/CLAUDE.md:3
- scan.standing.imported-standing: [scan.standing, tier 4] the reader reads a file the standing file imports: missed instruction at .claude/docs/badge-rules.md:3
- blind.gates.decoy-never-read-before: [blind.gates, tier 4] the reader reads a line that forbids reading a file before an act and finds no gate in it: a gate atom gate.standing.read-docs-6si7tm-rules-md-before at CLAUDE.md:3, none planted
- blind.lint.emoji-count-as-characters: [blind.lint, tier 4] lint finds no oversize finding for a standing file of 30,000 emoji: a OVERSIZE finding: the standing instructions hold 60317 characters, over the ceiling of 40000
- blind.edges.dispatch-plain-name: [blind.edges, tier 3] the reader reads a skill body that dispatches a helper by its plain name: no dispatch edge from skill at .claude/skills/orchard-plan-7beyan/SKILL.md

## Hypotheses tried

Normalize explicit scalar successors and then aliases; infer sequential edges only when successors are undeclared. Initial round25 capture hit ENOSPC; retained round25.json and reran unchanged source after freeing unrelated comparison files.
Fixed this round: blind.edges.next-edges-direction, blind.edges.next-edges-four-steps, scan.steps.next-string, scan.steps.then-key. Regressions: none.
Earlier rounds remain in journal.jsonl. Initial macOS baseline on 14034c6ca is 574/641, level 0 on seeds 1, 2, 3 and hidden 336760492.
Linux CI reports 551/641 because all 23 symlink items fail during fixture construction before product code runs.
The loop fixture passes an empty symlink target; a separate maintainer lane owns that correction.

## Next actions

1. Read the latest journal row and failure list; fix the next product root cause with a failing regression test first.
2. Run estate tests and the validator on seeds 1, 2, 3 and the commit-derived hidden seed. Keep every item and threshold unchanged.
3. When reader passes all four seeds, push and open a draft PR; continue upward and push each reached level.

## Pitfalls

- Use exactly one worktree on feat/estate-reader-level1. Every git call uses git -C.
- Run host tests outside the outer sandbox: otherwise tsx sockets and nested sandbox-exec fail independently of the product.
- Only packages/estate product changes, its tests, this handover and journal are authorized. Report suspected oracle errors to the lead.
- No paid calls, secrets, full suite, new copies or extra worktrees. Disk is tight.
- Commit trailer: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>.
- PR footer: 🤖 Generated with [Claude Code](https://claude.com/claude-code).
- Keep node_modules and worktree until the final push, then remove both.

## How to run

```sh
pnpm exec vitest run packages/estate/test
pnpm -s driftbench validate estate --seeds 1..3 --hidden --json
pnpm -s driftbench validate estate --journal .cache/estate-climb/journal-row.json
```

Latest captures: .cache/estate-climb/round24.json, .cache/estate-climb/round25-recovered.json. Local captures are not pushed.
The current run follows the user's four-seed milestone; no unmeasured 1..20 sweep is claimed.

## Fixtures

The fictional inputs live in packages/validators/src/ladders/estate/bank and examples/estates/fixture.
Product regressions live under packages/estate/test. No validator fixtures are edited.
