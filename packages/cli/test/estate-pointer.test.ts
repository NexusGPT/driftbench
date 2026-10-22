import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pointer } from '@agent-nexus/driftbench-estate';
import type { FetchLike } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { estateScanCommand } from '../src/commands/estate';
import { type Io, main } from '../src/index';

// An invented harbour office. No line below comes from a real estate.
const FILES: Record<string, string> = {
  'CLAUDE.md':
    '# Harbour office\n\n- Hang the lamp before dusk\n- Never leave the gate open\n- Close the gate at night\n',
  '.claude/skills/moorings/SKILL.md':
    '---\nname: moorings\ndescription: Tie up a boat at the right quay.\n---\n\n# Moorings\n\nCheck the tide table. Tie the bow line first.\n',
};

async function estate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-pointer-cli-'));
  for (const [path, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

function capture(cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  return { io, output };
}

async function run(argv: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const { io, output } = capture(cwd);
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return { code: await main(argv, io), ...output };
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

/** The text of the units in a request: the `[n] text` lines of its numbered window. */
function unitsOf(text: string): Array<[number, string]> {
  return [...text.matchAll(/^\[(\d+)\] (.*)$/gm)].map((match) => [Number(match[1]), match[2] ?? '']);
}

/**
 * The two services, as one fetch. System 1 is offered only the labels it can answer (reference, example,
 * description and none, not the labels that carry spans), so its service is sure of none for a line and torn on
 * "Close" (none 0.4, description 0.35, the rest shared): the stack leaves such a line to system 2. The system 2
 * service calls a line with "Never" a prohibition and any other imperative a rule. Both services answer none to
 * the document-roles question, so no file takes a recorded role and its structure decides.
 */
const imperative = /^(Hang|Never|Tie|Check|Close)/;
const services: FetchLike = async (url, init) => {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('systemone')) {
    const text = String((body.state as { text: string }).text);
    const lines = new Map(unitsOf(text));
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(
      body.questions as Record<string, { criteria: Record<string, string> }>,
    )) {
      const line = lines.get(Number(key.slice(1))) ?? '';
      const close = line.startsWith('Close');
      const options = Object.keys(question.criteria);
      // A vector: the probabilities of the options sum to 1.
      const fixed: Record<string, number> = close ? { none: 0.4, description: 0.35 } : { none: 0.9 };
      const shared = options.filter((option) => !(option in fixed));
      const left = 1 - options.reduce((sum, option) => sum + (fixed[option] ?? 0), 0);
      const probabilities: Record<string, number> = {};
      for (const option of options) probabilities[option] = fixed[option] ?? left / shared.length;
      answers[key] = { type: 'choice', choice: 'none', confidence: 0.9, probabilities };
    }
    return json({ model: 'jev-fake', answers, usage: { input_tokens: 1000, output_tokens: 10 } });
  }
  const content = (body.messages as Array<{ content: string }>)[0]?.content ?? '';
  const roles = content.includes('SET document-roles');
  const labels = unitsOf(content).map(([n, line]) => ({
    units: String(n),
    label: roles || !imperative.test(line) ? 'none' : /^Never/.test(line) ? 'prohibition' : 'rule',
  }));
  return json({
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ labels }) }],
    usage: { input_tokens: 500, output_tokens: 50 },
  });
};

const KEYS = { JEV_API_KEY: 'jev-secret', JEV_ROUTE: 'typesafe', ANTHROPIC_API_KEY: 'anthropic-secret' };

/** Records the cassette of the default stack through the command, with the fake services. */
async function record(root: string, over: string[] = [], extra: { prices?: string } = {}) {
  const { io, output } = capture(root);
  const code = await estateScanCommand(
    '.',
    {
      out: 'recorded.yaml',
      pointer: true,
      cassette: 'cassette.jsonl',
      record: true,
      ledger: 'ledger.json',
      update: true,
      jobs: '3',
      ...(over.length ? { labeler: over } : {}),
      ...extra,
    },
    io,
    { env: KEYS, fetch: services },
  );
  return { code, ...output };
}

