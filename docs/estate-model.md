# The estate model: part types, aspects, links and outcomes

Status: built. The model's types and the loader of a types document (`packages/core/src/estate-model/`); the Claude Code profile's built-in types, as data, which the estate reader classifies every file by, with a test that every fixture estate gives the same map as before the types; the count of files no type covers, in the map and in `estate lint`; a check outcome with its coverage and its requirements (`packages/core/src/outcome/check-outcome.ts`). Not built yet: the list of parts with their fields read, the links read from the declared `references` and `scope`, a check that reads aspects and links in place of the map's file kinds, and a types package shared between estates. Today a type decides the kind of the files the map holds (the profile's types) and which files are covered (every type).

## What it is

An estate is everything an agent setup holds: the instructions the model reads, the actions it can call, the checks that watch it, the settings that change how its runtime behaves. driftbench reads an estate before it tests it.

The model says what an estate is made of in two layers.

* **Part types** are open data. A type says where its parts are and how to read them. A runtime profile ships the types its runtime knows, and you add your own.
* **Aspects** are a fixed, small vocabulary. A type says which aspects its parts have. The rule for checks: they read aspects and links, never a type name or a path.

So a new kind of file in your setup needs one new type, written as data. Today the type makes its files covered: they are no longer unknown, and the lint can be clean again. Once the checks read aspects (not built yet, see the status above), every existing check also checks the new parts, because the type names their aspects.

## Words used on this page

