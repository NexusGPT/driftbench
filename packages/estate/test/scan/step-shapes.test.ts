import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

async function steps(path: string, text: string) {
  const root = await estate({ 'CLAUDE.md': '# Rules\n', [path]: text });
  const raw = await new ClaudeCodeReader().read(root);
  return {
    kind: raw.files.find((file) => file.path === path)?.kind,
    steps: raw.steps.map((step) => [step.id, step.next, step.at.startLine] as const),
    notes: raw.notes,
  };
}

describe('step list shapes', () => {
  it('reads processes given as an array of named processes', async () => {
    const read = await steps(
      '.claude/processes.json',
      [
        '{',
        '  "processes": [',
        '    { "name": "intake", "steps": [',
        '      { "id": "ask", "next": ["file"] },',
        '      { "id": "file", "next": [] }',
        '    ] },',
        '    { "name": "review", "steps": [',
        '      { "id": "ask", "next": [] }',
        '    ] }',
        '  ]',
        '}',
      ].join('\n'),
    );
    expect(read.kind).toBe('step_list');
    expect(read.steps).toEqual([
      ['intake/ask', ['intake/file'], 4],
      ['intake/file', [], 5],
      ['review/ask', [], 8],
    ]);
  });

  it('reads steps keyed by their id, on the line of the key', async () => {
    const read = await steps(
      '.claude/steps.json',
      ['{', '  "steps": {', '    "plan": { "next": ["do"] },', '    "do": { "next": [] }', '  }', '}'].join(
        '\n',
      ),
    );
    expect(read.kind).toBe('step_list');
    expect(read.steps).toEqual([
      ['plan', ['do'], 3],
      ['do', [], 4],
    ]);
  });

  it.each([
    ['a string', '"next": "do"'],
    ['a then list', '"then": ["do"]'],
    ['a then string', '"then": "do"'],
  ])('reads a successor given as %s', async (_name, successor) => {
    const read = await steps(
      '.claude/steps.json',
      `{\n  "steps": [\n    { "id": "plan", ${successor} },\n    { "id": "do" }\n  ]\n}\n`,
    );
    expect(read.steps).toEqual([
      ['plan', ['do'], 3],
      ['do', [], 4],
    ]);
  });

  it('finds a step list nested under one other key', async () => {
    const read = await steps(
      '.claude/workflow.json',
      '{\n  "workflow": {\n    "steps": [\n      { "id": "plan", "next": ["do"] },\n      { "id": "do", "next": [] }\n    ]\n  }\n}\n',
    );
    expect(read.kind).toBe('step_list');
    expect(read.steps).toEqual([
      ['plan', ['do'], 4],
      ['do', [], 5],
    ]);
  });

  it('reads JSON with comments, in a .jsonc file', async () => {
    const read = await steps(
      '.claude/steps.jsonc',
      '// The step list. A "steps" word in a comment is no step.\n{\n  /* block */\n  "steps": [\n    { "id": "plan", "next": ["do"] }, // first\n    { "id": "do", "next": [] }\n  ]\n}\n',
    );
    expect(read.kind).toBe('step_list');
    expect(read.steps).toEqual([
      ['plan', ['do'], 5],
      ['do', [], 6],
    ]);
  });

  it('reads JSON with trailing commas and keeps comment marks inside strings', async () => {
    const read = await steps(
      '.claude/steps.json',
      '{\n  "steps": [\n    { "id": "a//b", "next": ["do, }"] },\n    { "id": "do, }", "next": [] },\n  ],\n}\n',
    );
    expect(read.kind).toBe('step_list');
    expect(read.steps).toEqual([
      ['a//b', ['do, }'], 3],
      ['do, }', [], 4],
    ]);
  });

  it('orders a top-level list that declares no successor, and leaves a declared one alone', async () => {
    const root = await estate({
      'CLAUDE.md': '# Rules\n',
      '.claude/steps.json': '{\n  "steps": [\n    "gather",\n    "bake",\n    "pack"\n  ]\n}\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const name = new Map(map.atoms.map((atom) => [atom.id, String(atom.fields?.id)]));
    const next = map.edges
      .filter((edge) => edge.kind === 'next')
      .map((edge) => `${name.get(edge.from)}>${name.get(edge.to)}`);
    expect(next.sort()).toEqual(['bake>pack', 'gather>bake']);

    const declared = await steps(
      '.claude/steps.json',
      '{\n  "steps": [\n    { "id": "a", "next": ["c"] },\n    { "id": "b" },\n    { "id": "c" }\n  ]\n}\n',
    );
    expect(declared.steps.map((step) => step[1])).toEqual([['c'], [], []]);
  });

  it('reads no step list from data that only looks like one', async () => {
    const read = await steps('.claude/notes.json', '{ "steps": "three", "workflow": { "steps": 4 } }');
    expect(read.kind).toBe('other');
    expect(read.steps).toEqual([]);
  });
});