describe('driftbench estate scan --pointer', () => {
  it('records the default stack with the two services, then replays it with no key', async () => {
    const root = await estate();
    const recorded = await record(root);
    expect(recorded.err).toBe('');
    expect(recorded.code).toBe(0);
    // The plan comes before the first request, then the counts, the classes that decided and the tokens.
    expect(recorded.out).toMatch(/Pointer plan: 9 units in 2 files, 0 already labelled by the ledger\./);
    expect(recorded.out).toMatch(
      /system 1 jev jev-latest: 3 requests, 0 in the cassette, \d+ characters to send\./,
    );
    expect(recorded.out).toMatch(/system 2 anthropic claude-haiku-5-5: 15 requests, 0 in the cassette/);
    expect(recorded.out).toContain(
      'Pointer reader: system 1 jev jev-latest then system 2 anthropic claude-haiku-5-5',
    );
    expect(recorded.out).toMatch(
      /Units: 9 in 2 files; 0 kept from the ledger, 9 labelled by this run \(\d+ by system 1, \d+ by system 2\)/,
    );
    expect(recorded.out).toContain('Tokens, system 1 jev jev-latest: 3000 in, 30 out, 3 requests sent.');
    expect(recorded.out).toContain(
      'Tokens, system 2 anthropic claude-haiku-5-5: 7500 in, 750 out, 15 requests sent.',
    );
    const cassette = pointer.Cassette.parse(await readFile(join(root, 'cassette.jsonl'), 'utf8'));
    // Three windows for system 1, and five runs of each for system 2. Both files are loaded by the runtime as
    // instructions (the standing file and a skill body), so the document-roles question is never asked of them.
    expect(cassette.entries.size).toBe(18);
    // The file on disk is the sorted one, whatever the order the answers arrived in.
    expect(await readFile(join(root, 'cassette.jsonl'), 'utf8')).toBe(cassette.render());

    const replay = await run(
      ['estate', 'scan', '.', '--pointer', '--cassette', 'cassette.jsonl', '--out', 'replayed.yaml'],
      root,
      { JEV_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
    );
    expect(replay.err).toBe('');
    expect(replay.code).toBe(0);
    expect(replay.out).toContain('0 sent, 0 recorded.');
    expect(await readFile(join(root, 'replayed.yaml'), 'utf8')).toContain('extraction: pointer');
  });

  it('prints the cost of a recording run in USD per model, and the tokens a replay takes from the cassette', async () => {
    const root = await estate();
    await writeFile(
      join(root, 'prices.yaml'),
      'as_of: 2026-01-01\nmodels:\n  claude-haiku-5-5: { input: 1, output: 4, cached_input: 0.1 }\n',
    );
    const recorded = await record(root, [], { prices: 'prices.yaml' });
    expect(recorded.err).toBe('');
    expect(recorded.out).toContain('Cost, system 2 anthropic claude-haiku-5-5: 0.0105 USD.');
    expect(recorded.out).toContain('Cost in all: 0.0105 USD, without jev-latest.');

    const unpriced = await record(await estate());
    expect(unpriced.out).toContain('No prices given: pass --prices <file> to see the cost in USD.');

    const replay = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--cassette',
        'cassette.jsonl',
        '--prices',
        'prices.yaml',
        '--out',
        'replayed.yaml',
      ],
      root,
      { JEV_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
    );
    expect(replay.err).toBe('');
    expect(replay.out).toContain(
      'Tokens replayed from the cassette, system 2 anthropic claude-haiku-5-5: 7500 in, 750 out, 15 requests.',
    );
    expect(replay.out).toContain(
      'Cost when recorded, system 2 anthropic claude-haiku-5-5: 0.0105 USD.',
    );
    expect(replay.out).not.toContain('requests sent.');
  });

  it('leaves unlabeled, and says so, the units on which no label has three of the five runs of system 2', async () => {
    const root = await estate();
    // The second to fourth asks of a window holding the "Close" unit (system 1 is torn on it) call it a prohibition, a
    // description and a prohibition: five runs, and no label has three of them (rule 2, prohibition 2, description 1).
    const asks = new Map<string, number>();
    const wavering: FetchLike = async (url, init) => {
      const response = await services(url, init);
      if (url.includes('systemone')) return response;
      const content =
        (JSON.parse(String(init.body)).messages as Array<{ content: string }>)[0]?.content ?? '';
      // The document-roles question stays as the service answers it.
      if (content.includes('SET document-roles')) return response;
      const close = unitsOf(content).find(([, line]) => line.startsWith('Close'))?.[0];
      if (close === undefined) return response;
      const seen = (asks.get(content) ?? 0) + 1;
      asks.set(content, seen);
      if (seen < 2 || seen > 4) return response;
      const payload = (await response.json()) as { content: Array<{ text: string }> };
      const text = JSON.parse(payload.content[0]?.text ?? '{}') as {
        labels: Array<{ units: string; label: string }>;
      };
      for (const entry of text.labels)
        if (entry.units === String(close)) entry.label = seen === 3 ? 'description' : 'prohibition';
      payload.content[0] = { type: 'text', text: JSON.stringify(text) } as { text: string };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const { io, output } = capture(root);
    const code = await estateScanCommand(
      '.',
      {
        out: 'split.yaml',
        pointer: true,
        cassette: 'split.jsonl',
        record: true,
        ledger: 'ledger.json',
        update: true,
        jobs: '1',
      },
      io,
      { env: KEYS, fetch: wavering },
    );
    expect(code).toBe(0);
    expect(output.out).toMatch(/the runs of one labeler disagreed on [1-9]\d* units;/);
  });

  it('builds atoms from the labels the classes decided, quoting the file', async () => {
    const root = await estate();
    await record(root);
    const map = await readFile(join(root, 'recorded.yaml'), 'utf8');
    expect(map).toContain('quote: Hang the lamp before dusk');
    expect(map).toContain('quote: Never leave the gate open');
    // "Close" is inside system 1's band, so system 2 decided it.
    expect(map).toContain('quote: Close the gate at night');
    expect(map).toContain('polarity: prohibition');
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8'));
    const close = ledger.entries.find((entry: { quote: string }) => entry.quote.startsWith('Close'));
    expect(close.labels['agent-rules']).toMatchObject({ label: 'rule', by: 'system2' });
    // Rule and prohibition carry spans, so only system 2 can give them: it decided "Never" as well.
    const never = ledger.entries.find((entry: { quote: string }) => entry.quote.startsWith('Never'));
    expect(never.labels['agent-rules']).toMatchObject({ label: 'prohibition', by: 'system2' });
    // System 1 decides where it is sure and system 2 gives none.
    const title = ledger.entries.find((entry: { quote: string }) => entry.quote === '# Harbour office');
    expect(title.labels['agent-rules']).toMatchObject({ label: 'none', by: 'system1' });
  });

  it('runs one class alone, and the stack from the same cassette', async () => {
    const root = await estate();
    await record(root);
    const alone = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--cassette',
        'cassette.jsonl',
        '--labeler',
        'system2:anthropic',
        '--out',
        'two.yaml',
      ],
      root,
    );
    expect(alone.code).toBe(0);
    expect(alone.out).toContain('Pointer reader: system 2 anthropic claude-haiku-5-5.');
    expect(alone.out).toMatch(/0 by system 1, \d+ by system 2/);
  });

  it('keeps every label of the ledger on a rescan and asks for none', async () => {
    const root = await estate();
    await record(root);
    const again = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--cassette',
        'cassette.jsonl',
        '--ledger',
        'ledger.json',
        '--out',
        'again.yaml',
        '--force',
      ],
      root,
    );
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/Units: 9 in 2 files; 9 kept from the ledger, 0 labelled by this run/);
    expect(again.out).toContain('Requests: 0 answered, 0 sent, 0 recorded.');
  });

  it('re-labels the units when the bounds change, from the same cassette', async () => {
    const root = await estate();
    await record(root);
    const wide = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--cassette',
        'cassette.jsonl',
        '--ledger',
        'ledger.json',
        '--labeler-pass-at',
        '1',
        '--labeler-fail-at',
        '0',
        '--out',
        'wide.yaml',
        '--force',
      ],
      root,
    );
    expect(wide.code).toBe(0);
    expect(wide.out).toMatch(
      /0 kept from the ledger, 9 labelled by this run \(0 by system 1, 9 by system 2\)/,
    );
  });

  it('fails the ledger check when a file changed and the committed ledger did not', async () => {
    const root = await estate();
    await record(root);
    const base = [
      'estate',
      'scan',
      '.',
      '--pointer',
      '--cassette',
      'cassette.jsonl',
      '--ledger',
      'ledger.json',
      '--ledger-check',
      '--force',
    ];
    expect((await run([...base, '--out', 'one.yaml'], root)).code).toBe(0);
    await writeFile(join(root, 'CLAUDE.md'), `${FILES['CLAUDE.md']}\n- Close the harbour office at six\n`);
    const stale = await run([...base, '--out', 'two.yaml'], root);
    expect(stale.code).not.toBe(0);
  });

  it('writes the ledger with --update only, and refuses --update without a ledger', async () => {
    const root = await estate();
    await record(root);
    const written = await readFile(join(root, 'ledger.json'), 'utf8');
    await writeFile(join(root, 'CLAUDE.md'), `${FILES['CLAUDE.md']}\n- Close the harbour office at six\n`);
    const base = ['estate', 'scan', '.', '--pointer', '--cassette', 'cassette.jsonl', '--force'];
    // The cassette misses on the new unit: record it, with the same fake services.
    const { io, output } = capture(root);
    const read = await estateScanCommand(
      '.',
      {
        out: 'read.yaml',
        pointer: true,
        cassette: 'cassette.jsonl',
        record: true,
        ledger: 'ledger.json',
        force: true,
      },
      io,
      { env: KEYS, fetch: services },
    );
    expect(read).toBe(0);
    expect(output.out).toContain('The ledger ledger.json is not written: pass --update to write it.');
    expect(await readFile(join(root, 'ledger.json'), 'utf8')).toBe(written);
    const updated = await run(
      [...base, '--ledger', 'ledger.json', '--update', '--out', 'updated.yaml'],
      root,
    );
    expect(updated.code).toBe(0);
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8'));
    expect(
      ledger.entries.some((entry: { quote: string }) => entry.quote === 'Close the harbour office at six'),
    ).toBe(true);
    const check = await run(
      [...base, '--ledger', 'ledger.json', '--ledger-check', '--out', 'checked.yaml'],
      root,
    );
    expect(check.code).toBe(0);
    const alone = await run([...base, '--update', '--out', 'alone.yaml'], root);
    expect(alone.code).toBe(2);
    expect(alone.err).toContain('--update needs --ledger <file>');
  });

  it('stops on a cassette miss, names the field that differs, and writes no map', async () => {
    const root = await estate();
    await record(root);
    await writeFile(join(root, 'CLAUDE.md'), `${FILES['CLAUDE.md']}\n- Close the harbour office at six\n`);
    const result = await run(
      ['estate', 'scan', '.', '--pointer', '--cassette', 'cassette.jsonl', '--out', 'missed.yaml'],
      root,
    );
    expect(result.code).toBe(2);
    expect(result.err).toMatch(
      /the cassette has no answer for request [0-9a-f]{12}; the nearest entry [0-9a-f]{12} differs in: .*part\./,
    );
    await expect(readFile(join(root, 'missed.yaml'), 'utf8')).rejects.toThrow();
  });

  it('refuses a missing cassette in replay and tells how to record it', async () => {
    const root = await estate();
    const result = await run(
      ['estate', 'scan', '.', '--pointer', '--cassette', 'none.jsonl', '--out', 'map.yaml'],
      root,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('record it with --record');
  });

  it('refuses --record without the keys of the labelers, naming the variables, and never prints one', async () => {
    const root = await estate();
    const args = [
      'estate',
      'scan',
      '.',
      '--pointer',
      '--record',
      '--cassette',
      'cassette.jsonl',
      '--out',
      'map.yaml',
    ];
    const none = await run(args, root, {
      JEV_API_KEY: undefined,
      JEV_ROUTE: undefined,
      JEV_URL: undefined,
      ANTHROPIC_API_KEY: undefined,
    });
    expect(none.code).toBe(2);
    expect(none.err).toContain('JEV_API_KEY and JEV_URL (or JEV_ROUTE)');
    const one = await run(args, root, {
      JEV_API_KEY: 'jev-secret',
      JEV_ROUTE: 'typesafe',
      ANTHROPIC_API_KEY: undefined,
    });
    expect(one.code).toBe(2);
    expect(one.err).toContain('ANTHROPIC_API_KEY');
    expect(one.err + one.out).not.toContain('secret');
  });

  it('refuses the flags that need --pointer, and --pointer with the model port flags', async () => {
    const root = await estate();
    const alone = await run(['estate', 'scan', '.', '--cassette', 'c.jsonl', '--out', 'map.yaml'], root);
    expect(alone.code).toBe(2);
    expect(alone.err).toContain('need --pointer');
    const labeler = await run(['estate', 'scan', '.', '--labeler', 'system1:jev', '--out', 'map.yaml'], root);
    expect(labeler.err).toContain('need --pointer');
    const both = await run(
      ['estate', 'scan', '.', '--pointer', '--no-model', '--cassette', 'c.jsonl', '--out', 'map.yaml'],
      root,
    );
    expect(both.code).toBe(2);
    const noCassette = await run(['estate', 'scan', '.', '--pointer', '--out', 'map.yaml'], root);
    expect(noCassette.err).toContain('--pointer needs --cassette');
  });

  it('refuses a bad labeler, a bad number and a stack of one class twice', async () => {
    const root = await estate();
    const base = ['estate', 'scan', '.', '--pointer', '--cassette', 'c.jsonl', '--out', 'map.yaml'];
    const bad = await run([...base, '--labeler', 'haiku'], root);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('starts with system1 or system2');
    expect((await run([...base, '--labeler', 'system2:jev'], root)).err).toContain(
      'the clients of system2 are',
    );
    expect((await run([...base, '--labeler-pass-at', '2'], root)).err).toContain(
      '--labeler-pass-at is a number from 0 to 1',
    );
    expect((await run([...base, '--labeler-threshold', 'high'], root)).err).toContain('--labeler-threshold');
    expect((await run([...base, '--jobs', '0'], root)).err).toContain(
      '--jobs is a whole number from 1 to 64',
    );
    expect(
      (await run([...base, '--labeler', 'system1:jev', '--labeler', 'system1:jev-unit'], root)).err,
    ).toContain('at most one labeler per class');
  });

  it('reads a user label set and refuses a bad one with the reason', async () => {
    const root = await estate();
    await writeFile(
      join(root, 'labels.yaml'),
      'labels:\n  - set: s\n    description: d\n    labels:\n      - { name: none, description: d }\n',
    );
    const bad = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--labels',
        'labels.yaml',
        '--cassette',
        'c.jsonl',
        '--out',
        'map.yaml',
      ],
      root,
    );
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('Cannot use the label sets in labels.yaml');
    expect(bad.err).toContain('none is reserved');
  });

  it('runs a user labeler from a module, recorded and replayed like the built-in ones', async () => {
    const root = await estate();
    await writeFile(
      join(root, 'house.mjs'),
      `export default {
        id: 'house',
        cls: 'system2',
        label: (request) => ({ labels: request.window.units.map((unit) => ({ units: String(unit.n), label: /^Never/.test(unit.text) ? 'prohibition' : 'none' })) }),
      };`,
    );
    const { io, output } = capture(root);
    const recorded = await estateScanCommand(
      '.',
      {
        out: 'house.yaml',
        pointer: true,
        cassette: 'house.jsonl',
        record: true,
        labeler: ['system2:module:./house.mjs'],
      },
      io,
      { env: {} },
    );
    expect(output.err).toBe('');
    expect(recorded).toBe(0);
    expect(output.out).toContain('Pointer reader: system 2 module:house house.');
    const replay = await run(
      [
        'estate',
        'scan',
        '.',
        '--pointer',
        '--cassette',
        'house.jsonl',
        '--labeler',
        'system2:module:./house.mjs',
        '--out',
        'house2.yaml',
      ],
      root,
    );
    expect(replay.code).toBe(0);
    expect(await readFile(join(root, 'house2.yaml'), 'utf8')).toContain('quote: Never leave the gate open');
  });

  it('leaves the default scan as it was: no pointer line without the flag', async () => {
    const root = await estate();
    const result = await run(['estate', 'scan', '.', '--no-model', '--out', 'map.yaml'], root);
    expect(result.out).not.toContain('Pointer reader');
  });
});