* **Estate root**: the folder you scan. Every path is relative to it and written with `/`.
* **Part**: one thing a type located: a file, a folder (with an entry file such as a skill's), or an entry inside a structured file.
* **Profile**: what a runtime loads and how, with its built-in types. See [estate runtime profiles](estate-runtime-profiles.md).
* **Types document**: a YAML or JSON file that declares types.

## A part type, key by key

| Key | What it says | Example |
|---|---|---|
| `locate` | Where its parts are: one glob or a list. A glob ending in `/` locates folders. `glob#$.json.path` locates the entries the path selects inside each matched file. | `agents/**/*.md` |
| `root` | The root its globs are relative to, by a name the profile gives. Without one, a type is relative to the folder of the file that declares it. | `layout` |
| `entry` | For a folder part, the file its fields are read from. | `SKILL.md` |
| `fields` | How each field is read. A list is tried in order; the first read that gives a value wins. | `name: [frontmatter.name, match]` |
| `contains` | Child types, located inside each part of this type. | `[skill-reference]` |
| `aspects` | What its parts do, from the vocabulary below. Required. | `[instructs]` |
| `loaded` | When the runtime loads a part. Required. | `on-mention` |
| `runtime` | The runtime that owns its parts. A part may belong to another runtime than the one you scan for. | `codex` |
| `extends` | A parent type. The child inherits every key and overrides the keys it names; `fields` merge by field name. | `guard` |
| `references` | How a part points at other parts: `path`, `import(<prefix>)`, `name`. | `[import(@), path]` |
| `scope` | The parts of another type each part applies to, by the same `name` or the same `folder`, and the link kind (`configures` when not given). | `{ type: guard, by: name }` |
| `shape` | A structure the file must have, by a name the reader knows (a step list, a catalogue). | `step-list` |

### Globs

A glob is matched against a whole path, folder by folder.

* `*` matches any characters inside one name, `?` one character, `[abc]` and `[!abc]` one character of a class, and `{a,b}` one of the alternatives.
* `**` alone between two `/` matches any number of folders, none included. `**/x.md` matches `x.md` and `a/b/x.md`.
* A star matches a name that starts with a dot too, and case is matched as written.
* The last `*` outside braces captures the text it matched. That text is the part's `match`, and its default name: `skills/*/` names each skill by its folder.

A glob may not start with `/`, hold `..`, or hold an empty folder name. It holds at most 8 stars and 256 characters (`GLOB_LIMITS`): a pattern with more stars can make matching backtrack heavily on a long name, so the loader refuses it (`locator`, reason `too-many-stars` or `too-long`).

### Field reads

| Read | What it gives |
|---|---|
| `$.a.b`, `$.a[0]`, `$.a[*]`, `$["a b"]` | A value of a structured file (JSON or YAML), or of the entry a locator selected |
| `frontmatter.a` | A key of a markdown file's frontmatter |
| `section(Heading)` | The text under a markdown heading, to the next heading of the same or a higher level |
| `body` | The text after the frontmatter |
| `text` | The whole text |
| `file-name` | The file name without its last extension |
| `folder-name` | The name of the part's folder |
| `match` | What the last `*` of the locating glob matched |

### Load times

`always` (before every turn), `on-demand` (when the model asks for it), `on-event` or `on-event(<event>)` (when an event fires), `on-mention` (when a person or a route names it), `by-reference` (only when another part points at it).

## Aspects

| Aspect | A part with it |
|---|---|
| `instructs` | is text the model reads |
| `acts` | is an action the model can call |
| `guards` | can block or alter an action when an event fires |
| `delegates` | starts another reasoning context |
| `informs` | holds facts the model retrieves |
| `configures` | changes how the runtime behaves |
| `invokes` | is a shortcut a person types |
| `executes` | is code another part runs |
| `indexes` | lists other parts |
| `person-facing` | is seen by people, never by the model |

## Links

A link joins two parts and has a kind: `includes`, `references`, `routes-to`, `guards`, `loads`, `delegates-to`, `indexes`, `configures`. Each link carries its provenance (the reader that found it, the file and the line it read it from) and a confidence between 0 and 1: 1 for a link read from structure, lower for one a reader inferred.

## Outcomes

Every check returns `pass`, `fail` or `not-run`, with its coverage and what it requires.

```ts
type CheckOutcome<F> = {
  check: string;
  status: 'pass' | 'fail' | 'not-run';
  coverage: {
    read: number;
    skipped: Array<{ what: string; reason: string }>;
    unknown: string[];
    missing: CheckCapability[];
  };
  requires: CheckCapability[];
  findings: F[];
  notRun?: 'missing-capability' | 'no-input';
};
```

* `read` counts the inputs the check read. A check that read nothing is `not-run`, never a pass. The reference checks read the prose parts: prose that names no path was read, and the check passes.
* `skipped` lists what the read left out on purpose, each by its path with the code of why; a skipped file changes no `read` count.
* `unknown` lists the files under the roots the profile counts that no type covers: the check could not look at them.
* `requires` is what the check declared it needs: `model-map`, `settings`, `guards`, `execution`. `missing` is what the run lacked; a check missing a requirement does not run.

A run with any unknown file is never reported as clean, whatever its checks found.

## Coverage and unknown files

A scan says what it covered. A profile names the roots whose every file counts (`coverageRoots`; for Claude Code, the `.claude` folder). Each file under one of them is:

* **covered** when a part type locates it, or when a reference or an import of the estate reaches it and the reader reads it as prose (a data file the prose names stays unknown);
* **skipped**, by its path, with the code of why: `estate-config` for `driftbench.estate.yaml`, `too-large` for a file over 1 MB, `ignored` for a file an ignore glob left out;
* **unknown** otherwise: no type says what it is, so no check can have looked at it.

A file beside those roots counts only when a type locates it or a reference reaches it: the source code of a project is no file of the agent.

The map records it under `coverage`:

```yaml types-coverage
coverage:
  covered: 4
  unknown:
    - .claude/checks/.lint-observe
    - .claude/checks/judges/tone.request.json
  skipped:
    - { what: .claude/driftbench.estate.yaml, reason: estate-config }
    - { what: .claude/node_modules/pkg/index.js, reason: ignored }
```

`estate lint` reads the estate again and prints, after its findings:

* `not-run` and the codes of the checks that had no input to read (a check that read nothing is never a pass);
* `unknown` and the number of files no type covers, with the first five;
* on its last line, the findings, or `Not run: no check had an input.`, or `Not clean: N files no part type covers, which no check read.`, or `Clean.` only when every file is covered and some check ran. The lint's `summary` field gives the same verdict as a code: `findings`, `none-ran`, `unknown-files` or `clean`.

Unknown files are coverage, not findings: the exit code is that of the findings. A type you declare makes its files covered; it changes no kind the map gives a file.

## Writing your own types

A types document says which version of the schema it is written in, then its types. In an estate, the `types:` key of `driftbench.estate.yaml` holds the types themselves, read as version 1, with globs relative to the folder of that file ([what you can change in an estate](estate-settings.md)). This document adds two kinds of files to an estate whose profile ships a `guard` type, the checks that can block an act.

```yaml types
version: 1
types:
  judge-request:
    extends: guard
    locate: checks/judges/*.request.json
    fields: { id: $.id, prompt: $.system, schema: $.output }
    aspects: [guards, informs]
    loaded: on-event
  observe-flag:
    locate: checks/.*-observe
    aspects: [configures]
    scope: { type: guard, by: name }
    loaded: always
```

* `judge-request` inherits everything from `guard` and overrides where its parts are, three fields, its aspects and its load time. Each `checks/judges/<id>.request.json` is now a part that guards and informs: a judge request can block an act.
* `observe-flag` locates files such as `checks/.lint-observe`. The last `*` captures `lint`, the flag's name, and `scope` says the flag configures the `guard` part of the same name (a link the map will hold once links are read).

### What the loader refuses

The loader is strict: a document with any fault is refused whole, and each fault has a code and the path of the key that holds it.

| Code | When |
|---|---|
| `not-parsed` | The text is not YAML or JSON, or names a type twice |
| `shape` | A key that does not exist, or a value of the wrong kind |
| `version` | A schema version this code does not read |
| `type-name` | A type name that is not lowercase letters, digits and dashes |
| `redefined` | A type the profile already defines |
| `unknown-type` | `extends`, `contains` or `scope.type` names a type nobody defines |
| `extends-cycle`, `contains-cycle` | A type that extends or contains itself through others |
| `unknown-root` | A root the profile does not name |
| `missing-locate`, `missing-aspects`, `missing-loaded` | A required key absent after inheritance |
| `unknown-aspect`, `duplicate-aspect` | An aspect outside the vocabulary, or one listed twice |
| `loaded`, `reference`, `field-read`, `locator` | A value outside its grammar; `reason` holds the sub-code (for a locator, why its glob was refused) |
| `entry-without-folder`, `entry-name` | An entry on a type that locates no folder, or an entry that is not a plain file name |
| `unknown-shape` | A shape the reader cannot test a file for |
| `runtime-name`, `link-kind` | A runtime name or a scope link kind outside its grammar |

In code: `parseTypesText(text, { runtime, roots, base, folder, source })` returns `{ ok: true, set }` with every type resolved, or `{ ok: false, errors }`.
