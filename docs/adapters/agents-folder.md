# Shared agents folder reader

The `agents-folder` reader inventories shared agent definitions from a source declared in
`driftbench.setup.yaml`. The source folder may be named `.agents`, `dot_agents`, or another name: locators
are relative to the source root. Runtime deployment is declared once in the setup file.

```yaml
sources:
  - id: shared
    path: .agents
    kind: directory
    reader: agents-folder
    bindings:
      - runtime: claude-code
        deployedRoot: project
        deployedPath: .claude
        method: link
      - runtime: codex
        deployedRoot: home
        deployedPath: .agents
        method: copy
```

Declare the `project` and `home` sources referenced by these bindings in the same `sources` list.
`deployedRoot` can also name another source id. A home folder is read only through its explicit mapping.
Paths are resolved by the setup parser; `~` is literal. Equal contents do not imply an intended copy.

## Declared parts

| Type | Source-relative locator | Aspects | Loaded |
| --- | --- | --- | --- |
| instruction | `AGENTS.md`, `instructions/**/*.md` | instructs | always |
| skill | `skills/*/`, entry `SKILL.md` | instructs | on-demand |
| skill-reference | `references/**` inside a skill | informs | by-reference |
| helper | `helpers/**/*.md`, `agents/**/*.md` | delegates, instructs | on-demand |
| guard | `guards/*.{json,yaml,yml}` | guards | on-event |
| script | `scripts/**/*.{py,sh,bash,js,mjs,cjs,ts}` | executes | by-reference |

Skills and helpers read `name` and `description` from Markdown frontmatter and the remaining body as
instructions. A skill defaults its name to its folder; a helper defaults to its file name. Instructions
read the whole file. References preserve their text, and scripts preserve their code without running it.

A guard declaration has structured `name`, `event`, `script`, and `target` fields. Its paths are relative
to the source root:

```yaml
name: ledger-check
event: before-write
script: scripts/check.py
target: skills/reconcile/SKILL.md
```

## Declared links

An instruction line beginning with `@` includes the named file. Markdown links reference the file their
destination names. A guard references its script and guards its declared target. Resolution uses paths
and structured fields; wording in prose does not create a link. Unresolved paths are reported rather
than linked to a similarly named file.

Each emitted link uses the common model's kind, source file and line, reader provenance, and confidence.
Bindings describe runtime deployment independently of the shared definitions. Copies and links both
retain their explicit deployment method.

## File boundaries and coverage

The source adapter reads the folder supplied to `read(root)`. Doctor supplies a filtered snapshot for
that argument; `setupSource.root` records the original source for provenance. It never selects files
to reopen. `snapshotRoots` names the other explicitly mapped, filtered source snapshots.

A link is followed only inside those snapshots. A link back to an original, unfiltered folder is
skipped. Cycles, broken links, inaccessible entries, files over 1 MiB, binary files and invalid UTF-8
each receive a skipped entry with a reason. Empty and unclassified text files remain in the inventory
so the common model can report unknown coverage. No implicit home configuration is read.

The fictional fixture is under `packages/estate/test/fixtures/readers/agents-folder/`. Its Python
script throws if executed; the reader only reads its bytes. The generated conformance cases plant
positive and negative examples for every declared type, aspect and link kind, and compare semantic
findings after moving sources or renaming declared parts.
