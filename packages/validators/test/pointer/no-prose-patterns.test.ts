import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The rule of the pointer bank (codex review of PR 1099): the seeded Prose generator returns what it wrote
 * and where (kit/words.ts registers the words of every text it returns), and nothing in the bank reads or
 * edits prose by matching its letters with a pattern. This guard reads the syntax tree of every source file
 * under the bank, kit, blind and sut folders and fails on:
 * - a regular expression that matches letters or words: `\w`, `\W`, `\b`, `\B`, `\S`, `\p{..}`, `\P{..}`, a
 *   character class that names a letter (`[a-z]`, `[aeo]`, `[^A-Za-z0-9]`), or a literal letter
 *   (`never|must`), as a literal or built with RegExp; a RegExp whose source is not known where it is built;
 *   RegExp taken as a value (an alias);
 * - a word split: `split` on a string holding a space or a letter, on a regular expression that matches a
 *   space or a letter, or on a separator that is not known at the call (a variable, a parameter: a helper
 *   that wraps split); `split` taken as a value (`const sp = text.split`, `String.prototype.split.call`);
 * - any `search`, `match` or `matchAll` call;
 * - a literal word read in a text: `replace`, `replaceAll`, `includes`, `indexOf`, `lastIndexOf`,
 *   `startsWith` or `endsWith` with a literal holding a letter, `replace` or `replaceAll` with a pattern not
 *   known at the call, and a literal word list (an array of strings holding letters) searched or iterated
 *   over a text test;
 * - a Set built from literal words (or given them with `add`) searched with `has`; a word built from pieces
 *   (`'ne' + 'ver'`, a template of pieces, `join`, `concat`) searched or edited as a literal word is read as
 *   that word; a word array searched with `includes`, `indexOf`, or iterated with `some` or `every` over a
 *   text test or a comparison of its element;
 * - each of these methods reached by bracket access (`text['match'](..)`) as by a dot;
 * - the WORD LIST ITSELF, however it is used afterwards (searched, iterated, filled into a Set, given to a
 *   function): an array literal, a Set literal or `new Set([...])`, with two or more plain words, and a
 *   `new Map([[key, value], ...])` with two or more plain-word keys. A plain word is a string of two or more
 *   ASCII letters and nothing else (`never`, `moved`, `sectionPath`), written as a literal or as pieces
 *   (`'ne' + 'ver'`). A string with a digit, a colon, a slash, a dot, an underscore, a hyphen or a space
 *   (`a/one.md`, `part.user`, `none-of-these`, a sentence), a single letter, and any expression that is not
 *   a string (an identifier, a call) is not one. A list of fewer than two plain words is not a finding of
 *   this rule (the rules above still read how it is used). A list built from a Set given one word at a time
 *   with `add` (also through an alias of the Set) and searched with `has` is read by the Set rule above.
 * Out of this guard's scope: a whole-text equality or a `switch` on single words, an object-key lookup, a
 * string built by `String.fromCharCode`, and a word list built without any literal.
 * The guard is a LINT, not a proof: it catches the ordinary forms of a pattern or a word list read in prose.
 * Deliberate obfuscation is OUT of its scope: a hex-escaped or computed regular expression, a borrowed
 * String.prototype method reached through a name the guard cannot resolve, a string built by `fromCharCode` or
 * a decoder. Review of the item code, not this guard, covers those.
 * A site that reads text the generator did not write (the reader's own output, request bodies, source code,
 * ids, the vocabulary constants) is allowed only by a named entry below: the file, the enclosing function and
 * the exact expression, with its reason. An entry matches its sites exactly (`count`, one by default), so a
 * new site, even an identical one in the same function, fails, and an entry that no longer matches fails too.
 */

const ROOT = fileURLToPath(new URL('../../src/ladders/pointer/', import.meta.url));
const FOLDERS = ['bank', 'kit', 'blind', 'sut'];

export type Finding = { file: string; anchor: string; line: number; text: string; why: string };
/** One allowed site: the file, its enclosing function (`anchor`), the exact expression text, and why. */
type Allowance = { file: string; anchor: string; expr: string; reason: string; count?: number };

/** The reasons of the word-list allowances: each names what the list is, never prose read or edited. */
const REASON = {
  NEEDS: 'names the reader parts an item needs (a spec row field), not prose',
  VOCAB:
    'vocabulary the item writes into a sentence or fixture it builds, drawn by the item and never matched against a text',
  LABELTEST: 'tests a label, option or field name against a fixed list of names, not prose',
  LABELSET: 'label names of a fixed set the item declares and sends to the reader, not prose',
  EVENTS: "lineage event names the item expects in the READER's ledger, not prose",
  EDITS: 'edit kinds of a script the item builds (reword, move, delete and so on), not prose',
  CONTAINERS: 'container or block kind names of the estate model, not prose',
  FIELDS:
    'field names of the entries, links, requests or cassette lines of the READER that the item reads or alters, not prose',
  REQBODY:
    'example names in a request body the READER sent to the labeller, whose lines the item wrote itself; it reads no generated prose',
  VOTES: 'label votes handed to the stack function under test as its input, not prose',
  TABLE: 'link states and change names a blind case table declares, not prose',
  STDIO: 'stdio mode names of a child process spawn, not prose',
  ARMS: 'names of the labeler arms the item runs the reader with, not prose',
  FIXTURE:
    'names the item writes into a fixture (headers, tags, styles, grid words), never matched against a text',
  PROTO:
    "property-like names the item uses as set or threshold names and looks up in the READER's output, not prose",
  LINKS:
    "link state, relation or change names the item gives to or expects of the READER's link calls, not prose",
  MISC: "fixed names of the bank's own cases, parts, families or runtime versions, not prose",
} as const;

