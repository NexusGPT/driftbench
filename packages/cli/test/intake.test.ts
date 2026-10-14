import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { fromInterviewCommand, logsCommand } from '../src/commands/intake';
import { type Io, main } from '../src/index';

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

async function run(argv: string[], cwd: string) {
  const { io, output } = capture(cwd);
  const code = await main(argv, io);
  return { code, ...output };
}

const ACME = fileURLToPath(new URL('../../../examples/acme/', import.meta.url));

/** Generated at run time so that no source file holds a real-looking address or number. */
const REAL_EMAIL = `ana.duarte@${['mail', 'box'].join('')}.be`;
const REAL_PHONE = ['+32', '471', '12', '34', '56'].join(' ');

const LOGS = [
  {
    id: 'c1',
    turns: [
      { role: 'user', text: "I'd like a plan with more data." },
      { role: 'agent', text: 'Sure.' },
    ],
  },
  { id: 'c2', turns: [{ role: 'user', text: `Can I get more data? My account email is ${REAL_EMAIL}` }] },
  {
    id: 'c3',
    turns: [{ role: 'user', text: 'Hi, do you have home internet at 3 Orchard Way, Acmeville?' }],
    flags: ['incident'],
  },
  { id: 'c4', turns: [{ role: 'user', text: `I want to switch to Acme and keep my number ${REAL_PHONE}` }] },
  { id: 'c5', turns: [{ role: 'user', text: "My name is Ana Duarte and I'd like a plan with more data." }] },
]
  .map((line) => JSON.stringify(line))
  .join('\n');

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-intake-'));
  await writeFile(join(dir, 'logs.jsonl'), `${LOGS}\n`);
  return dir;
}

