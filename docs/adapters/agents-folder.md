# Shared agents folder reader

The `agents-folder` reader inventories shared agent definitions from a source declared in
`driftbench.setup.yaml`. The source folder may be named `.agents`, `dot_agents`, or another name: locators
are relative to the source root. Runtime deployment is declared once in the setup file.

```yaml setup
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
| skill-script | `scripts/**` inside a skill | executes | by-reference |
| helper | `helpers/**/*.md`, `agents/**/*.md` | delegates, instructs | on-demand |
| guard | `guards/*.{json,yaml,yml}` | guards | on-event |
| script | `scripts/**/*.{py,sh,bash,js,mjs,cjs,ts}` | executes | by-reference |

Skills and helpers read `name` and `description` from Markdown frontmatter and the remaining body as
instructions. A skill defaults its name to its folder; a helper defaults to its file name. Instructions
read the whole file. References preserve their text, and scripts preserve their code without running it.

A guard declaration has structured `name`, `event`, `script`, and `target` fields. Its paths are relative
to the source root:

```json
{
  "name": "ledger-check",
  "event": "before-write",
  "script": "scripts/check.py",
  "target": "skills/reconcile/SKILL.md"
}
```

## Map projection in this phase

`AgentsFolderReader` exposes immutable `setupTypes` and returns the existing `RawEstate` contract.
Instructions become standing files and prose, skills and helpers become their existing declarations,
contained references and scripts become skill files, and standalone scripts are retained as script
files. A guard with literal `event` and `script` becomes a guard declaration. Invalid declarations
leave a read note. Removing `instructs` from a source type removes its prose contribution.

Core link selector data is declared for line imports, Markdown references, guard script references and
guard targets. The shared core Part/aspect/Link projection step is pending. This reader does not emit
core links itself. In particular, today's map cannot independently project a standalone script into a
script atom; its file remains present. Deployment bindings stay in the parsed setup metadata.

## File boundaries and coverage

The source adapter reads the folder supplied to `read(root)`. Doctor supplies a filtered snapshot for
that argument; `setupSource.root` records the original source for provenance. It never selects files
to reopen. `snapshotRoots` names the other explicitly mapped, filtered source snapshots.

A link is followed only inside those snapshots. A link back to an original, unfiltered folder is
skipped. Cycles, broken links, inaccessible entries, files over 1 MiB, binary files and invalid UTF-8
each receive a skipped entry with a reason. The canonical `RawEstate.coverage` counts files covered by
types or reached references, lists untyped files under the source as unknown, and retains skipped reasons.
Its profile declares `roots.source: '.'` and `coverageRoots: ['source']`. An unresolved coverage root
refuses the read with code `unknown-coverage-root`. No implicit home configuration is read.

The fictional fixture is under `packages/estate/test/fixtures/readers/agents-folder/`. Its Python
script throws if executed; the reader only reads its bytes. Generated cases check every declared
type against positive and negative locators and RawEstate file kinds. Aspect mutation changes prose.
Independent core-link plants are retained for the shared projection step; they do not assert links
that the existing map cannot represent. Source relocation and filtered-snapshot tests cover I/O boundaries.
