import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AGENT_RULES_SET,
  Cassette,
  createAnthropicLabeler,
  createHttpLabeler,
  createJevLabeler,
  createOpenAiDecisionsLabeler,
  type Labelling,
  type LabelSet,
  loadModuleLabeler,
  parseLabelSets,
  pointerAtoms,
  pointerScan,
  singleLabelling,
  stackedLabelling,
} from '../../src/pointer';
import { CONTRACT_SETS } from '../../src/pointer/contract';
import { DOCUMENT_ROLES_SET } from '../../src/pointer/document-roles-set';
import { AtomBuilder } from '../../src/scan';
import { plantedDense } from './support';

// Invented text: a harbour office. Every comment holds a marker that must never leave in a request, in the
// cassette a recording run writes, or in the id or title of an atom a request lists.

const names = [
  'heading',
  'inline',
  'opaque',
  'cell',
  'item',
  'splitone',
  'splittwo',
  'splitthree',
  'mdalone1',
  'mdalone2',
  'mdalone3',
  'mdpara1',
  'mdpara2',
  'mdpara3',
  'mdlist',
  'mdquote',
];

/** The text of a comment: a marker with characters a JSON body and a URL write differently. */
const bodyOf = (name: string): string => `ZZSECRET${name.toUpperCase()}ZZ "quoted" a/b\\c`;
const note = (name: string): string => `<!-- ${bodyOf(name)} -->`;

/** The three Markdown comment forms: a link reference definition with a title in ( ), " " or ' ' marks. */
const FORMS = [
  (name: string): string => `[//]: # (${bodyOf(name)})`,
  (name: string): string => `[//]: # "${bodyOf(name)}"`,
  (name: string): string => `[comment]: <> (${bodyOf(name)})`,
] as const;
const md = (form: 0 | 1 | 2, name: string): string => FORMS[form](name);

/** Every way the marker of a comment may be written in a request: raw, lower case (a slug), JSON, URL. */
function needlesOf(name: string): string[] {
  const token = `ZZSECRET${name.toUpperCase()}ZZ`;
  const text = bodyOf(name);
  return [
    token,
    token.toLowerCase(),
    text,
    JSON.stringify(text).slice(1, -1),
    encodeURIComponent(text),
    encodeURIComponent(token),
  ];
}

const HARBOUR = [
  `# Harbour office ${note('heading')}`,
  '',
  `Hang the lamp ${note('inline')} before dusk.`,
  '',
  note('opaque'),
  '',
  '| Boat | Rule |',
  '| --- | --- |',
  `| Skiff | Tie up ${note('cell')} at the east quay. |`,
  '',
  `- Never leave the gate open ${note('item')}`,
  '',
  // A definition between two paragraphs is a block of its own, one of each form.
  md(0, 'mdalone1'),
  '',
  md(1, 'mdalone2'),
  '',
  md(2, 'mdalone3'),
  '',
  // A definition on the line after a paragraph cannot interrupt it: the parser keeps it in the paragraph.
  'Mind the tide.',
  md(0, 'mdpara1'),
  '',
  'Mind the wind.',
  md(1, 'mdpara2'),
  '',
  'Mind the swell.',
  md(2, 'mdpara3'),
  '',
  // In a list item and in a block quote the definition follows the first line of the paragraph.
  '- Check the rope.',
  `  ${md(0, 'mdlist')}`,
  '',
  '> Check the net.',
  `> ${md(1, 'mdquote')}`,
  '',
  'Lock the shed.',
  '',
].join('\n');

// One comment of several sentences: the cutter splits it, and the second unit holds the end of the comment with
// no opener.
const SPLIT = `Check the tide <!-- ${['splitone', 'splittwo', 'splitthree'].map(bodyOf).join('. ')} -->.\n`;

const WITH_SPLIT = [
  { path: 'harbour.md', text: HARBOUR },
  { path: 'tides.md', text: SPLIT },
];
const WITHOUT_SPLIT = [{ path: 'harbour.md', text: HARBOUR }];