describe('driftbench intake logs', () => {
  it('writes the private set with owner-only permissions and prints counts, never a value', async () => {
    const dir = await setup();
    const result = await run(
      [
        'intake',
        'logs',
        'logs.jsonl',
        '--out',
        'private/set',
        '--map',
        `${ACME}map/approved.yaml`,
        '--spot-check',
        '3',
      ],
      dir,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect((await readdir(join(dir, 'private/set'))).sort()).toEqual([
      'conversations.jsonl',
      'intake-report.json',
      'reference-turns.jsonl',
      'spot-check.yaml',
    ]);
    expect((await stat(join(dir, 'private/set'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'private/set/conversations.jsonl'))).mode & 0o777).toBe(0o600);
    expect(result.out).toContain(
      'Conversations: 5 read, 0 near-duplicates dropped, 5 kept, 1 flagged as failures.',
    );
    expect(result.out).toMatch(/Pass 1 \(rules and checksums\): 3 redacted: address 1, email 1, phone 1/);
    expect(result.out).toContain('Pass 2 (independent rules): 1 more redacted: name 1.');
    expect(result.out).toMatch(/Intents on flow: \d+ seen, \d+ from the map/);
    expect(result.out).toMatch(/Good-Turing f1 \/ n\): f1 = \d+, f2 = \d+, n = 5/);
    const written = (
      await Promise.all(
        ['conversations.jsonl', 'intake-report.json', 'reference-turns.jsonl', 'spot-check.yaml'].map(
          (name) => readFile(join(dir, 'private/set', name), 'utf8'),
        ),
      )
    ).join('\n');
    for (const secret of ['ana.duarte', '471', 'Duarte', 'Orchard Way']) {
      expect(written).not.toContain(secret);
      expect(result.out).not.toContain(secret);
    }
    const turns = (await readFile(join(dir, 'private/set/reference-turns.jsonl'), 'utf8')).trim().split('\n');
    expect(JSON.parse(turns[0] as string).cell).toEqual({ flow: 'upgrade' });
  });

  it('reads --dedup, --intent-threshold, --cluster-threshold and --intent-dimension', async () => {
    const dir = await setup();
    const logs = async (out: string, ...flags: string[]) => {
      const result = await run(
        [
          'intake',
          'logs',
          'logs.jsonl',
          '--out',
          out,
          '--map',
          `${ACME}map/approved.yaml`,
          '--spot-check',
          '1',
          ...flags,
        ],
        dir,
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(0);
      return result.out;
    };
    expect(await logs('d0', '--dedup', '0')).toContain('3 near-duplicates dropped, 2 kept');
    expect(await logs('i1', '--intent-threshold', '1')).toContain('0 from the map');
    expect(await logs('c0', '--intent-threshold', '1', '--cluster-threshold', '0')).toContain(
      'Intents on flow: 1 seen, 0 from the map and 1 new.',
    );
    expect(await logs('c1', '--intent-threshold', '1', '--cluster-threshold', '1')).toContain(
      'Intents on flow: 5 seen, 0 from the map and 5 new.',
    );
    expect(await logs('dev', '--intent-dimension', 'deviation')).toContain('Intents on deviation:');

    const unknown = await run(
      [
        'intake',
        'logs',
        'logs.jsonl',
        '--out',
        'x',
        '--map',
        `${ACME}map/approved.yaml`,
        '--intent-dimension',
        'nope',
      ],
      dir,
    );
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('The map has no approved dimension "nope".');
    const range = await run(['intake', 'logs', 'logs.jsonl', '--out', 'y', '--dedup', '2'], dir);
    expect(range.code).toBe(2);
    expect(range.err).toContain('--dedup and the thresholds a number from 0 to 1');
    const provider = await run(
      ['intake', 'logs', 'logs.jsonl', '--out', 'z', '--second-pass', 'model', '--provider', 'bogus'],
      dir,
    );
    expect(provider.code).toBe(2);
    expect(provider.err).toContain('unknown provider "bogus": use anthropic or openai.');
  });

  it('refuses an output folder inside a git work tree with exit 2 and writes nothing', async () => {
    const dir = await setup();
    await mkdir(join(dir, 'repo', '.git'), { recursive: true });
    const result = await run(['intake', 'logs', 'logs.jsonl', '--out', 'repo/private'], dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain('is inside the git work tree');
    expect(await readdir(join(dir, 'repo'))).toEqual(['.git']);
  });

  it('refuses this repository too', async () => {
    const dir = await setup();
    // A folder no one else uses, removed whatever happens: if the refusal ever broke, this test would
    // otherwise leave generated look-alike data inside the repository.
    const out = join(ACME, `.intake-refusal-${process.pid}-${Date.now()}`);
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(['intake', 'logs', join(dir, 'logs.jsonl'), '--out', out], dir);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
    expect(result.code).toBe(2);
    expect(result.err).toContain('Refused');
  });

  it('refuses a folder that already holds files without --force', async () => {
    const dir = await setup();
    await mkdir(join(dir, 'set'));
    await writeFile(join(dir, 'set', 'old.txt'), 'x');
    expect((await run(['intake', 'logs', 'logs.jsonl', '--out', 'set'], dir)).code).toBe(2);
    expect((await run(['intake', 'logs', 'logs.jsonl', '--out', 'set', '--force'], dir)).code).toBe(0);
  });

  it('refuses an invalid file by line number without echoing its text', async () => {
    const dir = await setup();
    await writeFile(
      join(dir, 'bad.jsonl'),
      `{"turns": [{"role": "user", "text": "${REAL_EMAIL}"}]}\nnot json ${REAL_EMAIL}\n`,
    );
    const result = await run(['intake', 'logs', 'bad.jsonl', '--out', 'set'], dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain('✗ line 2  not a JSON object');
    expect(result.err).not.toContain('ana.duarte');
    expect(await stat(join(dir, 'set')).catch(() => undefined)).toBeUndefined();
  });

  it('refuses an unknown second pass and a model pass without a key', async () => {
    const dir = await setup();
    expect(
      (await run(['intake', 'logs', 'logs.jsonl', '--out', 's', '--second-pass', 'maybe'], dir)).code,
    ).toBe(2);
    const { io, output } = capture(dir);
    const code = await logsCommand('logs.jsonl', { out: 's', secondPass: 'model' }, io, { env: {} });
    expect(code).toBe(2);
    expect(output.err).toContain('no model key');
  });

  it('runs the model checker through the port and exits 1 when it fails on a conversation', async () => {
    const dir = await setup();
    const answers = [
      '{"findings": []}',
      '{"findings": []}',
      '{"findings": []}',
      'not json',
      'still not json',
      '{"findings": []}',
    ];
    const port = new FakeModelPort(answers, { family: 'other', model: 'checker-1' });
    const { io, output } = capture(dir);
    const code = await logsCommand('logs.jsonl', { out: 'set', secondPass: 'both' }, io, { port });
    expect(code).toBe(1);
    expect(output.out).toContain('Model check (other checker-1): 4 checked, 0 more redacted, 1 failed');
    expect(output.out).toContain('✗ model check failed on c4');
    for (const request of port.requests) expect(request.user).not.toContain('ana.duarte');
  });
});

const ZED_SPACE = `version: '1'
agent: zed
dimensions:
  - id: stage
    title: Stages
    kind: stage
    values:
      - { id: greet, title: The agent greets }
      - { id: verify, title: The agent asks for the last four digits }
  - id: flow
    title: Flows
    kind: behaviour
    values:
      - { id: balance, title: A customer asks for their balance }
      - { id: card-lost, title: A customer reports a lost card }
  - id: channel
    title: Channels
    kind: channel
    values:
      - { id: chat, title: Chat }
      - { id: email, title: Email }
constraints:
  - forbid: { flow: balance, channel: email }
    reason: balance is on chat only
prior: { kind: declared }
`;

const ZED_ANSWERS = `version: 1
agent: zed
map: map.yaml
personas:
  - id: saver
    description: A customer who checks their account often
    share: 1
    languages: [en]
    channels: [chat, email]
intents:
  - { value: balance, share: 2 }
  - { value: card-lost, share: 1 }
examples:
  - { stage: greet, intent: balance, persona: saver, turns: ["what's my balance?"] }
  - { stage: verify, intent: card-lost, persona: saver, turns: ["last four are 1234"] }
languages:
  - { lang: en, share: 1 }
channels:
  - { value: chat, share: 3 }
  - { value: email, share: 1 }
`;

async function zed() {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-interview-'));
  await writeFile(join(dir, 'map.yaml'), ZED_SPACE);
  await writeFile(join(dir, 'answers.yaml'), ZED_ANSWERS);
  return dir;
}

const DISTINCT = [
  'how much is left in my account',
  'my card is gone, please block it',
  'could you check the money I have?',
  'I think somebody took my wallet',
  'tell me what remains on savings',
  'need a new card asap',
];

/** A fake writer that answers every cell with `count` distinct turns. */
function writer(count = 'asked' as 'asked' | number) {
  const answer = (request: { user: string }) => {
    const key = request.user.split('\n', 1)[0]?.slice('CELL: '.length) ?? '';
    const asked = Number(/^COUNT: (\d+)$/m.exec(request.user)?.[1]);
    const n = count === 'asked' ? asked : count;
    return JSON.stringify({
      cell: key,
      turns: Array.from({ length: n }, (_, i) => ({
        text: DISTINCT[i % DISTINCT.length],
        source: 'personas.saver',
      })),
    });
  };
  return new FakeModelPort([answer, answer, answer, answer, answer, answer], {
    family: 'other',
    model: 'writer-1',
  });
}

describe('driftbench intake interview', () => {
  it('writes the questionnaire from the map, with the map path relative to it', async () => {
    const dir = await zed();
    const result = await run(
      ['intake', 'interview', '--map', 'map.yaml', '--out', 'interview/questions.yaml'],
      dir,
    );
    expect(result.code).toBe(0);
    const text = await readFile(join(dir, 'interview/questions.yaml'), 'utf8');
    expect(text).toContain('map: ../map.yaml');
    expect(text).toContain('Q3. Example interactions per stage');
    expect(
      (await run(['intake', 'interview', '--map', 'map.yaml', '--out', 'interview/questions.yaml'], dir))
        .code,
    ).toBe(2);
  });

  it('refuses a proposal with nothing approved yet', async () => {
    const dir = await zed();
    const result = await run(
      ['intake', 'interview', '--map', `${ACME}map/proposal.yaml`, '--out', 'q.yaml'],
      dir,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('no approved entry yet');
  });
});

describe('driftbench intake from-interview', () => {
  it('lists every open question of an unanswered questionnaire and writes nothing', async () => {
    const dir = await zed();
    await run(['intake', 'interview', '--map', 'map.yaml', '--out', 'questions.yaml'], dir);
    const result = await run(['intake', 'from-interview', 'questions.yaml', '--out', 'set'], dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain('personas.0.share  not answered');
    expect(await stat(join(dir, 'set')).catch(() => undefined)).toBeUndefined();
  });

  it('refuses an unknown --provider before any model call', async () => {
    const dir = await zed();
    const result = await run(
      ['intake', 'from-interview', 'answers.yaml', '--out', 'set', '--provider', 'bogus'],
      dir,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown provider "bogus": use anthropic or openai.');
  });

  it('prints the plan on a dry run and calls no model', async () => {
    const dir = await zed();
    const result = await run(['intake', 'from-interview', 'answers.yaml', '--dry-run', '--turns', '8'], dir);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Cells: 3, 8 model turns to request, 1 cells dropped by the map.');
    expect(result.out).toContain(
      'dropped stage=greet flow=balance persona=saver channel=email lang=en: balance is on chat only',
    );
  });

  it('refuses a plan over --max-cells, and gives every cell --min-per-cell turns', async () => {
    const dir = await zed();
    const over = await run(
      ['intake', 'from-interview', 'answers.yaml', '--dry-run', '--max-cells', '2'],
      dir,
    );
    expect(over.code).toBe(2);
    expect(over.err).toContain('The answers give 3 cells, more than --max-cells 2.');
    const floor = await run(
      ['intake', 'from-interview', 'answers.yaml', '--dry-run', '--turns', '3', '--min-per-cell', '4'],
      dir,
    );
    expect(floor.code).toBe(0);
    expect(floor.out).toContain('Cells: 3, 12 model turns to request');
  });

  it('writes the set and its approval file, every turn unapproved, and exits 0', async () => {
    const dir = await zed();
    const { io, output } = capture(dir);
    const code = await fromInterviewCommand('answers.yaml', { out: 'set', turns: '6', map: 'map.yaml' }, io, {
      port: writer(),
      now: () => new Date('2026-10-11T12:00:00Z'),
    });
    expect(output.err).toBe('');
    expect(code).toBe(0);
    expect(output.out).toContain(
      "8 turns (2 from the owner's examples, 6 from other writer-1) in 3 cells, none approved.",
    );
    const reference = await readFile(join(dir, 'set/reference.yaml'), 'utf8');
    expect(reference).toContain('interview: ../answers.yaml');
    expect(reference).toContain('map: ../map.yaml');
    const approval = await readFile(join(dir, 'set/approval.yaml'), 'utf8');
    expect(approval.match(/approved: false/g)).toHaveLength(8);
    expect((await run(['intake', 'from-interview', 'answers.yaml', '--out', 'set'], dir)).code).toBe(2);
  });

  it('exits 1 when a cell falls short, and lists it', async () => {
    const dir = await zed();
    const { io, output } = capture(dir);
    const code = await fromInterviewCommand('answers.yaml', { out: 'set', turns: '6' }, io, {
      port: writer(0),
    });
    expect(code).toBe(1);
    expect(output.out).toMatch(
      /✗ stage=greet flow=balance persona=saver channel=chat lang=en: 0 of \d turns accepted/,
    );
  });

  it('replays a recording keyed by cell', async () => {
    const dir = await zed();
    const key = 'stage=greet flow=balance persona=saver channel=chat lang=en';
    const others = [
      'stage=verify flow=card-lost persona=saver channel=chat lang=en',
      'stage=verify flow=card-lost persona=saver channel=email lang=en',
    ];
    const recording = {
      family: 'lane',
      model: 'by hand',
      answers: Object.fromEntries(
        [key, ...others].map((cell) => [
          cell,
          { cell, turns: [{ text: `recorded for ${cell}`, source: 'personas.saver' }] },
        ]),
      ),
    };
    await writeFile(join(dir, 'recorded.json'), JSON.stringify(recording));
    const result = await run(
      [
        'intake',
        'from-interview',
        'answers.yaml',
        '--out',
        'set',
        '--replay',
        'recorded.json',
        '--turns',
        '0',
      ],
      dir,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain('from lane by hand');
  });
});

describe('driftbench intake approve', () => {
  it('lists the pending turns, approves them all, and refuses an invalid or missing file', async () => {
    const dir = await zed();
    const { io } = capture(dir);
    await fromInterviewCommand('answers.yaml', { out: 'set', turns: '3' }, io, { port: writer() });
    const listed = await run(['intake', 'approve', 'set/approval.yaml'], dir);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain('6 of 6 turns are not approved yet.');
    const approved = await run(['intake', 'approve', 'set/approval.yaml', '--all'], dir);
    expect(approved.out).toContain('Approved 6 turns');
    expect((await run(['intake', 'approve', 'set/approval.yaml'], dir)).out).toContain(
      'all 6 turns are approved',
    );
    await writeFile(join(dir, 'bad.yaml'), 'reference: r\nturns: 3\n');
    expect((await run(['intake', 'approve', 'bad.yaml'], dir)).code).toBe(1);
    expect((await run(['intake', 'approve', 'nope.yaml'], dir)).code).toBe(2);
  });
});

describe('driftbench intake fidelity', () => {
  async function withSet() {
    const dir = await zed();
    const { io } = capture(dir);
    await fromInterviewCommand('answers.yaml', { out: 'set', turns: '3' }, io, { port: writer() });
    await writeFile(
      join(dir, 'candidate.jsonl'),
      [
        { text: 'what is my balance please?', cell: { stage: 'greet', flow: 'balance', channel: 'chat' } },
        {
          text: 'how much money is on the account',
          cell: { stage: 'greet', flow: 'balance', channel: 'chat' },
        },
        { text: 'block my card, it is lost', cell: { stage: 'verify', flow: 'card-lost', channel: 'chat' } },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
    return dir;
  }

  it('refuses a reference set with no approved turn', async () => {
    const dir = await withSet();
    const result = await run(
      ['intake', 'fidelity', '--reference', 'set', '--candidate', 'candidate.jsonl'],
      dir,
    );
    expect(result.code).toBe(2);
    expect(result.err).toContain('has no approved turn (6 wait for approval)');
  });

  it('prints every measure with the sample sizes once turns are approved', async () => {
    const dir = await withSet();
    await run(['intake', 'approve', 'set/approval.yaml', '--all'], dir);
    const result = await run(
      ['intake', 'fidelity', '--reference', 'set', '--candidate', 'candidate.jsonl'],
      dir,
    );
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(result.out).toContain(
      'Reference set: 6 turns, approved only (0 not approved, left out). Candidate candidate.jsonl: 3 turns.',
    );
    expect(result.out).toContain('Cells on stage, flow, channel: total variation');
    expect(result.out).toMatch(/Length in words: KS \d\.\d{3} against \d\.\d{3} \(n = 6, m = 3\)/);
    expect(result.out).toContain('Question rate: KS');
    expect(result.out).toContain('Vocabulary: Jaccard');
    expect(result.out).toContain('of candidate turns copy a reference turn');
    expect(result.out).toContain('Small samples');
    const json = await run(
      [
        'intake',
        'fidelity',
        '--reference',
        'set',
        '--candidate',
        'candidate.jsonl',
        '--json',
        '--dims',
        'flow',
      ],
      dir,
    );
    expect(JSON.parse(json.out)).toMatchObject({ n: { reference: 6, candidate: 3 }, dimensions: ['flow'] });
  });

  it('counts a candidate turn as a copy against the --threshold it is given', async () => {
    const dir = await withSet();
    await run(['intake', 'approve', 'set/approval.yaml', '--all'], dir);
    const copyRate = async (threshold: string) => {
      const result = await run(
        [
          'intake',
          'fidelity',
          '--reference',
          'set',
          '--candidate',
          'candidate.jsonl',
          '--json',
          '--threshold',
          threshold,
        ],
        dir,
      );
      expect(result.code).toBe(0);
      const json = JSON.parse(result.out) as { duplicates: { threshold: number; copyRate: number } };
      return json.duplicates;
    };
    expect(await copyRate('0')).toMatchObject({ threshold: 0, copyRate: 1 });
    const strict = await copyRate('1');
    expect(strict.threshold).toBe(1);
    expect(strict.copyRate).toBeLessThan(1);
    const bad = await run(
      ['intake', 'fidelity', '--reference', 'set', '--candidate', 'candidate.jsonl', '--threshold', '2'],
      dir,
    );
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('--threshold takes a number from 0 to 1');
  });

  it('counts unapproved turns only when asked, and says so', async () => {
    const dir = await withSet();
    const result = await run(
      [
        'intake',
        'fidelity',
        '--reference',
        'set/reference.yaml',
        '--candidate',
        'candidate.jsonl',
        '--include-unapproved',
      ],
      dir,
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain('6 turns, approved or not (--include-unapproved)');
  });
});