const ALLOWED: Allowance[] = [
  {
    file: 'bank/controls.ts',
    anchor: 'verdict',
    expr: 'unit.text.includes(ITEM)',
    reason: "reads the READER's cut of the fixed control file for its fixed list item, not generated prose",
  },
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'want',
    expr: "['rule', 'prohibition'].includes(p.label)",
    reason: 'tests a label, option or field name against a fixed list of names, not prose',
  },
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'yaml-custom-tags',
    expr: '/CANARY/',
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'extra',
    expr: "got.units[0]?.text.endsWith('menu.')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'extra',
    expr: "got.units[1]?.text.includes('*skip*')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'extra',
    expr: "got.units[0]?.text.includes('&amp;')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'extra',
    expr: "got.units[0]?.text.includes('&gt;')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'extra',
    expr: '/<\\/?rules>/',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'extra',
    expr: '/<\\/?role>/',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'containing',
    expr: 'doc.text.slice(u.start, u.end).includes(inner)',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'html-nested-depth',
    expr: 'u.text.includes(inner)',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'extra',
    expr: "u.text.includes('é')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/grouping.ts',
    anchor: 'atom-evidence-prose-pointer',
    expr: "JSON.stringify(res.atoms).includes('FAKE EVIDENCE')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/grouping.ts',
    anchor: 'atom-no-labeler-text',
    expr: "JSON.stringify(res.atoms).includes('FAKE QUOTE')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/grouping.ts',
    anchor: 'want',
    expr: "['rule', 'prohibition'].includes(truthLabel(x))",
    reason: 'tests a label, option or field name against a fixed list of names, not prose',
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'shift',
    expr: 'PROBE_NAMES.indexOf(a.get(t) as string)',
    reason: 'tests a label, option or field name against a fixed list of names, not prose',
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'spaces',
    expr: 'text.matchAll(/ /g)',
    reason:
      'the offsets of the spaces of a sentence the item wrote itself from a fixed template and drawn nouns: a space is not a letter and no word is read',
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'system1-refuses-link-labels',
    expr: 'call.labels.includes(withLinks)',
    reason: 'tests the labels the READER offered in its calls for the label the item declared, not prose',
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'm',
    expr: '/^u(\\d+)__(.+)$/',
    reason:
      "reads a key or field name of the READER's JSON (question keys u<n>__label, cassette fields), not prose",
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'after',
    expr: 'PROBE_NAMES.indexOf(before.get(keyOf(t)) as string)',
    reason: 'tests a label, option or field name against a fixed list of names, not prose',
  },
  {
    file: 'bank/families/hardening-bugs-d.ts',
    anchor: 'other',
    expr: 'OPTIONS.filter((name) => !not.includes(name))',
    reason: 'tests a label, option or field name against a fixed list of names, not prose',
  },
  {
    file: 'bank/families/hardening-bugs-d.ts',
    anchor: 'at',
    expr: "line.startsWith(' description: ')",
    reason: 'finds the description lines of a YAML fixture the item wrote itself, not prose',
  },
  {
    file: 'bank/families/hardening-bugs-d.ts',
    anchor: 'miss-nearest-same-labeler',
    expr: "fieldsNamed(edited.res).includes('setHash')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/hardening-bugs-d.ts',
    anchor: 'miss-nearest-same-labeler',
    expr: "named.includes('labeler')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/hardening-bugs-d.ts',
    anchor: 'miss-names-least-different-entry',
    expr: "named.includes('setHash')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/hardening-bugs-d.ts',
    anchor: 'miss-names-least-different-entry',
    expr: "named.includes('run')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'extra',
    expr: 'got.units[0]?.text.includes(url)',
    reason: "tests the READER's first unit for the whole address the item wrote, not a generated word",
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'settings-inherited-threshold-key-refused',
    expr: "['constructor', 'toString', 'hasOwnProperty', 'valueOf']",
    reason:
      'names every object has by inheritance, sent to the reader as threshold keys; the item reads the issue the reader gives for each, not prose',
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'm',
    expr: '/^u(\\d+)__(.+)$/',
    reason:
      "reads a key or field name of the READER's JSON (question keys u<n>__label, cassette fields), not prose",
    count: 2,
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'walk',
    expr: '/^u\\d+__/',
    reason:
      "reads a key or field name of the READER's JSON (question keys u<n>__label, cassette fields), not prose",
  },
  {
    file: 'bank/families/ids.ts',
    anchor: 'bad',
    expr: '/^[0-9a-z]{10}$/',
    reason: 'checks the shape of an id the READER minted, not prose',
  },
  {
    file: 'bank/families/ids.ts',
    anchor: 'ledger-no-timestamps',
    expr: '/\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/',
    reason: 'looks for an ISO or epoch time in the ledger the READER wrote, not prose',
  },
  {
    file: 'bank/families/ids.ts',
    anchor: 'ledger-no-timestamps',
    expr: '/\\b1[5-9]\\d{11}\\b/',
    reason: 'looks for an ISO or epoch time in the ledger the READER wrote, not prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'choiceCallsProblem',
    expr: '/^u\\d+$/',
    reason:
      "reads a key or field name of the READER's JSON (question keys u<n>__label, cassette fields), not prose",
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'want',
    expr: "['rule', 'prohibition'].includes(truthLabel(t))",
    reason: 'tests a label, option or field name against a fixed list of names, not prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'want',
    expr: "u.path.includes('Rules')",
    reason: 'edits or tests a path the item wrote itself, not prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'bad',
    expr: '/fail/',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'missing',
    expr: 'need.filter((x) => !text.includes(x))',
    reason:
      'reads a request body the READER sent to the labeller (set, label and example lines, question keys), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'prompt-generic-template',
    expr: 'signature.split(field)',
    reason:
      'masks the set fields in the request body the READER sent (a field value is cut out by its exact text), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'shown',
    expr: "['one', 'two', 'three', 'four', 'five'].filter((n) => text.includes(`Example ${n} is here.`), )",
    reason:
      'reads a request body the READER sent to the labeller (set, label and example lines, question keys), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'shown',
    expr: 'text.includes(`Example ${n} is here.`)',
    reason:
      'reads a request body the READER sent to the labeller (set, label and example lines, question keys), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'sets',
    expr: '/^SET /',
    reason:
      'reads a request body the READER sent to the labeller (set, label and example lines, question keys), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'windows',
    expr: '/^WINDOW /',
    reason:
      'reads a request body the READER sent to the labeller (set, label and example lines, question keys), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'prompt-header-and-enum',
    expr: 'lines.includes(`SET ${name}`)',
    reason:
      'reads a request body the READER sent to the labeller (set, label and example lines, question keys), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'prompt-header-and-enum',
    expr: 'lines.includes(`LABELS ${labels}`)',
    reason:
      'reads a request body the READER sent to the labeller (set, label and example lines, question keys), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'prompt-header-and-enum',
    expr: "l.startsWith('LABELS')",
    reason:
      'reads a request body the READER sent to the labeller (set, label and example lines, question keys), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'header',
    expr: '/^WINDOW \\S+#\\d+/',
    reason:
      'reads a request body the READER sent to the labeller (set, label and example lines, question keys), not generated prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'text2',
    expr: 'text1.replace(target, rewordWords(rng, target, 1))',
    reason:
      'swaps one whole sentence the generator wrote for its reworded copy (rewordWords works from the generator record); the sentence is found by its exact text, no word is picked by a pattern',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'changed',
    expr: "RULES_YAML.replace( 'A unit that tells the reader what to do.', 'A unit that tells the reader what to do now.', )",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'changed',
    expr: "TWO_SETS_YAML.replace( 'A unit that fixes a tone or a word choice for customer emails.', 'A unit that fixes the tone of a customer email.', )",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'variants',
    expr: "base.replace('name: rule', 'name: rule2')",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'variants',
    expr: "base.replace('what to do.', 'what to do now.')",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'variants',
    expr: "base.replace(' atom:', ' examples:\\n - \"Do this.\"\\n atom:')",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'variants',
    expr: "base.replace(' atom:', ' target: required\\n atom:')",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'variants',
    expr: "base.replace('obligation', 'prohibition')",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'default-set-is-data',
    expr: "['weigh', 'proof', 'none-of-these'].includes(n as string)",
    reason: 'tests a label, option or field name against a fixed list of names, not prose',
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 're',
    expr: '/^u\\d+$/',
    reason:
      "reads a key or field name of the READER's JSON (question keys u<n>__label, cassette fields), not prose",
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'walk',
    expr: '/^u\\d+__/',
    reason:
      "reads a key or field name of the READER's JSON (question keys u<n>__label, cassette fields), not prose",
  },
  {
    file: 'bank/families/links.ts',
    anchor: 'missing',
    expr: 'need.filter((k) => !keys.includes(k))',
    reason:
      "reads a key or field name of the READER's JSON (question keys u<n>__label, cassette fields), not prose",
  },
  {
    file: 'bank/families/links.ts',
    anchor: 'bad',
    expr: '/^(start|end|hint|line|offset|index|position)/i',
    reason:
      "reads a key or field name of the READER's JSON (question keys u<n>__label, cassette fields), not prose",
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'outside',
    expr: "p.startsWith('home/')",
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
    count: 3,
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'outside',
    expr: "p.startsWith('cwd/')",
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
    count: 3,
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'tops',
    expr: "p.startsWith('tmp/')",
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'stray',
    expr: "p.startsWith('tmp/')",
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'env-secret-not-printed',
    expr: 'text.includes(value)',
    reason: "searches the READER's output for the planted environment secret, not prose",
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'fingerprints-are-hashes',
    expr: '/^[0-9a-f]+$/',
    reason:
      "skips the 8-character slices of a planted text that a hex fingerprint could also hold: it tests the hex alphabet of the READER's fingerprints, picks no word and changes nothing",
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'request-scoped-to-window',
    expr: '/private\\/a\\.md#/',
    reason: 'searches the ledger the READER wrote for the private path and the planted secret, not prose',
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'abs-path-not-recorded',
    expr: "text.includes('PLANTED-USER-7q')",
    reason: "searches the READER's output for the planted user marker, not prose",
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'left',
    expr: "p.startsWith('tmp/')",
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
    count: 2,
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'left',
    expr: '/cassette|ledger/',
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'kept',
    expr: 'line.includes(\'"private/notes.md"\')',
    reason: 'filters the ledger lines the READER wrote by the private path, not prose',
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'yaml',
    expr: "PROBE_YAML.replace( 'A unit that tells the reader what to do.', `A unit that tells the reader what to do, ${phrase}.`, )",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'label-set-text-only-in-requests',
    expr: "seen.bodies.join('\\n').includes(phrase)",
    reason: 'searches the request bodies the READER sent for the planted private phrase, not prose',
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'label-set-text-only-in-requests',
    expr: 'text.includes(phrase)',
    reason: "searches the READER's output for the planted private phrase, not prose",
  },
  {
    file: 'bank/families/radius.ts',
    anchor: 'block-without-links-never',
    expr: "o.startsWith('free-')",
    reason: 'tests the rerun names the READER returned for its `free-` prefix, not prose',
  },
  {
    file: 'bank/families/reanchoring.ts',
    anchor: 'directory-rename',
    expr: "p.replace('notes/', 'archive/')",
    reason: 'edits or tests a path the item wrote itself, not prose',
  },
  {
    file: 'bank/families/reanchoring.ts',
    anchor: 'reword-number',
    expr: "texts[3]?.replace('step 3', 'step 4')",
    reason:
      'replaces the `step 3` tail the item appended itself to the drawn sentences (generated words hold no digit), not a generated word',
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'keysOf',
    expr: '/[^a-z0-9.]/g',
    reason: 'normalises the keys of a JSON object (a request part name), not prose',
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'yaml',
    expr: "yaml.replace( 'A unit that tells the reader what to do.', 'A unit that tells the reader what to do now.', )",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'yaml',
    expr: "yaml.replaceAll('name: example', 'name: summary')",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'yaml',
    expr: "yaml.replace( ' description: A unit that tells the reader what never to do.\\n', ' description: A unit that tells the reader what never to do.\\n examples:\\n - \"Never do this.\"\\n', )",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'text',
    expr: "file.text.replace(was, `${was.replace(/\\.$/, '')} ${word(p.random)}.`)",
    reason:
      'edits a committed fixture unit (not generator output) by its exact text and adds a drawn word at its end',
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'yaml',
    expr: "yaml.replace('set: probe', 'set: renamed')",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'text',
    expr: "f.text.replace('receipt', 'voucher')",
    reason: 'edits a committed fixture file (not generator output) by one of its own fixed words',
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'key-is-sha256-hex',
    expr: '/^[0-9a-f]{64}$/',
    reason: 'checks that the cassette keys the READER wrote are 64 hex characters, not prose',
    count: 2,
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'labelsYaml',
    expr: "fixture.labelsYaml.replace('set: probe', 'set: \"probe\"')",
    reason:
      'edits a fixed YAML fixture the item wrote itself (label set, settings): the literal it replaces is its own text, no generated word',
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'leaked',
    expr: '/ZQ7-\\d+-NOTE/',
    reason: 'searches the cassette the READER wrote for the planted note marker, not prose',
  },
  {
    file: 'bank/reader-imports.ts',
    anchor: 'SOURCE',
    expr: '/\\.(?:[cm]?[jt]sx?)$/',
    reason: "reads the READER's source code for its imports, not prose",
  },
  {
    file: 'bank/reader-imports.ts',
    anchor: 'SPECIFIERS',
    expr: '/\\b(?:import|export)\\b[^\'"`;]*?\\bfrom\\s*([\'"`])([^\'"`\\n]+)\\1/g',
    reason: "reads the READER's source code for its imports, not prose",
  },
  {
    file: 'bank/reader-imports.ts',
    anchor: 'SPECIFIERS',
    expr: '/\\bimport\\s*([\'"`])([^\'"`\\n]+)\\1/g',
    reason: "reads the READER's source code for its imports, not prose",
  },
  {
    file: 'bank/reader-imports.ts',
    anchor: 'SPECIFIERS',
    expr: '/\\bimport\\s*\\(\\s*([\'"`])([^\'"`\\n]+)\\1/g',
    reason: "reads the READER's source code for its imports, not prose",
  },
  {
    file: 'bank/reader-imports.ts',
    anchor: 'SPECIFIERS',
    expr: '/\\brequire\\s*\\(\\s*([\'"`])([^\'"`\\n]+)\\1/g',
    reason: "reads the READER's source code for its imports, not prose",
  },
  {
    file: 'bank/reader-imports.ts',
    anchor: 'SPECIFIERS',
    expr: '/\\bnew\\s+URL\\s*\\(\\s*([\'"`])([^\'"`\\n]+)\\1/g',
    reason: "reads the READER's source code for its imports, not prose",
  },
  {
    file: 'bank/reader-imports.ts',
    anchor: 'INTO_VALIDATORS',
    expr: '/(?:^|[\\\\/])validators(?:[\\\\/]|$)|driftbench-validators/',
    reason: "reads the READER's source code for its imports, not prose",
  },
  {
    file: 'bank/reader-imports.ts',
    anchor: 'importsOfValidators',
    expr: 'text.matchAll(pattern)',
    reason: "reads the READER's source code for its imports, not prose",
  },
  {
    file: 'kit/child-run.ts',
    anchor: 'env',
    expr: "v.replaceAll('{home}', home).replaceAll('{tmp}', tmp)",
    reason: 'fills the {home} and {tmp} holes of a path template the kit wrote, not prose',
  },
  {
    file: 'kit/child-run.ts',
    anchor: 'env',
    expr: "v.replaceAll('{home}', home)",
    reason: 'fills the {home} and {tmp} holes of a path template the kit wrote, not prose',
  },
  {
    file: 'kit/child-run.ts',
    anchor: 'written',
    expr: "p.startsWith('home/.nexus-secrets')",
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
  },
  {
    file: 'kit/child-run.ts',
    anchor: 'written',
    expr: "p.startsWith('tmp/tsx-')",
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
  },
  {
    file: 'kit/child-run.ts',
    anchor: 'written',
    expr: "p.startsWith('home/canary.cjs')",
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
  },
  {
    file: 'kit/child.ts',
    anchor: '(module)',
    expr: '/kit[\\\\/]child\\.[mc]?[tj]s$/',
    reason: 'matches the path of the running script, not prose',
  },
  {
    file: 'kit/compose.ts',
    anchor: 'emitParagraph',
    expr: "sentence.split(' ')",
    reason:
      'the composer lays a text out at its spaces (wrapping, hard breaks, list items): it changes and picks no word, and the truth it returns holds the text unchanged',
  },
  {
    file: 'kit/compose.ts',
    anchor: 'firstLength',
    expr: "(block.sentences[0] ?? '').split(' ')",
    reason:
      'the composer lays a text out at its spaces (wrapping, hard breaks, list items): it changes and picks no word, and the truth it returns holds the text unchanged',
  },
  {
    file: 'kit/compose.ts',
    anchor: 'words',
    expr: "item.text.split(' ')",
    reason:
      'the composer lays a text out at its spaces (wrapping, hard breaks, list items): it changes and picks no word, and the truth it returns holds the text unchanged',
  },
  {
    file: 'kit/compose.ts',
    anchor: '[start, end]',
    expr: "text.split(' ')",
    reason:
      'the composer lays a text out at its spaces (wrapping, hard breaks, list items): it changes and picks no word, and the truth it returns holds the text unchanged',
  },
  {
    file: 'kit/labellers.ts',
    anchor: 'own',
    expr: 'TRUTH_LABELS.every((name) => names.includes(name))',
    reason: 'tests a label, option or field name against a fixed list of names, not prose',
  },
  {
    file: 'kit/norm.ts',
    anchor: 'quoted',
    expr: '/^(["\'])([\\s\\S]*)\\1$/',
    reason: '`[\\\\s\\\\S]` matches any character: it unquotes a quoted value and reads no letter',
  },
  {
    file: 'kit/scale.ts',
    anchor: 'makeEstate',
    expr: 'BOILER.includes(text)',
    reason: 'tests whole texts for membership of the fixed boilerplate sentences; no word is read',
  },
  {
    file: 'kit/transport.ts',
    anchor: 'm',
    expr: '/^\\[(\\d+)\\] (?:\\((context|read)\\) )?(.*)$/',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
  },
  {
    file: 'kit/transport.ts',
    anchor: 'n',
    expr: '/^u(\\d+)__/',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
  },
  {
    file: 'kit/transport.ts',
    anchor: 'labelsLine',
    expr: '/^LABELS (.*)$/m',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
  },
  {
    file: 'kit/transport.ts',
    anchor: 'predicates',
    expr: '/^u\\d+__(.+)$/',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
  },
  {
    file: 'kit/transport.ts',
    anchor: 'fromText',
    expr: 'text.matchAll(/^- ([a-z][a-z0-9_-]*):/gm)',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
  },
  {
    file: 'kit/transport.ts',
    anchor: 'fromText',
    expr: '/^- ([a-z][a-z0-9_-]*):/gm',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
  },
  {
    file: 'kit/transport.ts',
    anchor: 'set',
    expr: '/^SET ([^:\\n]+)(?::|$)/m',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
  },
  {
    file: 'kit/transport.ts',
    anchor: 'window',
    expr: '/^WINDOW (\\S+)/m',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
  },
  {
    file: 'kit/transport.ts',
    anchor: 'm',
    expr: '/^u(\\d+)__(.+)$/',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
    count: 2,
  },
  {
    file: 'kit/transport.ts',
    anchor: 'unitText',
    expr: '/^u(\\d+)$/',
    reason:
      'reads the request body the READER sent to the labeller (label names, the WINDOW line, question keys), not prose',
  },
  {
    file: 'kit/words.ts',
    anchor: 'split',
    expr: 'text.trim().split(/\\s+/)',
    reason: 'the generator splits its own vocabulary constants into words; no prose is read',
  },
  {
    file: 'kit/words.ts',
    anchor: 'sentence',
    expr: '/s$/',
    reason: 'drops the `s` of a vocabulary verb the generator drew, before the text exists; no prose is read',
  },
  {
    file: 'blind/bank/identity.ts',
    anchor: 'ledgerObservation',
    expr: '/^[a-z2-7]{10}$/',
    reason: 'checks the shape of an id the READER minted, not prose',
  },
  {
    file: 'blind/bank/identity.ts',
    anchor: 'editedText',
    expr: "trackedText.replace('painted', 'marked')",
    reason:
      "edits a fixed sentence the item wrote itself from a literal template (no Prose output): the literal it replaces is the item's own word",
  },
  {
    file: 'blind/bank/identity.ts',
    anchor: 'changed',
    expr: "text.replace(' X.', ' Y.')",
    reason:
      "edits a fixed sentence the item wrote itself from a literal template (no Prose output): the literal it replaces is the item's own word",
  },
  {
    file: 'blind/bank/identity.ts',
    anchor: 'edited',
    expr: "(original[3] as string).replace('silver', 'pewter')",
    reason:
      "edits a fixed sentence the item wrote itself from a literal template (no Prose output): the literal it replaces is the item's own word",
  },
  {
    file: 'blind/bank/identity.ts',
    anchor: 'edited',
    expr: "(original[4] as string).replace('amber', 'ochre')",
    reason:
      "edits a fixed sentence the item wrote itself from a literal template (no Prose output): the literal it replaces is the item's own word",
  },
  {
    file: 'blind/bank/identity.ts',
    anchor: 'anchorProbe',
    expr: "text.replace('sealed', 'closed')",
    reason:
      "edits a fixed sentence the item wrote itself from a literal template (no Prose output): the literal it replaces is the item's own word",
    count: 2,
  },
  {
    file: 'bank/families/hardening-privacy.ts',
    anchor: 'bodiesOf',
    expr: '/\\\\u([0-9a-f]{4})/gi',
    reason: 'decodes the \\\\u escapes of the request bodies the READER sent (JSON text), not prose',
  },
  {
    file: 'blind/bank/privacy.ts',
    anchor: 'decoded',
    expr: '/\\\\u([0-9a-f]{4})/gi',
    reason: 'decodes the \\\\u escapes of the serialized ledger the READER wrote, not prose',
  },
  {
    file: 'blind/bank/privacy.ts',
    anchor: 'path',
    expr: "write.path.startsWith('.cache/')",
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changed',
    expr: "['changed', 'changed-context', 'split', 'merged'].includes(change ?? '')",
    reason: 'tests a change kind name the item chose, not prose',
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'heading',
    expr: "change?.includes('heading')",
    reason: 'tests a change kind name the item chose, not prose',
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'ctxFp',
    expr: "change?.includes('context')",
    reason: 'tests a change kind name the item chose, not prose',
  },
  {
    file: 'blind/bank/replay.ts',
    anchor: 'generate',
    expr: "field.startsWith('set.')",
    reason: 'tests a field name the item chose, not prose',
  },
  {
    file: 'blind/bank.test.ts',
    anchor: '(module)',
    expr: '/^[a-z2-7]{10}$/',
    reason: "a test file: its assertions read the bank's plants and the READER's ids; it builds no item",
    count: 2,
  },
  {
    file: 'blind/bank.test.ts',
    anchor: 'first',
    expr: "text.split(' ')",
    reason: "a test file: its assertions read the bank's plants and the READER's ids; it builds no item",
  },
  {
    file: 'blind/bank.test.ts',
    anchor: 'shape',
    expr: '/\\bv[0-9a-z]+\\b/g',
    reason: "a test file: its assertions read the bank's plants and the READER's ids; it builds no item",
  },
  {
    file: 'blind/cheats.ts',
    anchor: 'firstWord',
    expr: 'text.trim().split(/\\s+/)',
    reason:
      'a cheating reader the blind bank must catch: reading the text it is given is what a reader does, and no item is built from it',
  },
  {
    file: 'blind/cheats.ts',
    anchor: 'wordAt',
    expr: 'text.trim().split(/\\s+/)',
    reason:
      'a cheating reader the blind bank must catch: reading the text it is given is what a reader does, and no item is built from it',
  },
  {
    file: 'blind/cheats.ts',
    anchor: 'vToken',
    expr: 'text .trim() .split(/\\s+/)',
    reason:
      'a cheating reader the blind bank must catch: reading the text it is given is what a reader does, and no item is built from it',
  },
  {
    file: 'blind/cheats.ts',
    anchor: 'vToken',
    expr: '/v[a-z0-9]{3,8}/',
    reason:
      'a cheating reader the blind bank must catch: reading the text it is given is what a reader does, and no item is built from it',
  },
  {
    file: 'blind/cheats.ts',
    anchor: 'digitWord',
    expr: 'text .trim() .split(/\\s+/)',
    reason:
      'a cheating reader the blind bank must catch: reading the text it is given is what a reader does, and no item is built from it',
  },
  {
    file: 'blind/cheats.ts',
    anchor: 'vSubstring',
    expr: '/v[a-z0-9]{3,8}/',
    reason:
      'a cheating reader the blind bank must catch: reading the text it is given is what a reader does, and no item is built from it',
  },
  {
    file: 'sut/blind-binding/labels.ts',
    anchor: 'probabilities',
    expr: '/^u(\\d+)__/',
    reason:
      "reads a key or field name of the READER's JSON (question keys u<n>__label, cassette fields), not prose",
  },
  {
    file: 'sut/blind-binding/labels.ts',
    anchor: 'named',
    expr: "from.startsWith('cassette:')",
    reason: 'reads the source id a ledger label carries (cassette:<key>), written by the reader, not prose',
  },
  {
    file: 'sut/blind-binding/replay.ts',
    anchor: 'fieldsOf',
    expr: "name.startsWith('part.')",
    reason: "reads the READER's own message (the field names and versions it names), not prose",
  },
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'label-named-like-prototype',
    expr: 'names.has(l)',
    reason:
      'tests a unit container, block kind, diagnostic code, label or id against a fixed set of names the item or the reader defines; no prose word is read',
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'refused',
    expr: 'REFUSED.has(d.code)',
    reason:
      'tests a unit container, block kind, diagnostic code, label or id against a fixed set of names the item or the reader defines; no prose word is read',
  },
  {
    file: 'bank/specs/provenance.ts',
    anchor: 'provenanceOf',
    expr: 'ADDED.has(id)',
    reason:
      'tests a unit container, block kind, diagnostic code, label or id against a fixed set of names the item or the reader defines; no prose word is read',
  },
  {
    file: 'bank/specs/reanchoring.ts',
    anchor: 'withTwin',
    expr: 'WITHOUT_TWIN.has(spec.key)',
    reason:
      'tests a unit container, block kind, diagnostic code, label or id against a fixed set of names the item or the reader defines; no prose word is read',
  },
  {
    file: 'kit/anchor-case.ts',
    anchor: 'dropOneBlock',
    expr: 'REMOVABLE.has(block.kind)',
    reason:
      'tests a unit container, block kind, diagnostic code, label or id against a fixed set of names the item or the reader defines; no prose word is read',
  },
  {
    file: 'kit/anchor-case.ts',
    anchor: 'dropOneBlock',
    expr: 'PROSE_UNITS.has(u.container)',
    reason:
      'tests a unit container, block kind, diagnostic code, label or id against a fixed set of names the item or the reader defines; no prose word is read',
  },
  {
    file: 'kit/estate.ts',
    anchor: 'checkPlanted',
    expr: 'PROSE_CONTAINERS.has(unit.container)',
    reason:
      'tests a unit container, block kind, diagnostic code, label or id against a fixed set of names the item or the reader defines; no prose word is read',
  },
  {
    file: 'kit/oracle.ts',
    anchor: 'compareCut',
    expr: 'EXACT_SPAN.has(want.container)',
    reason:
      'tests a unit container, block kind, diagnostic code, label or id against a fixed set of names the item or the reader defines; no prose word is read',
  },
  {
    file: 'blind/bank/structure.ts',
    anchor: 'cause',
    expr: 'carryNotCallable.has(`grouping/${name}/interaction-${variant + 1}`)',
    reason:
      'tests a unit container, block kind, diagnostic code, label or id against a fixed set of names the item or the reader defines; no prose word is read',
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'other',
    expr: 'PROBE.find((name) => twice.every((t) => own.get(t) !== name))',
    reason: 'picks a probe label name the item defines by comparing names; no prose word is read',
  },
  // Word lists: arrays, Sets and Maps of two or more plain words. None is read or edited as generated prose.
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'DEONTIC',
    expr: "['must', 'never', 'always', 'shall', 'should', 'required', 'forbidden']",
    reason: REASON.VOCAB,
  },
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'want',
    expr: "['rule', 'prohibition']",
    reason: REASON.LABELTEST,
  },
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'events',
    expr: "['moved', 'unchanged']",
    reason: REASON.EVENTS,
    count: 2,
  },
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'names',
    expr: "['constructor', 'tostring', 'hasownproperty']",
    reason: REASON.PROTO,
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'second',
    expr: "['iOS', 'eBay', 'macOS', 'iPhone']",
    reason: REASON.VOCAB,
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'sentences-decimal',
    expr: "['today', 'later', 'soon']",
    reason: REASON.VOCAB,
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'name',
    expr: "['Ito', 'Lowe', 'Aldous', 'Brandt', 'Okoye', 'Sandoval']",
    reason: REASON.VOCAB,
  },
  {
    file: 'bank/families/cutting.ts',
    anchor: 'sentences-hard-line-break',
    expr: "['spaces', 'backslash']",
    reason: REASON.FIXTURE,
  },
  {
    file: 'bank/families/grouping.ts',
    anchor: 'want',
    expr: "['rule', 'prohibition']",
    reason: REASON.LABELTEST,
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'PROBE',
    expr: "['rule', 'prohibition', 'example']",
    reason: REASON.LABELSET,
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'PLAIN',
    expr: "['rule', 'prohibition', 'example', 'description']",
    reason: REASON.LABELSET,
  },
  {
    file: 'bank/families/hardening-bugs-c.ts',
    anchor: 'kinds',
    expr: "['over', 'clear', 'low']",
    reason: REASON.MISC,
  },
  {
    file: 'bank/families/hardening-bugs-d.ts',
    anchor: 'OPTIONS',
    expr: "['rule', 'prohibition', 'example']",
    reason: REASON.LABELSET,
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'lineage-is-history',
    expr: "['new', 'changed']",
    reason: REASON.EVENTS,
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'lineage-is-history',
    expr: "['new', 'deleted']",
    reason: REASON.EVENTS,
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'lineage-is-history',
    expr: "['new', 'moved']",
    reason: REASON.EVENTS,
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'plan',
    expr: "['reword', 'move', 'rewrite', 'insert', 'delete']",
    reason: REASON.EDITS,
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'KINDS',
    expr: "['new', 'unchanged', 'moved', 'changed', 'split', 'merged', 'ambiguous', 'deleted']",
    reason: REASON.EVENTS,
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'PROBE_LABELS',
    expr: "['rule', 'prohibition', 'example']",
    reason: REASON.LABELSET,
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'FIVE_LABELS',
    expr: "['one', 'two', 'three', 'four', 'five']",
    reason: REASON.LABELSET,
  },
  {
    file: 'bank/families/ids.ts',
    anchor: 'header',
    expr: "['alpha', 'beta', 'gamma']",
    reason: REASON.FIXTURE,
  },
  {
    file: 'bank/families/ids.ts',
    anchor: 'need',
    expr: "[ 'id', 'path', 'sectionPath', 'container', 'fp', 'ctxFp', 'quote', 'prefix', 'suffix', 'hint', 'status', 'labels', 'lineage', 'twinOf', ]",
    reason: REASON.FIELDS,
  },
  {
    file: 'bank/families/ids.ts',
    anchor: 'yaml',
    expr: "['__proto__', 'constructor', 'hasOwnProperty']",
    reason: REASON.PROTO,
  },
  {
    file: 'bank/families/ids.ts',
    anchor: 'ledger-safe-set-names',
    expr: "['__proto__', 'constructor', 'hasOwnProperty']",
    reason: REASON.PROTO,
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'NAMES',
    expr: "['rule', 'prohibition', 'example']",
    reason: REASON.LABELSET,
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'FIVE_OPTIONS',
    expr: "['five', 'four', 'none', 'one', 'three', 'two']",
    reason: REASON.LABELSET,
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'want',
    expr: "['rule', 'prohibition']",
    reason: REASON.LABELTEST,
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'header',
    expr: "['one', 'two']",
    reason: REASON.FIXTURE,
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'shown',
    expr: "['one', 'two', 'three', 'four', 'five']",
    reason: REASON.REQBODY,
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'segs',
    expr: "['reword', 'rewrite', 'delete', 'insert', 'split', 'merge', 'reword', 'move']",
    reason: REASON.EDITS,
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'default-set-is-data',
    expr: "['weigh', 'proof', 'none-of-these']",
    reason: REASON.LABELTEST,
  },
  {
    file: 'bank/families/labels.ts',
    anchor: 'haiku-refuse-wrong-window-or-set',
    expr: "['window', 'set']",
    reason: REASON.FIELDS,
  },
  {
    file: 'bank/families/links.ts',
    anchor: 'allowed',
    expr: "['ok', 'advisory']",
    reason: REASON.LINKS,
  },
  {
    file: 'bank/families/links.ts',
    anchor: 'states',
    expr: "['ok', 'advisory']",
    reason: REASON.LINKS,
    count: 2,
  },
  {
    file: 'bank/families/links.ts',
    anchor: 'heads',
    expr: "['One', 'Two']",
    reason: REASON.FIXTURE,
  },
  {
    file: 'bank/families/links.ts',
    anchor: 'cov',
    expr: "['rule', 'prohibition']",
    reason: REASON.LABELSET,
    count: 3,
  },
  {
    file: 'bank/families/links.ts',
    anchor: 'need',
    expr: "['span', 'fp', 'relation', 'createdBy', 'accepted']",
    reason: REASON.FIELDS,
  },
  {
    file: 'bank/families/links.ts',
    anchor: 'rels',
    expr: "['verifies', 'negates', 'example-of', 'x/y']",
    reason: REASON.LINKS,
  },
  {
    file: 'bank/families/privacy.ts',
    anchor: 'model-key-never-in-outputs',
    expr: "['haiku', 'jev']",
    reason: REASON.ARMS,
  },
  {
    file: 'bank/families/radius.ts',
    anchor: 'kinds',
    expr: "['delete', 'negate', 'reword', 'cosmetic', 'move']",
    reason: REASON.LINKS,
  },
  {
    file: 'bank/families/reanchoring.ts',
    anchor: 'events',
    expr: "['moved', 'unchanged']",
    reason: REASON.EVENTS,
    count: 2,
  },
  {
    file: 'bank/families/reanchoring.ts',
    anchor: 'header',
    expr: "['item', 'note']",
    reason: REASON.FIXTURE,
  },
  {
    file: 'bank/families/reanchoring.ts',
    anchor: 'script-mixed-6',
    expr: "['reword', 'rewrite', 'delete', 'insert', 'move', 'split']",
    reason: REASON.EDITS,
  },
  {
    file: 'bank/families/reanchoring.ts',
    anchor: 'script-mixed-20',
    expr: "[ 'reword', 'rewrite', 'delete', 'insert', 'move', 'split', 'merge', 'reword', 'rewrite', 'delete', 'insert', 'split', 'merge', 'reword', 'rewrite', 'delete', 'insert', 'reword', 'split', 'merge', ]",
    reason: REASON.EDITS,
  },
  {
    file: 'bank/families/reanchoring.ts',
    anchor: 'script-multi-file',
    expr: "[ 'reword', 'rewrite', 'delete', 'insert', 'move', 'move', 'move', 'split', 'merge', 'reword', 'rewrite', 'delete', 'insert', 'reword', 'split', ]",
    reason: REASON.EDITS,
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'miss-names-labeler',
    expr: "['haiku', 'jev']",
    reason: REASON.ARMS,
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'want',
    expr: "['file', 'path']",
    reason: REASON.FIELDS,
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'want',
    expr: "['promptversion', 'prompt']",
    reason: REASON.FIELDS,
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'want',
    expr: "['schemaversion', 'schema']",
    reason: REASON.FIELDS,
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'want',
    expr: "['setname', 'set']",
    reason: REASON.FIELDS,
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'want',
    expr: "['labeler', 'labeller', 'model']",
    reason: REASON.FIELDS,
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'cassette-stored-answer',
    expr: "['haiku', 'jev']",
    reason: REASON.ARMS,
  },
  {
    file: 'bank/families/replay.ts',
    anchor: 'cassette-stored-answer',
    expr: "[...need, 'model', 'stop', 'usage']",
    reason: REASON.FIELDS,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['description', 'description', 'description']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['rule', 'rule', 'rule']",
    reason: REASON.VOTES,
    count: 4,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['none', 'none', 'none']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['description', 'description', 'rule']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['description', 'rule', 'description']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['rule', 'description', 'description']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "[null, 'description', 'description']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['description', null, 'description']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['description', 'description', null]",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['', 'description', 'description']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['description', 'outside-declared-set', 'description']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/families/stack.ts',
    anchor: 'system2Votes',
    expr: "['description', 'description', ' ']",
    reason: REASON.VOTES,
  },
  {
    file: 'bank/reader-link.ts',
    anchor: 'stdio',
    expr: "['ignore', 'inherit', 'inherit', 'ipc']",
    reason: REASON.STDIO,
  },
  {
    file: 'bank/rpc.ts',
    anchor: 'PARTS',
    expr: "['links', 'rerun', 'settings', 'stack']",
    reason: REASON.MISC,
  },
  {
    file: 'bank/run.ts',
    anchor: 'stdio',
    expr: "['ignore', 'inherit', 'inherit', 'ipc']",
    reason: REASON.STDIO,
  },
  {
    file: 'bank/specs/adversarial.ts',
    anchor: 'needs',
    expr: "['scan', 'child']",
    reason: REASON.NEEDS,
    count: 6,
  },
  {
    file: 'bank/specs/hardening-bugs-b.ts',
    anchor: 'needs',
    expr: "['scan', 'rerun']",
    reason: REASON.NEEDS,
  },
  {
    file: 'bank/specs/hardening-bugs-d.ts',
    anchor: 'needs',
    expr: "['scan', 'transport']",
    reason: REASON.NEEDS,
    count: 3,
  },
  {
    file: 'bank/specs/hardening-bugs-d.ts',
    anchor: 'needs',
    expr: "['transport', 'cassette']",
    reason: REASON.NEEDS,
    count: 2,
  },
  {
    file: 'bank/specs/hardening-bugs-d.ts',
    anchor: 'needs',
    expr: "['scan', 'transport', 'cassette']",
    reason: REASON.NEEDS,
  },
  {
    file: 'bank/specs/hardening-privacy.ts',
    anchor: 'needs',
    expr: "['scan', 'transport']",
    reason: REASON.NEEDS,
    count: 3,
  },
  {
    file: 'bank/specs/hardening.ts',
    anchor: 'needs',
    expr: "['cut', 'child']",
    reason: REASON.NEEDS,
    count: 2,
  },
  {
    file: 'bank/specs/hardening.ts',
    anchor: 'needs',
    expr: "['transport', 'cassette']",
    reason: REASON.NEEDS,
    count: 4,
  },
  {
    file: 'bank/specs/hardening.ts',
    anchor: 'needs',
    expr: "['scan', 'child']",
    reason: REASON.NEEDS,
  },
  {
    file: 'bank/specs/hardening.ts',
    anchor: 'needs',
    expr: "['scan', 'rerun']",
    reason: REASON.NEEDS,
    count: 4,
  },
  {
    file: 'bank/specs/ids.ts',
    anchor: 'needs',
    expr: "['scan', 'child']",
    reason: REASON.NEEDS,
  },
  {
    file: 'bank/specs/labels.ts',
    anchor: 'needs',
    expr: "['transport', 'cassette']",
    reason: REASON.NEEDS,
    count: 2,
  },
  {
    file: 'bank/specs/links.ts',
    anchor: 'needs',
    expr: "['scan', 'links']",
    reason: REASON.NEEDS,
  },
  {
    file: 'bank/specs/privacy.ts',
    anchor: 'needs',
    expr: "['scan', 'child']",
    reason: REASON.NEEDS,
  },
  {
    file: 'bank/specs/privacy.ts',
    anchor: 'needs',
    expr: "['transport', 'cassette', 'child']",
    reason: REASON.NEEDS,
    count: 11,
  },
  {
    file: 'bank/specs/privacy.ts',
    anchor: 'needs',
    expr: "['transport', 'child']",
    reason: REASON.NEEDS,
    count: 5,
  },
  {
    file: 'bank/specs/radius.ts',
    anchor: 'needs',
    expr: "['scan', 'links']",
    reason: REASON.NEEDS,
  },
  {
    file: 'bank/specs/replay.ts',
    anchor: 'needs',
    expr: "['transport', 'cassette']",
    reason: REASON.NEEDS,
    count: 2,
  },
  {
    file: 'bank/specs/replay.ts',
    anchor: 'needs',
    expr: "['scan', 'cassette', 'transport']",
    reason: REASON.NEEDS,
    count: 12,
  },
  {
    file: 'bank/specs/replay.ts',
    anchor: 'needs',
    expr: "['transport', 'cassette', 'child']",
    reason: REASON.NEEDS,
  },
  {
    file: 'bank/specs/scale.ts',
    anchor: 'needs',
    expr: "['scan', 'child']",
    reason: REASON.NEEDS,
  },
  {
    file: 'bank/specs/scale.ts',
    anchor: 'needs',
    expr: "['scan', 'links', 'child']",
    reason: REASON.NEEDS,
    count: 2,
  },
  {
    file: 'bank/specs/scale.ts',
    anchor: 'needs',
    expr: "['transport', 'cassette', 'child']",
    reason: REASON.NEEDS,
  },
  {
    file: 'blind/bank.test.ts',
    anchor: 'families',
    expr: "[ 'cutting', 'ids', 're-anchoring', 'grouping', 'labels', 'replay', 'privacy', 'links', 'radius', 'scale', 'adversarial', ]",
    reason: REASON.MISC,
  },
  {
    file: 'blind/bank.test.ts',
    anchor: '(module)',
    expr: "['empty', 'constant', 'echo']",
    reason: REASON.MISC,
  },
  {
    file: 'blind/bank.test.ts',
    anchor: '(module)',
    expr: "['quote', 'status']",
    reason: REASON.MISC,
  },
  {
    file: 'blind/bank/identity.ts',
    anchor: 'GRID_WORDS',
    expr: "[ 'amber', 'basket', 'candle', 'drawer', 'ember', 'folder', 'garden', 'harbor', 'island', 'jacket', 'kettle', 'lantern', 'marble', 'napkin', 'orchard', 'pencil', 'quilt', 'ribbon', 'saddle', 'tablet', 'umbrella', 'window', 'yellow', 'zipper', 'brass', 'cedar', 'dusty', 'eager', 'faded', 'gentle', 'hollow', 'inner', 'jolly', 'keen', 'light', 'mossy', 'noble', 'outer', 'plain', 'quiet', 'rusty', 'silent', 'tidy', 'upper', 'woolen', 'young', 'zesty', 'crisp', 'bright', 'calm', 'dark', 'early', 'fresh', 'green', 'heavy', 'idle', 'late', 'mild', 'neat', 'open', ]",
    reason: REASON.VOCAB,
  },
  {
    file: 'blind/bank/identity.ts',
    anchor: 'GRID_VERBS',
    expr: "[ 'Keep', 'Count', 'Shelve', 'Weigh', 'Label', 'Store', 'Mend', 'Sort', 'Stack', 'Wrap', 'Check', 'Move', ]",
    reason: REASON.VOCAB,
  },
  {
    file: 'blind/bank/identity.ts',
    anchor: 'contexts',
    expr: "['unicode', 'repeated-neighbours', 'emphasis']",
    reason: REASON.MISC,
  },
  {
    file: 'blind/bank/labels.ts',
    anchor: 'labels',
    expr: "['none', b, 'none']",
    reason: REASON.LABELSET,
  },
  {
    file: 'blind/bank/materialize.ts',
    anchor: 'cases',
    expr: "[ 'obligation', 'prohibition', 'custom-label', 'no-mapping', 'gate-forward', 'gate-backward', 'unicode-quote', 'none-flip', 'set-isolation', 'bound-relabel', ]",
    reason: REASON.MISC,
  },
  {
    file: 'blind/bank/privacy.ts',
    anchor: 'placements',
    expr: "[ 'paragraph', 'heading', 'list', 'table', 'quote', 'fence', 'comment', 'frontmatter', 'inline-code', 'html', ]",
    reason: REASON.MISC,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['suspect', 'ok']",
    reason: REASON.TABLE,
    count: 4,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['changed', 'unchanged']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['split', 'unchanged']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['suspect', 'suspect']",
    reason: REASON.TABLE,
    count: 5,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['merged', 'deleted']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['advisory', 'suspect']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['context', 'changed']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['advisory', 'ok']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['heading', 'unchanged']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['ambiguous', 'suspect']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['ambiguous', 'deleted']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['ok', 'advisory']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['moved', 'heading']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['split', 'merged']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['ambiguous', 'advisory']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['ambiguous', 'context']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['ok', 'suspect', 'advisory', 'ambiguous']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['unchanged', 'changed', 'heading', 'ambiguous']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['ok', 'suspect', 'advisory']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['unchanged', 'deleted', 'context']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['ok', 'suspect']",
    reason: REASON.TABLE,
    count: 2,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['unchanged', 'changed']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['changed', 'changed']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changes',
    expr: "['deleted', 'moved']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'changed',
    expr: "['changed', 'changed-context', 'split', 'merged']",
    reason: REASON.LABELTEST,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['suspect', 'advisory']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['suspect', 'ambiguous']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/relations.ts',
    anchor: 'states',
    expr: "['suspect', 'ok', 'suspect', 'advisory', 'ambiguous']",
    reason: REASON.TABLE,
  },
  {
    file: 'blind/bank/replay.ts',
    anchor: 'fields',
    expr: "[ 'model', 'system', 'messages', 'output', 'max_tokens', 'thinking', 'set.name', 'set.description', 'set.labels.name', 'set.labels.description', 'set.labels.examples', 'set.labels.target', 'set.labels.atom', 'labelerId', 'cutDigest', ]",
    reason: REASON.FIELDS,
  },
  {
    file: 'blind/bank/replay.ts',
    anchor: 'versionsRequired',
    expr: "['node', 'icu']",
    reason: REASON.MISC,
  },
  {
    file: 'blind/bank/structure.ts',
    anchor: 'units',
    expr: "['Key', 'Place', ...rows.flat()]",
    reason: REASON.FIXTURE,
  },
  {
    file: 'kit/anchor-case.ts',
    anchor: 'REMOVABLE',
    expr: "['paragraph', 'list', 'quote', 'table']",
    reason: REASON.CONTAINERS,
  },
  {
    file: 'kit/anchor-case.ts',
    anchor: 'segs',
    expr: "['split', 'merge', 'reword', 'delete', 'insert']",
    reason: REASON.EDITS,
  },
  {
    file: 'kit/child-run.ts',
    anchor: 'stdio',
    expr: "['ignore', 'pipe', 'pipe']",
    reason: REASON.STDIO,
  },
  {
    file: 'kit/estate.ts',
    anchor: 'PROSE_CONTAINERS',
    expr: "['sentence', 'list_item', 'table_cell', 'block_quote', 'heading']",
    reason: REASON.CONTAINERS,
  },
  {
    file: 'kit/labellers.ts',
    anchor: 'TRUTH_LABELS',
    expr: "['rule', 'prohibition', 'example', 'description']",
    reason: REASON.LABELSET,
  },
  {
    file: 'kit/oracle.ts',
    anchor: 'EXACT_SPAN',
    expr: "['sentence', 'fence', 'comment']",
    reason: REASON.CONTAINERS,
  },
  {
    file: 'kit/segments.ts',
    anchor: 'events',
    expr: "['moved', 'unchanged']",
    reason: REASON.EVENTS,
  },
  {
    file: 'kit/words.ts',
    anchor: 'HEAD_KINDS',
    expr: "['notes', 'steps', 'checks', 'duties', 'rounds']",
    reason: REASON.VOCAB,
  },
  {
    file: 'kit/world.ts',
    anchor: 'style',
    expr: "['plain', 'double', 'single']",
    reason: REASON.FIXTURE,
  },
  {
    file: 'kit/world.ts',
    anchor: 'info',
    expr: "['', 'bash', 'yaml']",
    reason: REASON.FIXTURE,
  },
  {
    file: 'kit/world.ts',
    anchor: 'tag',
    expr: "['rules', 'role', 'notes']",
    reason: REASON.FIXTURE,
  },
  {
    file: 'sut/blind-binding/replay.ts',
    anchor: 'WIRE_FIELDS',
    expr: "['model', 'system', 'messages', 'output', 'max_tokens', 'thinking']",
    reason: REASON.MISC,
  },
  {
    file: 'sut/blind-binding/replay.ts',
    anchor: 'SET_FIELDS',
    expr: "['name', 'description']",
    reason: REASON.MISC,
  },
  {
    file: 'sut/blind-binding/replay.ts',
    anchor: 'versionsRequired',
    expr: "['node', 'icu']",
    reason: REASON.MISC,
  },
  {
    file: 'sut/reader.ts',
    anchor: 'NAMES',
    expr: "[ 'AtomBuilder', 'AGENT_RULES_SET', 'Cassette', 'cut', 'LabelerError', 'buildLabelling', 'singleLabelling', 'denseOpinions', 'parseDenseAnswer', 'parseLabelSets', 'parseLedger', 'renderLedger', 'setHash', 'pointerScan', 'pointerAtoms', ]",
    reason: REASON.MISC,
  },
];

