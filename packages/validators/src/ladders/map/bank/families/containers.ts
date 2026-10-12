import type { Draw } from '../../spec';
import { BANK_COMPONENTS, drawFor, inventoryCode, inventorySource, miniInventory } from '../common';
import type { PlantedValue } from '../perfect';
import { mapItem } from '../run';
import { type BankItem, levelOf, type Tier } from '../types';

/**
 * Family prompt-containers: the same prompt stored in the files agents keep their prompts in (JSON chat
 * messages, YAML keys, TypeScript and Python constants, HTML, XML, TOML, CSV, templates). The perfect model
 * quotes what a rule says, decoded, as a reader of the prompt sees it; the pipeline must find that text in
 * the file, so a container whose escapes it does not decode loses the rules that carry an escaped character.
 */

const RULES: ReadonlyArray<{ text: string; trigger: string }> = [
  { text: 'Always say "thank you" before you close the conversation.', trigger: 'double-quote' },
  { text: "Use the customer's own words when you repeat the problem.", trigger: 'apostrophe' },
  { text: 'Use the customer’s own words when you name the issue.', trigger: 'typographic' },
  { text: 'Never round a price and quote "9.99 a month" exactly.', trigger: 'double-quote' },
  { text: 'Write amounts as 1,000 & more without a currency sign.', trigger: 'ampersand' },
  { text: 'Treat a reply such as <yes> as no answer.', trigger: 'angle' },
  { text: 'Never promise a refund before the café desk agrees.', trigger: 'accent' },
  { text: 'Save every note under C:\\desk\\notes before you answer.', trigger: 'backslash' },
  { text: 'Repeat the address back in full,\nthen wait for an explicit yes.', trigger: 'newline' },
  { text: 'Keep each answer under four sentences.', trigger: 'plain' },
  { text: 'Mark urgent cases with *urgent* in the case note.', trigger: 'asterisk' },
  { text: 'Ask for the account reference before you change anything.', trigger: 'plain' },
];

/** The interpolated rule of the template containers: the logical text and the constant behind it. */
const INTERPOLATED = {
  logical: 'Never offer more than 3 visit slots at once.',
  name: 'MAX_SLOTS',
  value: '3',
};

type Container = {
  slug: string;
  tier: Tier;
  title: string;
  path: string;
  /** The triggers this container's item must carry, so its escapes are exercised. */
  needs: string[];
  /** Whether the prompt holds the interpolated rule. */
  interpolated?: boolean;
  /** Whether one rule is split across two string literals. */
  splitLiteral?: boolean;
  write(lines: string[], split: { rule: string; cut: number } | undefined): string;
};

const json = (text: string) => JSON.stringify(text);
const ascii = (text: string) =>
  JSON.stringify(text).replace(
    /[\u007F-\uFFFF]/g,
    (char) => `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`,
  );
const indent = (text: string, pad: string) =>
  text
    .split('\n')
    .map((line) => (line === '' ? '' : `${pad}${line}`))
    .join('\n');
const html = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/’/g, '&#8217;');
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const withConstant = (text: string, open: string, close: string) =>
  text.replace(
    INTERPOLATED.logical,
    INTERPOLATED.logical.replace(INTERPOLATED.value, `${open}${INTERPOLATED.name}${close}`),
  );

