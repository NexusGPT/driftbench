import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomBuilder, ClaudeCodeReader, codeAtoms, proseCandidates } from '../src/index.ts';
function random(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % below;
  };
}

const pieces = [
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '(?<=',
  '[a-',
  '\\',
  '\\\\',
  '\\b',
  '.*',
  '+?',
  '^',
  '$',
  '|',
  '*',
  '?',
  '/',
  '"',
  "'",
  '“',
  '”',
  '‘',
  '’',
  '`',
  '``',
  '```',
  '~~~',
  '<!--',
  '-->',
  '<',
  '>',
  '&nbsp;',
  '&#0;',
  '%s',
  '${x}',
  '😀',
  '👩‍👩‍👧',
  '東京',
  '日本語の文',
  'مرحبا بالعالم',
  'שלום',
  'Привет',
  'नमस्ते',
  'ñandú',
  'é',
  '‏',
  '\u0000',
  '\ud800',
  '`x+y`',
  '`a|b`',
  '[link](http://x)',
  '**bold**',
  '_it_',
  '1.',
  '- ',
  '> ',
  '#',
  '| a | b |',
];
const stems = [
  'Every entry {} must retain its source.',
  'Never {} publish credentials.',
  'Always {} verify the receipt.',
  'Do not {} overwrite the agreement.',
  'Before {} publishing, verify the result.',
  'Only when {} approved, publish the result.',
  'Every run {} is logged.',
  'At most {} two questions per reply.',
  'Each helper {} records its findings.',
  'The note {} says: {} never do this.',
  'Note: {} {} {}',
];

/** Pieces that open or close Markdown block state (fences, comments): left out where a rule must survive. */
const blockState = /^(?:<!--|-->|```|~~~)$/;

function fuzzLines(count: number, allowed: readonly string[], seed: number): string[] {
  const next = random(seed);
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    const sentence = (stems[next(stems.length)] as string).replace(/\{\}/g, () => {
      let payload = '';
      for (let times = next(9); times >= 0; times--) payload += allowed[next(allowed.length)];
      return payload;
    });
    // Mix hard breaks, soft wraps, list items, quotes and blank lines.
    const shape = next(6);
    lines.push(
      shape === 0
        ? `- ${sentence}`
        : shape === 1
          ? `> ${sentence}`
          : shape === 2
            ? `${sentence}\r`
            : sentence,
    );
    if (next(3) === 0) lines.push('');
  }
  return lines;
}

const sentinels = [
  'The assistant must validate the manifest.',
  'Never disclose private credentials.',
  'Every command’s failure (exit code + stderr) reaches you.',
  'Every run (exit 1) is logged.',
];


const hostile = fuzzLines(9000, pieces, 977).join('\n');
const root = await mkdtemp(join(tmpdir(), 'h-'));
await writeFile(join(root, 'CLAUDE.md'), hostile);
const raw = await new ClaudeCodeReader().read(root);
const b = new AtomBuilder(new Map(raw.files.map((f) => [f.path, f])));
codeAtoms(raw, b);
const c0 = process.cpuUsage();
const atoms = proseCandidates(raw, b);
console.log('candidates cpu', Math.round((process.cpuUsage(c0).user + process.cpuUsage(c0).system) / 1000), 'atoms', atoms.length, 'notes', raw.notes.length);