/** Whether the body of a regular expression matches letters or words (see the file comment). */
export function readsLetters(body: string): boolean {
  let inClass = false;
  const isLetter = (ch: string) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (ch === '\\') {
      const next = body[i + 1] ?? '';
      if ('wWSpP'.includes(next) || (!inClass && 'bB'.includes(next))) return true;
      if (next === 'u' && body[i + 2] === '{') i = body.indexOf('}', i + 2);
      else if (next === 'u') i += 5;
      else if (next === 'x') i += 3;
      else if (next === 'c') i += 2;
      else if (next === 'k' && body[i + 2] === '<') i = body.indexOf('>', i + 2);
      else i += 1;
      if (i < 0) return true;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      else if (isLetter(ch)) return true;
    } else if (ch === '[') {
      inClass = true;
      if (body[i + 1] === '^') i += 1;
    } else if (
      ch === '(' &&
      body[i + 1] === '?' &&
      body[i + 2] === '<' &&
      !'=!'.includes(body[i + 3] ?? '')
    ) {
      // A named group: its name is not text the expression matches.
      const end = body.indexOf('>', i + 3);
      if (end < 0) return true;
      i = end;
    } else if (isLetter(ch)) return true;
  }
  return false;
}

/** Whether a split by this regular expression body cuts at spaces or letters. */
const splitsWords = (body: string): boolean =>
  readsLetters(body) || body.includes('\\s') || body.includes(' ');