function setsOf(text: string): LabelSet[] {
  const parsed = parseLabelSets(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

/** The label sets the estate ships, and the one the labeler contract uses: each is scanned. */
const SHIPPED: Array<{ name: string; sets: LabelSet[] }> = [
  { name: 'agent-rules', sets: setsOf(AGENT_RULES_SET) },
  { name: 'document-roles', sets: setsOf(DOCUMENT_ROLES_SET) },
  { name: 'harbour-rules (contract)', sets: setsOf(CONTRACT_SETS) },
];

const MAKER = setsOf(`labels:
  - set: maker
    description: Every unit becomes an atom.
    labels:
      - name: item
        description: A unit.
        atom: { kind: instruction }
`);

type Listed = {
  id: string;
  kind: string;
  title: string;
  at?: { file: string; startLine: number; endLine: number; quote: string };
};

/**
 * The atoms a later scan lists as link candidates, built as the estate builds them: a label on every unit, then
 * `pointerAtoms`, whose title is the text of the unit with its comment. The kinds alternate between the two a
 * shipped link kind names (a helper, a skill). With `where`, each atom carries the place it is read from.
 */
async function atomsOf(
  files: Array<{ path: string; text: string }>,
  where: boolean,
  kinds: readonly string[] = ['subagent', 'skill'],
): Promise<Listed[]> {
  const labeler = plantedDense((window) =>
    window.units.map((unit) => ({ units: String(unit.n), label: 'item' })),
  );
  const made = await pointerScan({
    files,
    sets: MAKER,
    labelling: singleLabelling(labeler),
    cassette: new Cassette(),
    mode: 'record',
  });
  const builder = new AtomBuilder(
    new Map(
      files.map((file) => [file.path, { path: file.path, kind: 'standing' as const, text: file.text }]),
    ),
  );
  const built = pointerAtoms(
    made.labelled,
    new Map(files.map((file) => [file.path, file.text])),
    builder,
    'planted',
  );
  return built.accepted.map((atom, at) => ({
    id: atom.id,
    kind: kinds[at % kinds.length] as string,
    title: atom.title,
    ...(where ? { at: atom.provenance } : {}),
  }));
}

/** A fetch that keeps everything that leaves (address, headers, body) and answers with one reply. */
function recorder(reply: unknown) {
  const sent: string[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    sent.push(`${url}\n${JSON.stringify(init.headers)}\n${String(init.body)}`);
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { sent, fetch };
}

const ANTHROPIC_REPLY = {
  content: [{ type: 'text', text: '{"labels":[]}' }],
  model: 'm',
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

type Member = { name: string; labelling: Labelling; sent: string[][] };

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** A list the fixture module fills with each request it is sent: the list is put where the module reads it. */
function sinkAt(key: string): string[] {
  const sink: string[] = [];
  Reflect.set(globalThis, key, sink);
  return sink;
}

/** Every labeler a request can leave by, each with the lists of what it sent. */
async function labelers(): Promise<Member[]> {
  const env = { JEV_API_KEY: 'k', JEV_URL: 'https://jev.example.test/v1', OPENAI_API_KEY: 'k' };
  const anthropic = recorder(ANTHROPIC_REPLY);
  const http2 = recorder({ labels: [] });
  const http1 = recorder({ probabilities: {} });
  const jev = recorder({ answers: {} });
  const decisions = recorder({ answers: [] });
  const stackJev = recorder({ answers: {} });
  const stackAnthropic = recorder(ANTHROPIC_REPLY);
  const moduleTwo = sinkAt('__pointerSeenTwo');
  const moduleOne = sinkAt('__pointerSeenOne');
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const twoLabeler = await loadModuleLabeler(fixture('recording-labeler.mjs'), { cwd });
  const oneLabeler = await loadModuleLabeler(fixture('recording-labeler-one.mjs'), {
    cwd,
    skipTargetLabels: true,
  });
  return [
    {
      name: 'anthropic',
      labelling: singleLabelling(createAnthropicLabeler({ key: 'k', runs: 1, fetch: anthropic.fetch })),
      sent: [anthropic.sent],
    },
    {
      name: 'http system 2',
      labelling: singleLabelling(
        createHttpLabeler({
          url: 'https://labels.example.test/a',
          cls: 'system2',
          runs: 1,
          fetch: http2.fetch,
        }),
      ),
      sent: [http2.sent],
    },
    {
      name: 'http system 1',
      labelling: singleLabelling(
        createHttpLabeler({
          url: 'https://labels.example.test/b',
          cls: 'system1',
          skipTargetLabels: true,
          fetch: http1.fetch,
        }),
      ),
      sent: [http1.sent],
    },
    {
      name: 'jev',
      labelling: singleLabelling(createJevLabeler({ env, skipTargetLabels: true, fetch: jev.fetch })),
      sent: [jev.sent],
    },
    {
      name: 'openai decisions',
      labelling: singleLabelling(
        createOpenAiDecisionsLabeler({
          model: 'd-1',
          env,
          skipTargetLabels: true,
          fetch: decisions.fetch,
        }),
      ),
      sent: [decisions.sent],
    },
    { name: 'module system 2', labelling: singleLabelling(twoLabeler), sent: [moduleTwo] },
    { name: 'module system 1', labelling: singleLabelling(oneLabeler), sent: [moduleOne] },
    {
      name: 'stack jev + anthropic',
      labelling: stackedLabelling(
        createJevLabeler({ env, skipTargetLabels: true, fetch: stackJev.fetch }),
        createAnthropicLabeler({ key: 'k', runs: 1, fetch: stackAnthropic.fetch }),
        { passAt: 0.7, failAt: 0.3 },
      ),
      sent: [stackJev.sent, stackAnthropic.sent],
    },
  ];
}

describe('no comment text leaves in any request of any shipped label set', () => {
  for (const [variant, files, where] of [
    ['atoms that carry their place', WITH_SPLIT, true],
    ['atoms that carry only id, kind and title', WITHOUT_SPLIT, false],
  ] as const) {
    it(`sends the marker of no comment in a request or a cassette (${variant})`, async () => {
      const atoms = await atomsOf(files, where);
      expect(atoms.some((atom) => atom.title.includes('ZZSECRETINLINEZZ'))).toBe(true);
      const wanted = names.filter((name) => where || !name.startsWith('split'));
      const found: string[] = [];
      let requests = 0;
      for (const { name: setName, sets } of SHIPPED) {
        for (const member of await labelers()) {
          const cassette = new Cassette();
          await pointerScan({ files, sets, labelling: member.labelling, cassette, mode: 'record', atoms });
          const outgoing = member.sent.flat();
          requests += outgoing.length;
          // Everything that left (address, headers, body) and the cassette the run wrote.
          for (const [place, text] of [
            ['request', outgoing.join('\n')],
            ['cassette', cassette.render()],
          ] as const) {
            for (const name of wanted) {
              for (const needle of needlesOf(name)) {
                if (text.includes(needle)) {
                  found.push(`${setName} / ${member.name}: ${place} holds ${needle}`);
                }
              }
            }
          }
        }
      }
      expect(found).toEqual([]);
      // Every set was asked of every labeler: the check above looked at requests, not at an empty list.
      expect(requests).toBeGreaterThanOrEqual(SHIPPED.length * 8);
    });
  }
});

describe('a candidate that holds a comment is listed without it and answered by its own id', () => {
  const HELPERS = setsOf(`labels:
  - set: helpers
    description: Units that hand work to a helper.
    links:
      - name: dispatches
        description: The helper agent the unit hands work to.
        to: [subagent]
    labels:
      - name: dispatch
        description: A unit that hands work to a helper.
        links: [dispatches]
`);
  const FILES = [
    {
      path: 'quay.md',
      text: `Hang the lamp ${note('inline')} before dusk.\n\nLock the shed.\n\nCall the pilot.\n`,
    },
  ];

  /** The labeler reads the candidates of its request and links the first unit to the one that shows a comment. */
  function choosing(bodies: string[]) {
    return async (_url: string, init: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
      const content = body.messages[0]?.content ?? '';
      bodies.push(content);
      const lines = content.split('\n').filter((line) => /^ {4}\S+ {2}\S/.test(line));
      const chosen = lines.find((line) => line.includes('(comment)') || line.includes('withheld'));
      const to = chosen?.trim().split(' ')[0] ?? 'none';
      const text = JSON.stringify({
        labels: [
          { units: '1', label: 'dispatch', links: [{ kind: 'dispatches', to }] },
          { units: '2-3', label: 'none' },
        ],
      });
      return new Response(JSON.stringify({ ...ANTHROPIC_REPLY, content: [{ type: 'text', text }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
  }

  for (const where of [true, false]) {
    const how = where ? 'with' : 'without';
    it(`lists a commented atom by a hash (atoms ${how} their place)`, async () => {
      const atoms = await atomsOf(FILES, where, ['subagent']);
      const commented = atoms.find((atom) => atom.title.includes('ZZSECRETINLINEZZ'));
      const clean = atoms.find((atom) => atom.title === 'Lock the shed.');
      if (!commented || !clean) throw new Error('the atoms are missing');
      const bodies: string[] = [];
      const cassette = new Cassette();
      const labeler = createAnthropicLabeler({ key: 'k', runs: 1, fetch: choosing(bodies) });
      const first = await pointerScan({
        files: FILES,
        sets: HELPERS,
        labelling: singleLabelling(labeler),
        cassette,
        mode: 'record',
        atoms,
      });
      const request = bodies.join('\n');
      // The clean atom is listed exactly as before: its own id and its title, so a clean estate keeps its cassette.
      expect(request).toContain(`    ${clean.id}  Lock the shed.`);
      // The commented one is listed by a hash and with the comment replaced; neither its id nor its words appear.
      expect(request).not.toContain(commented.id);
      expect(request).toMatch(/ {4}atom-[0-9a-f]{10} {2}Hang the lamp \(comment\) before dusk\./);
      for (const needle of needlesOf('inline')) expect(request).not.toContain(needle);
      // The answer names the hash; the unit keeps a link to the atom's real id.
      expect(first.labelled.map((unit) => unit.links)).toEqual([[{ kind: 'dispatches', to: commented.id }]]);
      // A replay with no key reads the same cassette and reaches the same link.
      const replayed = await pointerScan({
        files: FILES,
        sets: HELPERS,
        labelling: singleLabelling(createAnthropicLabeler({ runs: 1 })),
        cassette,
        mode: 'replay',
        atoms,
      });
      expect(replayed.labelled.map((unit) => unit.links)).toEqual([
        [{ kind: 'dispatches', to: commented.id }],
      ]);
    });
  }

  it('withholds the title of an atom that begins inside a comment', async () => {
    const files = [{ path: 'tides.md', text: SPLIT }];
    const atoms = await atomsOf(files, true, ['subagent']);
    const tail = atoms.find(
      (atom) => atom.title.includes('ZZSECRETSPLITTWOZZ') && !atom.title.includes('<!--'),
    );
    expect(tail).toBeDefined();
    const bodies: string[] = [];
    await pointerScan({
      files,
      sets: HELPERS,
      labelling: singleLabelling(createAnthropicLabeler({ key: 'k', runs: 1, fetch: choosing(bodies) })),
      cassette: new Cassette(),
      mode: 'record',
      atoms,
    });
    const request = bodies.join('\n');
    expect(request).toMatch(/ {4}atom-[0-9a-f]{10} {2}\(title withheld: it holds a comment\)/);
    for (const name of ['splitone', 'splittwo', 'splitthree']) {
      for (const needle of needlesOf(name)) expect(request).not.toContain(needle);
    }
  });
});