describe('the radius on the ledger', () => {
  const spec = (id: string, atoms: string[]) =>
    [
      `id: ${id}`,
      'kind: task',
      'target: { adapter: claude-code }',
      'metadata:',
      `  estate: { atoms: [${atoms.join(', ')}] }`,
      'blocks:',
      '  - user: Tie up the blue boat.',
      '    expect: { skills: [{ name: moorings, count: { min: 1 } }] }',
      '',
    ].join('\n');

  it('reads one edit the same way in radius ledger, estate diff, estate impact and radius', async () => {
    const root = await estate();
    expect((await record(root)).code).toBe(0);
    const v1 = await readFile(join(root, 'ledger.json'), 'utf8');
    await writeFile(join(root, 'ledger-v1.json'), v1);
    const ledger = pointer.parseLedger(v1);
    const unitOf = (quote: string) => ledger?.entries.find((entry) => entry.quote === quote)?.id;
    const unit = unitOf('Never leave the gate open');
    expect(unit).toBeDefined();
    const atoms = (
      parseYaml(await readFile(join(root, 'recorded.yaml'), 'utf8')) as {
        atoms: { id: string; fields?: { unit?: string } }[];
      }
    ).atoms;
    const atomOf = (quote: string) => atoms.find((atom) => atom.fields?.unit === unitOf(quote))?.id;
    const gate = atomOf('Never leave the gate open');
    expect(gate).toMatch(/^instruction\.standing\./);

    // The edit, read from the ledger of the last scan and the files as they are now, with no labeler.
    await writeFile(
      join(root, 'CLAUDE.md'),
      FILES['CLAUDE.md']?.replace('the gate open', 'the gate open after dusk') ?? '',
    );
    const working = await run(
      ['radius', 'ledger', 'recorded.yaml', '--ledger', 'ledger-v1.json', '--out', 'working.yaml'],
      root,
    );
    expect(working.err).toBe('');
    expect(working.code).toBe(0);
    expect(working.out).toMatch(/Units: \d+ unchanged, 2 context, 0 moved, 1 changed, 0 deleted, 0 new\./);
    const workingManifest = await readFile(join(root, 'working.yaml'), 'utf8');
    expect(workingManifest).toContain(`kind: prompt\n    id: ${gate}\n    note: "unit ${unit}: changed"`);

    // The rescan writes the new ledger; the diff of the two maps reads both ledgers.
    const { io, output } = capture(root);
    const rescanned = await estateScanCommand(
      '.',
      {
        out: 'v2.yaml',
        pointer: true,
        cassette: 'cassette.jsonl',
        record: true,
        ledger: 'ledger.json',
        update: true,
      },
      io,
      { env: KEYS, fetch: services },
    );
    expect(output.err).toBe('');
    expect(rescanned).toBe(0);
    const diffed = await run(
      [
        'estate',
        'diff',
        'recorded.yaml',
        'v2.yaml',
        '--old-ledger',
        'ledger-v1.json',
        '--new-ledger',
        'ledger.json',
        '--out',
        'diff.json',
        '--change-out',
        'change.yaml',
      ],
      root,
    );
    expect(diffed.code).toBe(0);
    const diff = JSON.parse(await readFile(join(root, 'diff.json'), 'utf8'));
    const renamed = diff.atoms.changed.find((change: { id: string }) => change.id === gate);
    expect(renamed).toMatchObject({ change: 'semantic' });
    expect(renamed.now).toMatch(/^instruction\.standing\./);
    expect(renamed.now).not.toBe(gate);
    expect(diff.atoms.removed).toEqual([]);
    expect(diff.atoms.added).toEqual([]);
    expect(diff.units.counts).toMatchObject({ changed: 1, context: 2, new: 0, deleted: 0 });
    expect(diff.units.rerun).toEqual([{ unit, why: ['changed'], atoms: [gate] }]);
    const change = await readFile(join(root, 'change.yaml'), 'utf8');
    // The same changes as the working manifest: only the versions differ.
    expect(change.slice(change.indexOf('changes:'))).toBe(
      workingManifest.slice(workingManifest.indexOf('changes:')),
    );

    // The tests that name the old atom are regenerated, and only they are in the radius.
    await mkdir(join(root, 'tests'));
    await writeFile(join(root, 'tests', 'gate.yaml'), spec('harbour-gate', [gate as string]));
    const other = atomOf('Tie the bow line first.');
    expect(other).toBeDefined();
    await writeFile(join(root, 'tests', 'bow.yaml'), spec('harbour-bow', [other as string]));
    const impact = await run(['estate', 'impact', 'diff.json', '--tests', 'tests', '--json'], root);
    expect(impact.err).toBe('');
    const report = JSON.parse(impact.out);
    expect(report.regenerate.map((entry: { test: string }) => entry.test)).toEqual(['harbour-gate']);
    expect(report.units).toEqual({ rerun: [], advisory: [] });
    const radius = await run(['radius', 'tests', '--change', 'change.yaml', '--json'], root);
    expect(radius.code).toBe(0);
    const inRadius = JSON.parse(radius.out).specs.filter(
      (entry: { blocks: { state: Record<string, string> }[] }) =>
        entry.blocks.some((block) => block.state.F !== 'out'),
    );
    expect(inRadius.map((entry: { specId: string }) => entry.specId)).toEqual(['harbour-gate']);
  });
});