const regexBody = (literal: string): string => literal.slice(1, literal.lastIndexOf('/'));

const hasLetter = (text: string): boolean => /[A-Za-z]/.test(text);

/** A plain word: two or more ASCII letters and nothing else (see the file comment). */
const PLAIN_WORD = /^[A-Za-z]{2,}$/;

/** The methods of a text that read it, and the ones that test it for a word. */
const READERS = new Set(['split', 'match', 'matchAll', 'search', 'replace', 'replaceAll']);
const TESTERS = new Set(['includes', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith']);
/** The iterators whose callback answers whether a list holds an element. */
const PREDICATES = new Set(['some', 'every', 'find', 'findIndex', 'filter']);
const ITERATORS = new Set([
  'some',
  'every',
  'find',
  'findIndex',
  'filter',
  'forEach',
  'map',
  'flatMap',
  'reduce',
]);

/** Strips `as`, `satisfies`, `!` and parentheses around an expression. */
function bare(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current)
  )
    current = current.expression;
  return current;
}

export function findingsOf(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];

  // Every `const name = <initializer>` of the file, by name: what an identifier is bound to, when it is known.
  // A name declared more than once (a const, a let, a parameter, a binding, a function) is not resolved: the
  // guard reads no scopes, so it never guesses which declaration an identifier means.
  const consts = new Map<string, ts.Expression>();
  const declared = new Map<string, number>();
  const collect = (node: ts.Node): void => {
    const named =
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isFunctionDeclaration(node);
    if (named && node.name && ts.isIdentifier(node.name))
      declared.set(node.name.text, (declared.get(node.name.text) ?? 0) + 1);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    )
      consts.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  for (const [name, count] of declared) if (count > 1) consts.delete(name);

  /** The node an expression stands for: a const identifier resolved to its initializer, wrappers removed. */
  const resolve = (node: ts.Node | undefined, depth = 0): ts.Node | undefined => {
    if (!node) return undefined;
    const b = bare(node);
    if (ts.isIdentifier(b) && depth < 8) {
      const bound = consts.get(b.text);
      return bound ? resolve(bound, depth + 1) : b;
    }
    return b;
  };

  /**
   * The text an expression builds when it is made of string pieces: a literal, a template, a `+` of pieces, a
   * `join` or `concat` of pieces, or one of these with its case or ends changed. `text` holds the pieces that are
   * known, in order; `full` says that no piece is unknown. Undefined when the expression is not made of pieces.
   */
  const piecesOf = (node: ts.Node | undefined, depth = 0): { text: string; full: boolean } | undefined => {
    const n = resolve(node);
    if (!n || depth > 8) return undefined;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return { text: n.text, full: true };
    if (ts.isTemplateExpression(n)) {
      let text = n.head.text;
      let full = true;
      for (const span of n.templateSpans) {
        const piece = piecesOf(span.expression, depth + 1);
        text += (piece?.text ?? '') + span.literal.text;
        if (!piece?.full) full = false;
      }
      return { text, full };
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = piecesOf(n.left, depth + 1);
      const right = piecesOf(n.right, depth + 1);
      if (!left && !right) return undefined;
      return { text: (left?.text ?? '') + (right?.text ?? ''), full: !!left?.full && !!right?.full };
    }
    if (
      ts.isCallExpression(n) &&
      (ts.isPropertyAccessExpression(n.expression) || ts.isElementAccessExpression(n.expression))
    ) {
      const method = memberName(n.expression);
      const receiver = n.expression.expression;
      if (
        method &&
        ['toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd', 'toString'].includes(method)
      )
        return piecesOf(receiver, depth + 1);
      if (method === 'concat') {
        const parts = [receiver, ...n.arguments].map((a) => piecesOf(a, depth + 1));
        if (!parts[0]) return undefined;
        return {
          text: parts.map((x) => x?.text ?? '').join(''),
          full: parts.every((x) => x?.full),
        };
      }
      if (method === 'join') {
        const list = resolve(receiver);
        if (!list || !ts.isArrayLiteralExpression(list)) return undefined;
        const parts = list.elements.map((e) => piecesOf(e, depth + 1));
        if (parts.every((x) => x === undefined)) return undefined;
        const glue = n.arguments[0] ? piecesOf(n.arguments[0], depth + 1) : { text: ',', full: true };
        return {
          text: parts.map((x) => x?.text ?? '').join(glue?.text ?? ''),
          full: parts.every((x) => x?.full) && !!glue?.full,
        };
      }
    }
    return undefined;
  };

  /** The static text of a string made only of known pieces; undefined otherwise. */
  const staticText = (node: ts.Node | undefined): string | undefined => {
    const piece = piecesOf(node);
    return piece?.full ? piece.text : undefined;
  };

  /** Whether an expression is made of string pieces of which the known ones hold a letter. */
  const hasLiteralLetter = (node: ts.Node | undefined): boolean => {
    const piece = piecesOf(node);
    return piece !== undefined && hasLetter(piece.text);
  };

  /** Whether an element is a plain word: letters only, two or more, built of known string pieces. */
  const isPlainWord = (node: ts.Node): boolean => {
    if (ts.isIdentifier(bare(node))) return false;
    const text = staticText(node);
    return text !== undefined && PLAIN_WORD.test(text);
  };
  const plainWordCount = (elements: readonly ts.Node[]): number => elements.filter(isPlainWord).length;
  /** The tuples of a `new Map([[key, value], ..])` argument: their keys are counted by the Map rule only. */
  const mapEntries = new Set<ts.Node>();

  /** Whether an expression is (or is bound to) an array with an element that is a literal word. */
  const isWordList = (node: ts.Node | undefined, depth = 0): boolean => {
    const n = resolve(node);
    if (!n || depth > 8) return false;
    if (ts.isCallExpression(n) && n.arguments.length === 1) {
      const callee = n.expression.getText(sf);
      if (callee === 'Object.freeze' || callee === 'Array.from') return isWordList(n.arguments[0], depth + 1);
    }
    if (!ts.isArrayLiteralExpression(n)) return false;
    return n.elements.some((e) =>
      ts.isSpreadElement(e) ? isWordList(e.expression, depth + 1) : hasLiteralLetter(e),
    );
  };

  /** The name a const identifier stands for when it is an alias of another identifier (`const alias = words`). */
  const rootName = (name: string): string => {
    let current = name;
    for (let depth = 0; depth < 8; depth += 1) {
      const bound = consts.get(current);
      const next = bound ? bare(bound) : undefined;
      if (!next || !ts.isIdentifier(next)) break;
      current = next.text;
    }
    return current;
  };

  /** Root names of the Sets given a literal word with `add` (through an alias or not). */
  const addedTo = new Set<string>();
  const collectAdds = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && memberName(node.expression) === 'add') {
      const callee = node.expression;
      const receiver =
        ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
          ? bare(callee.expression)
          : undefined;
      if (receiver && ts.isIdentifier(receiver) && hasLiteralLetter(node.arguments[0]))
        addedTo.add(rootName(receiver.text));
    }
    ts.forEachChild(node, collectAdds);
  };

  /** Whether an expression is (or is bound to) a Set built from a word list or given literal words. */
  const isWordSet = (node: ts.Node | undefined): boolean => {
    const raw = node ? bare(node) : undefined;
    if (raw && ts.isIdentifier(raw) && addedTo.has(rootName(raw.text))) return true;
    const n = resolve(node);
    if (!n) return false;
    if (!ts.isNewExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'Set') return false;
    const arg = n.arguments?.[0];
    if (!arg) return false;
    return isWordList(arg);
  };

  /** The method name of a property or a bracket access with a known key. */
  const memberName = (node: ts.Node): string | undefined => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) return staticText(node.argumentExpression);
    return undefined;
  };

  /** The name of the nearest named function, method, variable or property around a node. */
  const anchorOf = (node: ts.Node): string => {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if (
        (ts.isFunctionDeclaration(p) ||
          ts.isMethodDeclaration(p) ||
          ts.isClassDeclaration(p) ||
          ts.isVariableDeclaration(p) ||
          ts.isPropertyAssignment(p) ||
          ts.isPropertyDeclaration(p) ||
          ts.isGetAccessorDeclaration(p)) &&
        p.name
      ) {
        const name = p.name;
        if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name))
          return name.text;
        return name.getText(sf);
      }
    }
    return '(module)';
  };

  const add = (node: ts.Node, why: string) =>
    found.push({
      file,
      anchor: anchorOf(node),
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      text: node.getText(sf).replace(/\s+/g, ' '),
      why,
    });

  /** Whether an expression is, or holds, the identifier `name`. */
  const mentions = (node: ts.Node, name: string): boolean => {
    if (ts.isIdentifier(node) && node.text === name) return true;
    return ts.forEachChild(node, (child) => mentions(child, name) || undefined) ?? false;
  };

  /** Whether `body` calls a text reader or tester with an argument that holds the identifier `name`. */
  const testsWith = (body: ts.Node, name: string): boolean => {
    if (ts.isCallExpression(body)) {
      const method = memberName(body.expression);
      if (
        method &&
        (READERS.has(method) || TESTERS.has(method)) &&
        body.arguments.some((a) => mentions(a, name))
      )
        return true;
    }
    return ts.forEachChild(body, (child) => testsWith(child, name) || undefined) ?? false;
  };

  /** Whether `body` compares the identifier `name` with something that is not a literal (`w === word`). */
  const comparesWith = (body: ts.Node, name: string): boolean => {
    if (
      ts.isBinaryExpression(body) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(body.operatorToken.kind)
    ) {
      const left = bare(body.left);
      const right = bare(body.right);
      const literal = (n: ts.Node) => ts.isStringLiteralLike(n) || ts.isNumericLiteral(n);
      if (ts.isIdentifier(left) && left.text === name && !literal(right)) return true;
      if (ts.isIdentifier(right) && right.text === name && !literal(left)) return true;
    }
    return ts.forEachChild(body, (child) => comparesWith(child, name) || undefined) ?? false;
  };

  /** Whether a callback tests a text for its first parameter (an element of the list it iterates). */
  const testsElement = (callback: ts.Node, compares: boolean): boolean => {
    const fn = bare(callback);
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false;
    const param = fn.parameters[0]?.name;
    return (
      param !== undefined &&
      ts.isIdentifier(param) &&
      (testsWith(fn.body, param.text) || (compares && comparesWith(fn.body, param.text)))
    );
  };

  /** Whether a for-of loop tests a text for its loop variable. */
  const loopTests = (node: ts.ForOfStatement): boolean => {
    const list = node.initializer;
    if (!ts.isVariableDeclarationList(list)) return false;
    const name = list.declarations[0]?.name;
    return name !== undefined && ts.isIdentifier(name) && testsWith(node.statement, name.text);
  };

  const checkSplit = (node: ts.CallExpression, first: ts.Expression | undefined) => {
    if (!first) return;
    const target = resolve(first);
    const piece = piecesOf(first);
    if (piece !== undefined) {
      if (piece.text.includes(' ')) add(node, 'a split at spaces (word picking)');
      else if (hasLetter(piece.text)) add(node, 'a split at a literal word');
      else if (!piece.full && !ts.isTemplateExpression(bare(first)))
        add(node, 'a split by a separator not known at the call');
    } else if (target && target.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      if (splitsWords(regexBody(target.getText(sf))))
        add(node, 'a split by a pattern at spaces or letters (word picking)');
    } else add(node, 'a split by a separator not known at the call');
  };

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      if (readsLetters(regexBody(node.getText(sf)))) add(node, 'a regular expression that matches letters');
    } else if (ts.isIdentifier(node) && node.text === 'RegExp') {
      const parent = node.parent;
      const called =
        (ts.isNewExpression(parent) || ts.isCallExpression(parent)) && parent.expression === node;
      const typeOnly = ts.isTypeReferenceNode(parent) || ts.isExpressionWithTypeArguments(parent);
      const instance =
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
        parent.right === node;
      if (called) {
        const piece = piecesOf((parent as ts.NewExpression | ts.CallExpression).arguments?.[0]);
        if (piece === undefined || readsLetters(piece.text)) add(parent, 'a RegExp built to match letters');
      } else if (!typeOnly && !instance) add(node, 'RegExp taken as a value (an alias)');
    } else if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name;
      const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
      if (name && READERS.has(name)) add(node, `${name} taken out of an object (an alias)`);
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node);
      const parent = node.parent;
      const called = ts.isCallExpression(parent) && parent.expression === node;
      // A method of a string is called or borrowed (`.call`, `.apply`, `.bind`); a field of that name that is
      // the receiver of another member (`plan.split.push`) is data, not the method.
      const member =
        (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
        parent.expression === node;
      const borrowed = member && ['call', 'apply', 'bind'].includes(memberName(parent) ?? '');
      if (name && READERS.has(name) && !called && (!member || borrowed))
        add(node, `${name} taken as a value (an alias)`);
    }
    // The word list itself, however it is used afterwards: an array (a Set is built from an array) with two or
    // more plain words, and a Map with two or more plain-word keys.
    if (ts.isArrayLiteralExpression(node)) {
      if (!mapEntries.has(node) && plainWordCount(node.elements) >= 2)
        add(node, 'a list of two or more plain words');
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Map'
    ) {
      const entries = resolve(node.arguments?.[0]);
      if (entries && ts.isArrayLiteralExpression(entries)) {
        const tuples = entries.elements
          .map((e) => bare(e))
          .filter((e): e is ts.ArrayLiteralExpression => ts.isArrayLiteralExpression(e));
        for (const tuple of tuples) mapEntries.add(tuple);
        const keys = tuples.filter((t) => {
          const key = t.elements[0];
          return key !== undefined && isPlainWord(key);
        });
        if (keys.length >= 2) add(node, 'a Map with two or more plain-word keys');
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = memberName(callee);
      const args = node.arguments;
      const first = args[0];
      const receiver =
        ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
          ? callee.expression
          : undefined;
      if (name === 'split') checkSplit(node, first);
      else if (name === 'search' || name === 'match' || name === 'matchAll') add(node, `a ${name} call`);
      else if (name === 'replace' || name === 'replaceAll') {
        const target = resolve(first);
        const piece = piecesOf(first);
        if (piece !== undefined) {
          if (hasLetter(piece.text)) add(node, `a ${name} of a literal word`);
        } else if (!target || target.kind !== ts.SyntaxKind.RegularExpressionLiteral)
          add(node, `a ${name} by a pattern not known at the call`);
      } else if (name && TESTERS.has(name)) {
        if (isWordList(receiver)) add(node, 'a literal word list searched');
        else if (hasLiteralLetter(first)) add(node, `a test for a literal word (${name})`);
      } else if (name === 'has' && isWordSet(receiver)) add(node, 'a Set of literal words searched');
      else if (
        name &&
        ITERATORS.has(name) &&
        isWordList(receiver) &&
        args.some((a) => testsElement(a, PREDICATES.has(name)))
      )
        add(node, 'a literal word list tested against a text');
    } else if (ts.isForOfStatement(node) && isWordList(node.expression) && loopTests(node))
      add(node.expression, 'a literal word list tested against a text');
    ts.forEachChild(node, visit);
  };
  collectAdds(sf);
  visit(sf);
  return found;
}

