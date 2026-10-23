# The estate model: part types, aspects, links and outcomes

Status: the model's types and the loader of a types document are built (`packages/core/src/estate-model/`), and a check outcome carries its coverage and its requirements (`packages/core/src/outcome/check-outcome.ts`). The scan does not read through the model yet: the runtime profile that ships built-in types, the proof that it gives the same map as today's reader, and the count of files no type covers come next, in that order.

## What it is

An estate is everything an agent setup holds: the instructions the model reads, the actions it can call, the checks that watch it, the settings that change how its runtime behaves. driftbench reads an estate before it tests it.

The model says what an estate is made of in two layers.

* **Part types** are open data. A type says where its parts are and how to read them. A runtime profile ships the types its runtime knows, and you add your own.
* **Aspects** are a fixed, small vocabulary. A type says which aspects its parts have. Checks read only aspects and links, never a type name or a path.

So a new kind of file in your setup needs one new type, written as data. Every check that already exists then checks it, because the type names its aspects.

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
| `extends` | A parent type. The child inherits every key and overrides the keys it names; `fields` merge by field name. | `script` |
| `references` | How a part points at other parts: `path`, `import(<prefix>)`, `name`. | `[import(@), path]` |
| `scope` | The parts of another type each part applies to, by the same `name` or the same `folder`, and the link kind (`configures` when not given). | `{ type: script, by: name }` |
| `shape` | A structure the file must have, by a name the reader knows (a step list, a catalogue). | `step-list` |

### Globs

A glob is matched against a whole path, folder by folder.

* `*` matches any characters inside one name, `?` one character, `[abc]` and `[!abc]` one character of a class, and `{a,b}` one of the alternatives.
* `**` alone between two `/` matches any number of folders, none included. `**/x.md` matches `x.md` and `a/b/x.md`.
* A star matches a name that starts with a dot too, and case is matched as written.
* The last `*` outside braces captures the text it matched. That text is the part's `match`, and its default name: `skills/*/` names each skill by its folder.

A glob may not start with `/`, hold `..`, or hold an empty folder name.

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

* `read` counts the inputs the check read. A check that read nothing is `not-run`, never a pass.
* `skipped` lists what it left out, each with the code of why.
* `unknown` lists the files under the estate root no type covers: the check could not look at them.
* `requires` is what the check declared it needs: `model-map`, `settings`, `guards`, `execution`. `missing` is what the run lacked; a check missing a requirement does not run.

A run with any unknown file is never reported as clean, whatever its checks found.

## Reading references

A part points at other parts in ways its type declares: the `references` key lists the rules (`path`, `import(<prefix>)`, `name`). Each rule is read by an **extractor**, a reader of one rule that looks at the text of a file by syntax alone and gives the *mentions* it finds. The **reference graph** resolves each mention against the estate, and keeps it as a typed link or as a dangling reference. A model adds meaning to this graph (which mention is an order to read the file); it never reads a path.

| Piece | What it does |
|---|---|
| Extractor | Registered under one rule with `registerReferenceExtractor({ id, rule, extract })`. `extract` gets the lines of one file (fenced blocks blanked) and the rules of the file's type, and returns mentions: the path as written, the line, the notation that wrote it, a confidence, whether it is an import. A registration with the same id replaces the earlier one. |
| File rules | `typeOfFile(profile, path)` finds the type that locates a file (a file inside a folder part takes its contained type). The rules that apply to a file are its type's, or `path` for a file no type locates. Only the extractors of those rules run on the file. |
| Graph | `referenceGraph(raw)` returns the entries, the links and the dangling references. An entry is `resolved` (a link with the reader that found it, the file and line, and a confidence from 0 to 1), `missing`, `external` (written outside the estate) or `ambiguous` (several files could be meant). |

The shipped extractors:

* `path-syntax` reads rule `path`. A path written as a code span, a link destination, a quoted name, a wiki or angle name, or a loose word that is a path by its syntax (a folder separator, or an extension of letters) is a `references` link, in a sentence or in a table cell. A fenced block is an example, and it closes as CommonMark says: only on a fence of the same character that is at least as long as the one that opened it, with nothing after it, so a shorter fence inside a longer block is text of the block. A URL, a glob, a placeholder and a command name no file. A path with no file type is a path by its syntax when it is a link destination, or a delimited name (a code span, a quoted name) that holds a folder separator; a lone word, a phrase, a folder (a closing slash), a section (`#top`) and a mail address are not. An existing file answers it. One that does not exist is a missing reference when it is a link destination, is written as `./x` or `../x`, or begins with a folder the estate holds; a pair such as `yes/no` or `owner/repo` begins with none, so it is kept apart (`unresolved`) and the references check lists it as skipped with the reason `path-not-in-estate`, as it lists a missing path with an unusual file type. A link to a folder asks the reader to read no file. A path is looked for from the folder of the file that writes it, then from the root of the estate, then in the profile's base folders, the aliases and the one file that ends with it.

A file that writes a path it cannot resolve is reported only when the path is sure to be a path: a name with a prose or script file type, or a path outside the estate. A lone word, or a name several files could be, says nothing sure and is left out.

## Writing your own types

A types document says which version of the schema it is written in, then its types. This one adds two kinds of files to an estate whose profile ships a `script` type.

```yaml types
version: 1
types:
  judge-request:
    extends: script
    locate: checks/judges/*.request.json
    fields: { id: $.id, prompt: $.system, schema: $.output }
    aspects: [guards, informs]
    loaded: on-event
  observe-flag:
    locate: checks/.*-observe
    aspects: [configures]
    scope: { type: script, by: name }
    loaded: always
```

* `judge-request` inherits everything from `script` and overrides where its parts are, three fields, its aspects and its load time. Each `checks/judges/<id>.request.json` is now a part that guards and informs.
* `observe-flag` locates files such as `checks/.lint-observe`. The last `*` captures `lint`, the flag's name, and `scope` links the flag to the `script` part of the same name with a `configures` link.

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
