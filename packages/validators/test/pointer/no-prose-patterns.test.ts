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
 * - each of these methods reached by bracket access (`text['match'](..)`) as by a dot.
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
    anchor: 'crashed',
    expr: '/not reachable/',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'yaml-alias-bomb',
    expr: '/alias|yaml/i',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'yaml-custom-tags',
    expr: '/CANARY/',
    reason: "reads the paths the READER's process wrote (sandbox file names), not prose",
  },
  {
    file: 'bank/families/adversarial.ts',
    anchor: 'yaml-custom-tags',
    expr: '/not reachable/',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
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
    anchor: 'reasons',
    expr: '/no vector/',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
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
    anchor: 'm',
    expr: '/differs in:?\\s*([^;]*)/',
    reason: 'reads the field list of an error message the READER wrote, not prose',
  },
  {
    file: 'bank/families/hardening-bugs-d.ts',
    anchor: 'fieldsNamed',
    expr: '(m[1] as string).split(/[,\\s]+/)',
    reason: 'splits the field list of an error message the READER wrote, not prose',
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
    expr: "fieldsNamed(edited.res.error).includes('setHash')",
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
    anchor: 'settings-threshold-range-refused',
    expr: "['labeler', 'pass_at', 'fail_at', 'margin_cut']",
    reason: 'tests the parse errors the READER wrote for the threshold key the item sent, not prose',
  },
  {
    file: 'bank/families/hardening.ts',
    anchor: 'settings-inherited-threshold-key-refused',
    expr: "['constructor', 'toString', 'hasOwnProperty', 'valueOf']",
    reason: 'tests the parse errors the READER wrote for the threshold key the item sent, not prose',
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
    anchor: 'prompt-examples-max-three',
    expr: '/voice/',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
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
    anchor: 'go',
    expr: '/not reachable/',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
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
    anchor: 'namesToken',
    expr: 'new RegExp(`(^|[^A-Za-z0-9_-])${escaped(token)}($|[^A-Za-z0-9_-])`)',
    reason: 'finds a token (a field name) whole in the error message the READER wrote, not prose',
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
    anchor: 'miss-names-nearest-entry',
    expr: "(res.error ?? '').includes('notes/b.md#1')",
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
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
    file: 'bank/families/replay.ts',
    anchor: 'fresh-replay-needs-all-entries',
    expr: '/window|#\\d/i',
    reason:
      "reads the READER's output (its units, ledger, atoms, diagnostics or error message) for a literal the item planted or the contract names; it picks and edits no generated word",
  },
  {
    file: 'bank/harness-probe.ts',
    anchor: 'readerGainedNothing',
    expr: "/reader's process/",
    reason: 'reads the outcome detail the harness wrote, not prose',
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
    file: 'bank/run.ts',
    anchor: 'MISSING_OBSERVATION',
    expr: '/does not expose|offers no |exports no |records no /',
    reason: 'reads the outcome detail an item wrote (a missing observation), not prose',
  },
  {
    file: 'bank/run.ts',
    anchor: 'named',
    expr: "outcome.detail.includes('Behaviour under test')",
    reason: 'reads the outcome detail an item wrote, not prose',
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
    file: 'sut/blind-binding/replay.ts',
    anchor: 'versionsRequired',
    expr: '/\\bNode \\d[\\w.]*/',
    reason: "reads the READER's own message (the field names and versions it names), not prose",
  },
  {
    file: 'sut/blind-binding/replay.ts',
    anchor: 'versionsRequired',
    expr: '/\\bICU \\d[\\w.]*/',
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

  /** Names of the consts that hold a Set started empty and given a literal word with `add`. */
  const addedTo = new Set<string>();
  const collectAdds = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && memberName(node.expression) === 'add') {
      const callee = node.expression;
      const receiver =
        ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
          ? bare(callee.expression)
          : undefined;
      if (receiver && ts.isIdentifier(receiver) && hasLiteralLetter(node.arguments[0]))
        addedTo.add(receiver.text);
    }
    ts.forEachChild(node, collectAdds);
  };

  /** Whether an expression is (or is bound to) a Set built from a word list or given literal words. */
  const isWordSet = (node: ts.Node | undefined): boolean => {
    const raw = node ? bare(node) : undefined;
    if (raw && ts.isIdentifier(raw) && addedTo.has(raw.text)) return true;
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
      text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 240),
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
    const wrong = ALLOWED.flatMap((a) => {
      const n = findings.filter((f) => allowedBy(f).includes(a)).length;
      return n === (a.count ?? 1)
        ? []
        : [`${a.file} ${a.anchor}: ${a.expr} matches ${n}, expected ${a.count ?? 1}`];
    });
    expect(wrong).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}