const allowedBy = (finding: Finding) =>
  ALLOWED.filter((a) => a.file === finding.file && a.anchor === finding.anchor && a.expr === finding.text);

/** The allowances that do not match exactly their `count` (one by default) of the given findings. */
const mismatches = (found: Finding[], among: Allowance[] = ALLOWED): string[] =>
  among.flatMap((a) => {
    const n = found.filter((f) => allowedBy(f).includes(a)).length;
    return n === (a.count ?? 1)
      ? []
      : [`${a.file} ${a.anchor}: ${a.expr} matches ${n}, expected ${a.count ?? 1}`];
  });

/** Sources of the bypass forms of the review of PR 1136: each must be found. */
const BYPASSES: Record<string, string[]> = {
  'a bare alternation regular expression': [
    'export const reads = (text: string) => /never|always|must/i.test(text);',
    'export const reads = (text: string) => /^Always /.test(text);',
  ],
  'a RegExp built at run time': [
    "export const reads = (text: string) => new RegExp('never|always|must', 'i').test(text);",
    "const SOURCE = 'never|must'; export const reads = (text: string) => new RegExp(SOURCE).test(text);",
    'export const reads = (text: string, words: string) => new RegExp(words).test(text);',
    "const R = RegExp; export const reads = (text: string) => new R('never').test(text);",
    "export const reads = (text: string) => globalThis.RegExp('never').test(text);",
  ],
  'a split alias': [
    "const sep = ' '; export const reads = (text: string) => text.split(sep)[1];",
    "export const reads = (text: string) => { const sp = text.split; return sp.call(text, ' ')[1]; };",
    "export const reads = (text: string) => String.prototype.split.call(text, ' ')[1];",
    "const words = (t: string, s: string) => t.split(s); export const reads = (text: string) => words(text, ' ');",
    "const { split } = String.prototype; export const reads = (text: string) => split.call(text, ' ');",
  ],
  'a literal word list used with includes': [
    "export const reads = (text: string) => ['never', 'not'].some((w) => text.includes(w));",
    "const WORDS = ['never', 'not'] as const; export const reads = (w: string) => WORDS.includes(w as never);",
    "export const reads = (text: string) => { for (const w of ['never', 'not']) if (text.includes(w)) return w; };",
    "export const reads = (text: string) => text.includes('never');",
    "export const reads = (text: string) => text.replace('never', 'always');",
  ],
  'a Set of words searched with has': [
    "const NOT = new Set(['never', 'not']); export const reads = (w: string) => NOT.has(w);",
    "export const reads = (w: string) => new Set(['never', 'not']).has(w);",
    "const WORDS = ['never', 'not']; const NOT = new Set(WORDS); export const reads = (w: string) => NOT.has(w);",
    "const NOT = new Set<string>(); NOT.add('never'); export const reads = (w: string) => NOT.has(w);",
    "const NOT = new Set([...['never', 'not']]); export const reads = (w: string) => NOT.has(w);",
  ],
  'a word built from pieces searched in a text': [
    "export const reads = (text: string) => text.includes('ne' + 'ver');",
    "export const reads = (text: string) => text.includes(`${'ne'}${'ver'}`);",
    "const HEAD = 'ne'; export const reads = (text: string) => text.indexOf(HEAD + 'ver') >= 0;",
    "export const reads = (text: string) => text.includes(['ne', 'ver'].join(''));",
    "export const reads = (text: string) => text.startsWith('ne'.concat('ver'));",
    "export const reads = (text: string) => text.replace('ne' + 'ver', 'always');",
    "export const reads = (text: string, tail: string) => text.endsWith('ne' + tail);",
  ],
  'a word array searched with some and includes': [
    "export const reads = (text: string) => ['never', 'always'].some((w) => text.includes(w));",
    "export const reads = (text: string) => ['never', 'always'].every((w) => text.startsWith(w));",
    "export const reads = (word: string) => ['never', 'always'].includes(word);",
    "export const reads = (word: string) => ['never', 'always'].indexOf(word) >= 0;",
    "const W = ['never', 'always']; export const reads = (word: string) => W.some((w) => w === word);",
    "const W = ['never', 'always'] as const; export const reads = (w: string) => W.includes(w as never);",
    "const W = Object.freeze(['never', 'always']); export const reads = (w: string) => W.includes(w);",
    "const A = ['never']; const W = [...A, 'must']; export const reads = (w: string) => W.includes(w);",
    "export const reads = (text: string, extra: string) => [extra, 'never'].some((w) => text.includes(w));",
  ],
  'a bracket-access match': [
    "export const reads = (text: string) => text['match'](/x/);",
    "export const reads = (text: string) => text['split'](' ');",
    "const m = 'search'; export const reads = (text: string) => text[m](/x/);",
  ],
};