describe('the settings file of the estate', () => {
  const SETS = (voice = 'How the harbour office words its notices.') =>
    [
      'labels:',
      '  - set: harbour-rules',
      '    description: What the harbour office asks of the agent.',
      '    labels:',
      '      - name: rule',
      '        description: A unit that tells the reader what to do.',
      '      - name: prohibition',
      '        description: A unit that tells the reader what never to do.',
      '  - set: harbour-voice',
      `    description: ${voice}`,
      '    labels:',
      '      - name: rule',
      '        description: A unit that fixes a word or a tone.',
      '      - name: prohibition',
      '        description: A unit that forbids a word or a tone.',
      '',
    ].join('\n');
  const SETTINGS = [
    'labels: labels.yaml',
    'labeler: [system1:jev, system2:anthropic]',
    'threshold: { pass_at: 0.9, fail_at: 0.1 }',
    'ledger: ledger.json',
    '',
  ].join('\n');

  type Entry = { key: string; readable: Record<string, string> };
  const entries = async (root: string): Promise<Entry[]> =>
    (await readFile(join(root, 'cassette.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Entry);
  async function scan(root: string, env: Record<string, string> = {}) {
    const { io, output } = capture(root);
    const code = await estateScanCommand(
      '.',
      { out: 'map.yaml', pointer: true, cassette: 'cassette.jsonl', record: true, update: true, force: true },
      io,
      { env: { ...KEYS, ...env }, fetch: services },
    );
    return { code, ...output };
  }
  /** A fresh estate with the settings file, scanned once: the recordings every change is measured against. */
  async function base() {
    const root = await estate();
    await writeFile(join(root, 'driftbench.estate.yaml'), SETTINGS);
    await writeFile(join(root, 'labels.yaml'), SETS());
    const first = await scan(root);
    expect(first.err).toBe('');
    expect(first.code).toBe(0);
    expect(first.out).toContain(
      'Pointer settings from driftbench.estate.yaml: labels, labeler, threshold, ledger.',
    );
    return { root, before: await entries(root) };
  }
  /** The recordings a change voids: the requests it asked for that the cassette did not hold. */
  async function voided(root: string, before: Entry[], env: Record<string, string> = {}) {
    const again = await scan(root, env);
    expect(again.err).toBe('');
    expect(again.code).toBe(0);
    const known = new Set(before.map((entry) => entry.key));
    return { added: (await entries(root)).filter((entry) => !known.has(entry.key)), out: again.out };
  }
  const shape = (list: Entry[]) => list.map((entry) => `${entry.readable.set} ${entry.readable.cls}`).sort();

  it('reads every setting from the file, and the ledger it names', async () => {
    const { root, before } = await base();
    // The two sets of the file. Both files are loaded by the runtime as instructions: no document-roles question.
    expect(new Set(before.map((entry) => entry.readable.set))).toEqual(
      new Set(['harbour-rules', 'harbour-voice']),
    );
    expect(new Set(before.map((entry) => entry.readable.cls))).toEqual(new Set(['system1', 'system2']));
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8'));
    expect(ledger.entries.length).toBeGreaterThan(0);
    const unchanged = await voided(root, before);
    expect(unchanged.added).toEqual([]);
    // 9 units under 2 label sets.
    expect(unchanged.out).toMatch(/Units: 9 in 2 files; 18 kept from the ledger, 0 labelled by this run/);
  });

  it('voids the recordings of one label set when its description changes, and no other', async () => {
    const { root, before } = await base();
    await writeFile(join(root, 'labels.yaml'), SETS('How the harbour office words its signs.'));
    const { added } = await voided(root, before);
    expect(shape(added)).toEqual(shape(before.filter((entry) => entry.readable.set === 'harbour-voice')));
  });

  it('voids the recordings of system 2 when its model changes by environment variable, and no other', async () => {
    const { root, before } = await base();
    const { added } = await voided(root, before, { ANTHROPIC_LABELER_MODEL: 'claude-sonnet-5-5' });
    expect(shape(added)).toEqual(shape(before.filter((entry) => entry.readable.cls === 'system2')));
    expect(added.every((entry) => entry.readable.model === 'claude-sonnet-5-5')).toBe(true);
  });

  it('voids no recording when a threshold changes: the labels are decided again from the cassette', async () => {
    const { root, before } = await base();
    await writeFile(join(root, 'driftbench.estate.yaml'), SETTINGS.replace('pass_at: 0.9', 'pass_at: 0.8'));
    const { added, out } = await voided(root, before);
    expect(added).toEqual([]);
    expect(out).toMatch(/0 kept from the ledger, 18 labelled by this run/);
  });

  it('voids no recording when the labeler drops a class or the ledger moves', async () => {
    const { root, before } = await base();
    await writeFile(
      join(root, 'driftbench.estate.yaml'),
      SETTINGS.replace('[system1:jev, system2:anthropic]', '[system2:anthropic]'),
    );
    expect((await voided(root, before)).added).toEqual([]);
    await writeFile(
      join(root, 'driftbench.estate.yaml'),
      SETTINGS.replace('ledger.json', 'moved/ledger.json'),
    );
    expect((await voided(root, before)).added).toEqual([]);
    expect(
      JSON.parse(await readFile(join(root, 'moved', 'ledger.json'), 'utf8')).entries.length,
    ).toBeGreaterThan(0);
  });

  it('gives radius ledger the ledger the file names', async () => {
    const { root } = await base();
    await writeFile(
      join(root, 'CLAUDE.md'),
      FILES['CLAUDE.md']?.replace('the gate open', 'the gate open after dusk') ?? '',
    );
    const result = await run(['radius', 'ledger', 'map.yaml', '--out', 'change.yaml'], root);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/1 changed, 0 deleted, 0 new\./);
    await writeFile(join(root, 'driftbench.estate.yaml'), 'ignore: [logs/]\n');
    const missing = await run(['radius', 'ledger', 'map.yaml'], root);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain(
      'name the ledger with --ledger <file>, or with ledger: in driftbench.estate.yaml',
    );
  });

  it('loads a labeler module the file names from beside the estate, scanned from another folder', async () => {
    const root = await estate();
    await writeFile(
      join(root, 'labeler.mjs'),
      "export default { id: 'harbour', cls: 'system2', label: (request) => ({ labels: request.window.units.map((unit) => ({ units: String(unit.n), label: 'none' })) }) };\n",
    );
    await writeFile(join(root, 'driftbench.estate.yaml'), 'labeler: system2:module:labeler.mjs\n');
    const { io, output } = capture(dirname(root));
    const code = await estateScanCommand(
      basename(root),
      { out: join(root, 'map.yaml'), pointer: true, cassette: join(root, 'cassette.jsonl'), record: true },
      io,
      { env: {} },
    );
    expect(output.err).toBe('');
    expect(code).toBe(0);
    expect(output.out).toContain('Pointer reader: system 2 module:harbour harbour.');
  });

  it('lets each option win over its key: threshold, label sets and ledger, with the file in place', async () => {
    const { root } = await base();
    const ledger = await readFile(join(root, 'ledger.json'), 'utf8');
    await writeFile(join(root, 'rules-only.yaml'), SETS().slice(0, SETS().indexOf('  - set: harbour-voice')));
    const { io, output } = capture(root);
    const code = await estateScanCommand(
      '.',
      {
        out: 'map.yaml',
        pointer: true,
        cassette: 'cassette.jsonl',
        record: true,
        update: true,
        force: true,
        labelerPassAt: '0.8',
        labels: 'rules-only.yaml',
        ledger: 'other.json',
      },
      io,
      { env: KEYS, fetch: services },
    );
    expect(output.err).toBe('');
    expect(code).toBe(0);
    // The threshold of the option, not pass_at: 0.9 of the file.
    expect(output.out).toContain('(pass at 0.8, fail at 0.1)');
    // The ledger of the option is written; the ledger the file names is left as it was.
    expect(await readFile(join(root, 'ledger.json'), 'utf8')).toBe(ledger);
    const other = JSON.parse(await readFile(join(root, 'other.json'), 'utf8')) as {
      entries: { labels: Record<string, unknown> }[];
    };
    // The label sets of the option: harbour-rules alone, not the two sets of labels.yaml.
    const sets = new Set(other.entries.flatMap((entry) => Object.keys(entry.labels)));
    expect([...sets]).toEqual(['harbour-rules']);
  });

  it('lets a command-line option win over its key, and refuses a model in the file', async () => {
    const { root, before } = await base();
    const { io, output } = capture(root);
    const code = await estateScanCommand(
      '.',
      {
        out: 'map.yaml',
        pointer: true,
        cassette: 'cassette.jsonl',
        labeler: ['system2:anthropic'],
        force: true,
      },
      io,
      { env: KEYS },
    );
    expect(code).toBe(0);
    expect(output.out).toContain('Pointer reader: system 2 anthropic claude-haiku-5-5.');
    expect(before.length).toBeGreaterThan(0);
    await writeFile(join(root, 'driftbench.estate.yaml'), 'labeler: system2:anthropic:claude-haiku-5-5\n');
    const refused = await run(
      ['estate', 'scan', '.', '--pointer', '--cassette', 'cassette.jsonl', '--out', 'x.yaml'],
      root,
    );
    expect(refused.code).toBe(2);
    expect(refused.err).toContain(
      'a model is set by environment variable, ANTHROPIC_LABELER_MODEL for anthropic',
    );
  });
});

describe('driftbench estate scan --pointer --record reads the anthropic key when a request leaves', () => {
  const MESSAGE = '--record needs ANTHROPIC_API_KEY in the environment for the system2 labeler anthropic';

  /** An environment whose anthropic key sits behind a getter that counts the reads. */
  function counting(value: string | undefined) {
    const reads = { count: 0 };
    const env: Record<string, string | undefined> = { JEV_API_KEY: 'jev-secret', JEV_ROUTE: 'typesafe' };
    Object.defineProperty(env, 'ANTHROPIC_API_KEY', {
      enumerable: true,
      get() {
        reads.count += 1;
        return value;
      },
    });
    return { env, reads };
  }

  async function opaqueOnly(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-pointer-cli-'));
    await writeFile(join(root, 'CLAUDE.md'), '```text\nBe polite to the keeper.\n```\n');
    return root;
  }

  async function recordWith(root: string, env: Record<string, string | undefined>) {
    const { io, output } = capture(root);
    const requests = { count: 0 };
    const code = await estateScanCommand(
      '.',
      { out: 'recorded.yaml', pointer: true, cassette: 'cassette.jsonl', record: true, jobs: '1' },
      io,
      {
        env,
        fetch: async (url, init) => {
          requests.count += 1;
          return services(url, init);
        },
      },
    );
    return { code, requests: requests.count, ...output };
  }

  it('reads no key for a source with nothing to label, and does not fail', async () => {
    const { env, reads } = counting('anthropic-secret');
    const done = await recordWith(await opaqueOnly(), env);
    expect(done.err).toBe('');
    expect(done.code).toBe(0);
    expect(done.requests).toBe(0);
    expect(reads.count).toBe(0);
  });

  it('does not fail without a key when it sends nothing', async () => {
    const { env, reads } = counting(undefined);
    const done = await recordWith(await opaqueOnly(), env);
    expect(done.err).toBe('');
    expect(done.code).toBe(0);
    expect(reads.count).toBe(0);
  });

  it('reads the key once, for a run that sends', async () => {
    const { env, reads } = counting('anthropic-secret');
    const done = await recordWith(await estate(), env);
    expect(done.err).toBe('');
    expect(done.code).toBe(0);
    expect(done.requests).toBeGreaterThan(0);
    expect(reads.count).toBe(1);
  });

  it('with no key, a run that sends fails before its first request leaves, with the same message', async () => {
    const { env, reads } = counting(undefined);
    const done = await recordWith(await estate(), env);
    expect(done.code).toBe(2);
    expect(done.err).toContain(MESSAGE);
    expect(done.requests).toBe(0);
    expect(reads.count).toBe(1);
  });
});