export const CONTAINERS: readonly Container[] = [
  {
    slug: 'markdown',
    tier: 1,
    title: 'a markdown file',
    path: 'prompt.md',
    needs: ['double-quote', 'typographic', 'newline'],
    write: (lines) => lines.join('\n'),
  },
  {
    slug: 'text',
    tier: 1,
    title: 'a plain text file',
    path: 'prompt.txt',
    needs: ['apostrophe', 'backslash'],
    write: (lines) => lines.join('\n'),
  },
  {
    slug: 'json-messages',
    tier: 2,
    title: 'a JSON chat file: the prompt is the content of the system message',
    path: 'prompt.json',
    needs: ['double-quote', 'newline'],
    write: (lines) =>
      `${JSON.stringify({ messages: [{ role: 'system', content: lines.join('\n') }] }, null, 2)}\n`,
  },
  {
    slug: 'json-ascii',
    tier: 2,
    title: 'JSON written with every non-ASCII character as a \\u escape',
    path: 'prompt.json',
    needs: ['accent', 'typographic'],
    write: (lines) => `{\n  "system": ${ascii(lines.join('\n'))}\n}\n`,
  },
  {
    slug: 'json-prompt-key',
    tier: 2,
    title: 'an agent export with the prompt under one JSON key',
    path: 'agent.json',
    needs: ['backslash', 'double-quote'],
    write: (lines) =>
      `${JSON.stringify({ name: 'desk', model: 'any', prompt: lines.join('\n') }, null, 2)}\n`,
  },
  {
    slug: 'jsonl',
    tier: 3,
    title: 'JSON lines, one system message per line of the prompt',
    path: 'prompt.jsonl',
    needs: ['double-quote'],
    write: (lines) =>
      `${lines
        .filter((line) => line !== '')
        .map((line) => JSON.stringify({ role: 'system', content: line }))
        .join('\n')}\n`,
  },
  {
    slug: 'yaml-literal',
    tier: 1,
    title: 'a YAML block literal',
    path: 'prompt.yaml',
    needs: ['double-quote', 'apostrophe', 'newline'],
    write: (lines) => `system: |\n${indent(lines.join('\n'), '  ')}\n`,
  },
  {
    slug: 'yaml-folded',
    tier: 2,
    title: 'a YAML folded block',
    path: 'prompt.yaml',
    needs: ['double-quote', 'apostrophe'],
    write: (lines) => `system: >\n${indent(lines.join('\n\n'), '  ')}\n`,
  },
  {
    slug: 'yaml-double',
    tier: 2,
    title: 'a YAML double-quoted string with escapes',
    path: 'prompt.yaml',
    needs: ['double-quote', 'newline'],
    write: (lines) => `system: ${json(lines.join('\n'))}\n`,
  },
  {
    slug: 'yaml-single',
    tier: 2,
    title: "a YAML single-quoted string, '' for an apostrophe",
    path: 'prompt.yaml',
    needs: ['apostrophe'],
    write: (lines) =>
      `system: '${lines
        .filter((line) => line !== '')
        .join(' ')
        .replace(/'/g, "''")}'\n`,
  },
  {
    slug: 'ts-template',
    tier: 3,
    title: 'a TypeScript template literal with a constant interpolated',
    path: 'prompt.ts',
    needs: ['plain'],
    interpolated: true,
    write: (lines) =>
      `export const ${INTERPOLATED.name} = ${INTERPOLATED.value};\n\nexport const PROMPT = \`${withConstant(lines.join('\n').replace(/\\/g, '\\\\').replace(/`/g, '\\`'), '${', '}')}\`;\n`,
  },
  {
    slug: 'ts-single',
    tier: 2,
    title: 'a TypeScript single-quoted string with \\n escapes',
    path: 'prompt.ts',
    needs: ['apostrophe'],
    write: (lines) =>
      `export const PROMPT = '${lines.join('\n').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}';\n`,
  },
  {
    slug: 'ts-concat',
    tier: 3,
    title: 'TypeScript string literals joined with +, one rule cut across two literals',
    path: 'prompt.ts',
    needs: ['plain'],
    splitLiteral: true,
    write: (lines, split) => {
      const parts: string[] = [];
      for (const line of lines) {
        if (split && line.includes(split.rule)) {
          const at = line.indexOf(split.rule) + split.cut;
          parts.push(line.slice(0, at), `${line.slice(at)}\n`);
        } else parts.push(`${line}\n`);
      }
      return `export const PROMPT =\n${parts.map((part) => `  ${JSON.stringify(part)}`).join(' +\n')};\n`;
    },
  },
  {
    slug: 'python-triple',
    tier: 1,
    title: 'a Python triple-quoted string',
    path: 'prompt.py',
    needs: ['double-quote', 'apostrophe'],
    write: (lines) => `PROMPT = """\n${lines.join('\n').replace(/\\/g, '\\\\')}\n"""\n`,
  },
  {
    slug: 'python-concat',
    tier: 3,
    title: 'Python implicit concatenation, one rule cut across two literals',
    path: 'prompt.py',
    needs: ['plain'],
    splitLiteral: true,
    write: (lines, split) => {
      const parts: string[] = [];
      for (const line of lines) {
        if (split && line.includes(split.rule)) {
          const at = line.indexOf(split.rule) + split.cut;
          parts.push(line.slice(0, at), `${line.slice(at)}\n`);
        } else parts.push(`${line}\n`);
      }
      return `PROMPT = (\n${parts.map((part) => `    ${JSON.stringify(part)}`).join('\n')}\n)\n`;
    },
  },
  {
    slug: 'python-fstring',
    tier: 3,
    title: 'a Python f-string with a constant interpolated',
    path: 'prompt.py',
    needs: ['plain'],
    interpolated: true,
    write: (lines) =>
      `${INTERPOLATED.name} = ${INTERPOLATED.value}\n\nPROMPT = f"""\n${withConstant(lines.join('\n').replace(/\\/g, '\\\\').replace(/\{/g, '{{').replace(/\}/g, '}}'), '{', '}')}\n"""\n`,
  },
  {
    slug: 'html-entities',
    tier: 3,
    title: 'HTML with character entities',
    path: 'prompt.html',
    needs: ['ampersand', 'apostrophe', 'typographic'],
    write: (lines) =>
      `<!doctype html>\n<html><body>\n${lines.map((line) => `<p>${html(line)}</p>`).join('\n')}\n</body></html>\n`,
  },
  {
    slug: 'html-inline-tags',
    tier: 3,
    title: 'HTML with a word of a rule in bold',
    path: 'prompt.html',
    needs: ['plain'],
    write: (lines) =>
      `<!doctype html>\n<html><body>\n${lines.map((line) => `<p>${line.replace(/^- (Keep|Ask|Never|Always|Use|Write|Repeat|Save|Treat) (\w+)/, '- $1 <b>$2</b>')}</p>`).join('\n')}\n</body></html>\n`,
  },
  {
    slug: 'xml-escaped',
    tier: 3,
    title: 'XML text with &amp; and &lt; escapes',
    path: 'prompt.xml',
    needs: ['ampersand', 'angle'],
    write: (lines) => `<?xml version="1.0"?>\n<prompt>\n${xml(lines.join('\n'))}\n</prompt>\n`,
  },
  {
    slug: 'xml-cdata',
    tier: 2,
    title: 'XML with the prompt in a CDATA section',
    path: 'prompt.xml',
    needs: ['ampersand', 'angle'],
    write: (lines) => `<?xml version="1.0"?>\n<prompt><![CDATA[\n${lines.join('\n')}\n]]></prompt>\n`,
  },
  {
    slug: 'toml-basic',
    tier: 3,
    title: 'a TOML basic string with escapes',
    path: 'agent.toml',
    needs: ['double-quote', 'backslash'],
    write: (lines) => `name = "desk"\nprompt = ${json(lines.join('\n'))}\n`,
  },
  {
    slug: 'toml-literal',
    tier: 2,
    title: "a TOML multi-line literal string '''",
    path: 'agent.toml',
    needs: ['double-quote', 'backslash'],
    write: (lines) => `name = "desk"\nprompt = '''\n${lines.join('\n')}\n'''\n`,
  },
  {
    slug: 'csv',
    tier: 3,
    title: 'a CSV of rules, quotes doubled inside quoted cells',
    path: 'rules.csv',
    needs: ['double-quote'],
    write: (lines) =>
      `id,text\n${lines
        .filter((line) => line.startsWith('- '))
        .map((line, index) => `R${index + 1},"${line.slice(2).replace(/"/g, '""')}"`)
        .join('\n')}\n`,
  },
  {
    slug: 'jinja',
    tier: 2,
    title: 'a Jinja template: the rules sit between template tags',
    path: 'prompt.j2',
    needs: ['double-quote'],
    write: (lines) =>
      `{% if channel %}Channel: {{ channel }}{% endif %}\n${lines.join('\n')}\n{# the end of the template #}\n`,
  },
  {
    slug: 'go-interpreted',
    tier: 2,
    title: 'a Go interpreted string literal with escapes',
    path: 'prompt.go',
    needs: ['double-quote', 'newline'],
    write: (lines) => `package agent\n\nconst Prompt = ${json(lines.join('\n'))}\n`,
  },
  {
    slug: 'go-raw',
    tier: 1,
    title: 'a Go raw string literal in backquotes',
    path: 'prompt.go',
    needs: ['double-quote', 'backslash'],
    write: (lines) => `package agent\n\nconst Prompt = \`${lines.join('\n')}\`\n`,
  },
  {
    slug: 'csharp-verbatim',
    tier: 3,
    title: 'a C# verbatim string, "" for a quote',
    path: 'Prompt.cs',
    needs: ['double-quote'],
    write: (lines) =>
      `static class Agent {\n  public const string Prompt = @"${lines.join('\n').replace(/"/g, '""')}";\n}\n`,
  },
  {
    slug: 'java-text-block',
    tier: 2,
    title: 'a Java text block',
    path: 'Prompt.java',
    needs: ['double-quote', 'apostrophe'],
    write: (lines) =>
      `class Prompt {\n  static final String TEXT = """\n${lines.join('\n').replace(/\\/g, '\\\\')}\n""";\n}\n`,
  },
  {
    slug: 'rust-raw',
    tier: 2,
    title: 'a Rust raw string r#"..."#',
    path: 'prompt.rs',
    needs: ['double-quote', 'backslash'],
    write: (lines) => `pub const PROMPT: &str = r#"${lines.join('\n')}"#;\n`,
  },
  {
    slug: 'php-single',
    tier: 2,
    title: "a PHP single-quoted string with \\' escapes",
    path: 'prompt.php',
    needs: ['apostrophe'],
    write: (lines) => `<?php\n$prompt = '${lines.join('\n').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';\n`,
  },
  {
    slug: 'env-file',
    tier: 3,
    title: 'an environment file: one double-quoted value with \\n escapes',
    path: '.env',
    needs: ['double-quote', 'newline'],
    write: (lines) => `MODEL=any\nSYSTEM_PROMPT=${json(lines.join('\n'))}\n`,
  },
  {
    slug: 'properties',
    tier: 3,
    title: 'a Java properties file with \\n escapes and line continuations',
    path: 'agent.properties',
    needs: ['backslash', 'newline'],
    write: (lines) =>
      `prompt=${lines.map((line) => line.replace(/\\/g, '\\\\').replace(/\n/g, '\\n\\\n    ')).join('\\n\\\n    ')}\n`,
  },
  {
    slug: 'json5',
    tier: 3,
    title: 'JSON5 with single-quoted strings and comments',
    path: 'agent.json5',
    needs: ['apostrophe'],
    write: (lines) =>
      `{\n  // the agent's prompt\n  prompt: '${lines.join('\n').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}',\n}\n`,
  },
  {
    slug: 'front-matter',
    tier: 1,
    title: 'markdown with YAML front matter',
    path: 'prompt.md',
    needs: ['double-quote', 'apostrophe'],
    write: (lines) => `---\nname: desk\nmodel: any\n---\n${lines.join('\n')}\n`,
  },
  {
    slug: 'xml-attribute',
    tier: 3,
    title: 'the prompt in an XML attribute, with &quot; and &#10; escapes',
    path: 'agent.xml',
    needs: ['double-quote', 'newline'],
    write: (lines) =>
      `<?xml version="1.0"?>\n<agent name="desk" prompt="${lines.join('\n').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\n/g, '&#10;')}"/>\n`,
  },
  {
    slug: 'html-line-breaks',
    tier: 3,
    title: 'HTML whose line breaks inside a rule are <br> tags',
    path: 'prompt.html',
    needs: ['newline'],
    write: (lines) =>
      `<!doctype html>\n<html><body>\n${lines.map((line) => `<p>${line.replace(/\n/g, '<br>')}</p>`).join('\n')}\n</body></html>\n`,
  },
  {
    slug: 'sql-string',
    tier: 3,
    title: "an SQL insert with the prompt in a string literal, '' for an apostrophe",
    path: 'seed.sql',
    needs: ['apostrophe'],
    write: (lines) =>
      `INSERT INTO prompts (name, body) VALUES ('desk', '${lines.join('\n').replace(/'/g, "''")}');\n`,
  },
  {
    slug: 'swift-interpolation',
    tier: 3,
    title: 'a Swift multi-line string with a constant interpolated as \\(name)',
    path: 'Prompt.swift',
    needs: ['plain'],
    interpolated: true,
    write: (lines) =>
      `let ${INTERPOLATED.name} = ${INTERPOLATED.value}\nlet prompt = """\n${withConstant(lines.join('\n').replace(/\\/g, '\\\\'), '\\(', ')')}\n"""\n`,
  },
  {
    slug: 'content-parts',
    tier: 4,
    title: 'a chat message whose content is a list of text parts, one rule cut across two parts',
    path: 'prompt.json',
    needs: ['plain'],
    splitLiteral: true,
    write: (lines, split) => {
      const text = lines.join('\n');
      const at = split ? text.indexOf(split.rule) + split.cut : text.length;
      return `${JSON.stringify(
        {
          messages: [
            {
              role: 'system',
              content: [
                { type: 'text', text: text.slice(0, at) },
                { type: 'text', text: text.slice(at) },
              ],
            },
          ],
        },
        null,
        2,
      )}\n`;
    },
  },
  {
    slug: 'restructured-text',
    tier: 3,
    title: 'reStructuredText with inline markup characters escaped by a backslash',
    path: 'prompt.rst',
    needs: ['asterisk'],
    write: (lines) =>
      `Assistant guide\n===============\n\n${lines.slice(1).join('\n').replace(/\*/g, '\\*')}\n`,
  },

  {
    slug: 'latex',
    tier: 3,
    title: 'a LaTeX file with a word of each rule in \\textbf{}',
    path: 'prompt.tex',
    needs: ['plain'],
    write: (lines) =>
      `\\section*{Assistant guide}\n${lines
        .slice(1)
        .map((line) => line.replace(/^- (\w+) (\w+)/, '- $1 \\textbf{$2}'))
        .join('\n')}\n`,
  },
  {
    slug: 'docx-runs',
    tier: 4,
    title: 'the XML of a Word document, each rule split into two runs <w:r><w:t>',
    path: 'document.xml',
    needs: ['plain'],
    write: (lines) =>
      `<w:document><w:body>\n${lines
        .filter((line) => line !== '')
        .map((line) => {
          const at = Math.floor(line.length / 2);
          const run = (text: string) => `<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
          return `<w:p>${run(line.slice(0, at))}${run(line.slice(at))}</w:p>`;
        })
        .join('\n')}\n</w:body></w:document>\n`,
  },
];
/** Draws the rules of an item: the container's triggers first, then plain ones, four or five in all. */
function rulesFor(draw: Draw, container: Container): string[] {
  const chosen: string[] = [];
  for (const need of container.needs) {
    const options = RULES.filter((rule) => rule.trigger === need && !chosen.includes(rule.text));
    if (options.length > 0) chosen.push(draw.pick(options).text);
  }
  const rest = draw.shuffle(RULES.filter((rule) => !chosen.includes(rule.text) && rule.trigger === 'plain'));
  while (chosen.length < 4 && rest.length > 0) chosen.push(rest.shift()?.text as string);
  if (container.interpolated) chosen.push(INTERPOLATED.logical);
  return draw.shuffle(chosen);
}

/** The first words of a rule: plain ASCII text visible in every container. */
function prefixOf(rule: string): string {
  return (/^[A-Za-z ]+/.exec(rule)?.[0] ?? rule).trim().split(' ').slice(0, 4).join(' ');
}

/** Containers one decoder fixes together. */
const CONTAINER_CAUSE: Record<string, string> = {
  'json-messages': 'quote:read-json-prompt-files',
  'json-ascii': 'quote:read-json-prompt-files',
  'json-prompt-key': 'quote:read-json-prompt-files',
  jsonl: 'quote:read-json-prompt-files',
  'yaml-double': 'quote:decode-yaml-scalars',
  'yaml-single': 'quote:decode-yaml-scalars',
  'ts-template': 'quote:resolve-interpolated-constants',
  'python-fstring': 'quote:resolve-interpolated-constants',
  'ts-single': 'quote:decode-single-quoted-code-strings',
  'php-single': 'quote:decode-single-quoted-code-strings',
  json5: 'quote:decode-single-quoted-code-strings',
  'ts-concat': 'quote:join-concatenated-literals',
  'python-concat': 'quote:join-concatenated-literals',
};

export function containerItems(): BankItem[] {
  return CONTAINERS.map((container) =>
    mapItem({
      id: `prompt-containers.${container.slug}`,
      family: 'prompt-containers',
      tier: container.tier,
      level: levelOf('containers'),
      component: BANK_COMPONENTS.quote,
      title: container.title,
      cause: CONTAINER_CAUSE[container.slug] ?? `quote:${container.slug}`,
      build: (seed) => {
        const draw = drawFor(seed, `prompt-containers.${container.slug}`);
        const rules = rulesFor(draw, container);
        const lines = ['# Assistant guide', '', 'Rules:', '', ...rules.map((rule) => `- ${rule}`)];
        const longest = rules.reduce((a, b) => (b.length > a.length ? b : a));
        const split = container.splitLiteral
          ? { rule: longest, cut: Math.floor(longest.length / 2) }
          : undefined;
        const text = container.write(lines, split);
        // The anchor is what the request must show: the rule's first words, or its first word when markup cuts them.
        const anchorOf = (rule: string) =>
          text.includes(prefixOf(rule)) ? prefixOf(rule) : (rule.split(' ')[0] as string);
        const planted: PlantedValue[] = rules.map((rule, index) => ({
          type: 'value',
          section: 'rules',
          source: container.path,
          quote: rule,
          anchor: anchorOf(rule),
          dimension: { id: 'rule', title: 'The rules the assistant follows', kind: 'behaviour' },
          value: { id: `R-${String(index + 1).padStart(2, '0')}`, title: rule },
        }));
        const inventory = miniInventory(draw);
        return {
          case: {
            label: container.slug,
            sources: [inventorySource(inventory), { kind: 'prompt', path: container.path, text }],
            planted,
          },
          code: inventoryCode(inventory),
          parts: { values: true, produced: true, constraints: true, relations: true },
        };
      },
    }),
  );
}