/** Word lists (the final scope of the guard): each source holds a list of plain words, however it is used. */
const WORD_LISTS: Record<string, string[]> = {
  'an array of two plain words': [
    "export const words = ['never', 'always'];",
    "export const words = ['never', 'always'] as const;",
    "export const words = Object.freeze(['never', 'always']);",
    "export const words = ['ne' + 'ver', 'must'];",
    'export const words = [`never`, `must`];',
    "export const words = ['never', 'always', 'a/b', 3];",
    "export const f = (extra: string) => [extra, 'never', 'must'];",
    "export const f = (list: string[]) => [...list, 'never', 'must'];",
  ],
  'a Set literal or a Set built from a list': [
    "export const words = new Set(['never', 'always']);",
    "export const words = new Set<string>(['never', 'always']);",
    "const LIST = ['never', 'always']; export const words = new Set(LIST);",
  ],
  'a Map with plain-word keys': [
    "export const m = new Map([['never', 1], ['always', 2]]);",
    "export const m = new Map<string, number>([['never', 1], ['always', 2], ['a/b', 3]]);",
    "const E = [['never', 1], ['always', 2]] as const; export const m = new Map(E);",
  ],
  'a let initializer': [
    "export function reads(text: string) { let words = new Set(['never', 'must']); return words.has(text); }",
    "let list = ['never', 'must']; export const reads = (w: string) => list.includes(w);",
  ],
  'a Set filled with add, through an alias': [
    "const words = new Set<string>(); const alias = words; alias.add('never'); export const reads = (t: string) => words.has(t);",
    "const words = new Set<string>(); const alias = words; words.add('never'); export const reads = (t: string) => alias.has(t);",
  ],
  'a literal array passed to forEach with add': [
    "const words = new Set<string>(); ['never', 'must'].forEach((w) => words.add(w)); export const reads = (t: string) => words.has(t);",
    "const words = new Set<string>(); for (const w of ['never', 'must']) words.add(w); export const reads = (t: string) => words.has(t);",
  ],
};

/** Lists that are not word lists of this rule. */
const NOT_WORD_LISTS: string[] = [
  "export const words = ['never'];",
  "export const words = ['never', 3, 4];",
  "export const words = ['a/one.md', 'b/two.md'];",
  "export const words = ['part.user', 'none-of-these', '__proto__', 'v2', 'x:y'];",
  "export const words = ['a', 'b', 'I'];",
  "export const words = ['never be late', 'always be early'];",
  "export const words = ['', ' ', '  '];",
  "export const f = (a: string, b: string) => [a, b, 'never'];",
  "export const words = new Set(['never']);",
  "export const m = new Map([['never', 1]]);",
  "export const m = new Map([[1, 'never'], [2, 'always']]);",
  "export const m = new Map([['a/b', 1], ['c.d', 2]]);",
  'export const words = new Set([1, 2, 3]);',
  "export const f = (text: string) => text === 'never' || text === 'always';",
];

describe('no letter pattern on generated prose in the pointer bank', () => {
  const findings = FOLDERS.flatMap((folder) =>
    sourceFiles(join(ROOT, folder)).flatMap((path) =>
      findingsOf(relative(ROOT, path).split('\\').join('/'), readFileSync(path, 'utf8')),
    ),
  );

  it('the classifier tells letter patterns from the others', () => {
    for (const body of [
      '\\b([a-z]{5,})\\b',
      '[aeo]',
      '(\\w+) ',
      '^(\\S+ \\S+)',
      '\\p{L}+',
      '[^A-Za-z0-9_-]',
      'never|always|must',
      '^Always ',
      's$',
    ])
      expect(readsLetters(body), body).toBe(true);
    for (const body of [
      '\\s+',
      '\\.$',
      '^[0-9]+$',
      '^\\s*(```|~~~)',
      '[^\'"`\\n]+',
      '[,.;]',
      '[\\b]',
      '\\r\\n|\\r|\\n',
      '\\u00e9|\\x41|\\u{1F600}',
      '(?<num>\\d+)\\k<num>',
    ])
      expect(readsLetters(body), body).toBe(false);
    const sample = [
      "const a = t.replace(/\\b([a-z]{5,})\\b/, 'x');",
      "const b = t.split(' ');",
      'const c = t.search(/[aeo]/);',
      'const d = new RegExp(`[^A-Za-z]${x}`);',
      'const e = t.split(/\\s+/);',
      "const f = t.replace(/\\.$/, '').split('|');",
      'const g = t.split(/\\r\\n|\\n/);',
      "const h = t.endsWith('.') && t.includes(':') && t.startsWith('#');",
      "const i = new RegExp('\\\\.$');",
    ].join('\n');
    expect(findingsOf('sample.ts', sample).map((f) => f.line)).toEqual([1, 2, 3, 3, 4, 5]);
  });

  for (const [form, sources] of Object.entries(BYPASSES))
    it(`finds ${form}`, () => {
      for (const source of sources)
        expect(findingsOf('bank/families/ids.ts', source).length, source).toBeGreaterThan(0);
    });

  for (const [form, sources] of Object.entries(WORD_LISTS))
    it(`finds the word list: ${form}`, () => {
      for (const source of sources)
        expect(findingsOf('bank/families/ids.ts', source).length, source).toBeGreaterThan(0);
    });

  it('does not find a list of fewer than two plain words, or of tokens that are not plain words', () => {
    for (const source of NOT_WORD_LISTS)
      expect(
        findingsOf('bank/families/ids.ts', source).map((f) => f.why),
        source,
      ).toEqual([]);
  });

  it('reports a Map once, for its keys, and not its tuples', () => {
    const source = "export const m = new Map([['never', 'x'], ['always', 'y']]);";
    expect(findingsOf('bank/families/ids.ts', source).map((f) => f.why)).toEqual([
      'a Map with two or more plain-word keys',
    ]);
  });

  it('an allowance covers its function, its expression and its count, and nothing else', () => {
    const site = "['rule', 'prohibition']";
    const allowance = ALLOWED.find((a) => a.anchor === 'want' && a.expr === site) as Allowance;
    expect(allowance.file).toBe('bank/families/adversarial.ts');
    const at = (file: string, fn: string, expr: string) =>
      findingsOf(file, `function ${fn}() { return ${expr}; }`);
    const hits = (found: Finding[]) => found.filter((f) => allowedBy(f).includes(allowance)).length;
    const file = allowance.file;
    expect(hits(at(file, 'want', site))).toBe(1);
    expect(hits(at(file, 'other', site))).toBe(0);
    expect(hits(at(file, 'want', "['rule', 'example']"))).toBe(0);
    expect(hits(at('bank/families/ids.ts', 'want', site))).toBe(0);
    // Two identical sites in one function: the allowance (count one) no longer matches exactly.
    const two = at(file, 'want', `[${site}, ${site}]`);
    expect(hits(two)).toBe(2);
    expect(mismatches(two, [allowance])).toHaveLength(1);
    expect(mismatches(at(file, 'want', site), [allowance])).toEqual([]);
    // An allowance whose site is gone matches nothing.
    expect(mismatches([], [allowance])).toHaveLength(1);
  });

  it('an allowance names the full expression: a change in the tail of a long one is a new site', () => {
    const allowance = ALLOWED.find((a) => a.anchor === 'GRID_WORDS') as Allowance;
    expect(allowance.expr.length).toBeGreaterThan(240);
    const at = (expr: string) => findingsOf(allowance.file, `const GRID_WORDS = ${expr};`);
    const hits = (found: Finding[]) => found.filter((f) => allowedBy(f).includes(allowance)).length;
    const same = at(allowance.expr);
    expect(same.map((f) => f.text)).toEqual([allowance.expr]);
    expect(hits(same)).toBe(1);
    // The same first 240 characters, a different last word: the allowance stops matching and the site is open.
    const tail = allowance.expr.replace("'open', ]", "'never', ]");
    expect(tail).not.toBe(allowance.expr);
    expect(tail.slice(0, 240)).toBe(allowance.expr.slice(0, 240));
    const changed = at(tail);
    expect(changed).toHaveLength(1);
    expect(hits(changed)).toBe(0);
    expect(changed.filter((f) => allowedBy(f).length === 0)).toHaveLength(1);
    expect(mismatches(changed, [allowance])).toHaveLength(1);
  });

  it('does not find the ordinary tests of names, numbers and ids', () => {
    for (const source of [
      'const SEEN = new Set<string>(); export const seen = (id: string) => SEEN.has(id);',
      'export const has = (ids: Set<number>, n: number) => ids.has(n) || new Set([1, 2]).has(n);',
      "export const a = (text: string) => text.includes('.') && text.startsWith('#') && text.endsWith('\\n');",
      'export const b = (items: string[], x: string) => items.includes(x) || [1, 2].includes(x.length);',
      "export const c = (parts: string[]) => parts.join('') + `${parts.length}:${parts[0]}`.toString();",
      'export const d = (n: number, list: number[]) => list.some((v) => v === n);',
    ])
      expect(
        findingsOf('bank/families/ids.ts', source).map((f) => f.why),
        source,
      ).toEqual([]);
  });

  it('names the enclosing function of a site', () => {
    const source = [
      'export const runs = {',
      "  'fp-case': async (text: string) => text.split(' '),",
      '};',
      "function helper(text: string) { return [1].map(() => text.split(' ')); }",
    ].join('\n');
    expect(findingsOf('x.ts', source).map((f) => f.anchor)).toEqual(['fp-case', 'helper']);
  });

  it('finds no site outside the named allowances', () => {
    const open = findings.filter((f) => allowedBy(f).length === 0);
    const listing = open
      .map(
        (f) =>
          `${f.file}:${f.line}: ${f.why}\n  ${JSON.stringify({ file: f.file, anchor: f.anchor, expr: f.text })}`,
      )
      .join('\n');
    expect(open, `letter patterns or word splits on prose:\n${listing}`).toEqual([]);
  });

  it('every allowance matches exactly its sites', () => {
    expect(mismatches(findings)).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}
