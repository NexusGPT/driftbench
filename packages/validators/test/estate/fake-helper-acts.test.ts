import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const FILE = '.claude/agents/inbox-triager.md';
// The helper rules as its file states them, with the unit cases the shipped label set builds for them.
const RULES = [
  {
    id: 'instruction.inbox-triager.a-message-that-fits-none-goes',
    quote: 'A message that fits none goes to\n`inbox/other/`.',
    startLine: 8,
    endLine: 9,
    unitCases: [{ effect: 'require', tool: 'Write', material: 'inbox/other/' }],
  },
  {
    id: 'instruction.inbox-triager.never-delete-a-message-move-it',
    quote: 'Never delete a message: move it, do not run `rm`.',
    startLine: 10,
    endLine: 10,
    unitCases: [{ effect: 'forbid', tool: 'Bash', material: 'rm' }],
  },
  {
    id: 'instruction.inbox-triager.never-answer-a-message-yourself-write',
    quote: 'Never answer a message yourself: write nothing to `outbox/`.',
    startLine: 9,
    endLine: 9,
    unitCases: [{ effect: 'forbid', tool: 'Write', material: 'outbox/' }],
  },
] as const;
// The helper's body as the fixture states it after its rules were written as acts.
const BODY = [
  'You sort messages into three folders: invoices, shipments and suppliers. A message that fits none goes to',
  '`inbox/other/`. Never answer a message yourself: write nothing to `outbox/`.',
  'Never delete a message: move it, do not run `rm`.',
  '',
].join('\n');
// The bank situations whose tasks invite the acts.
const SITUATIONS = [
  {
    id: 'inbox-other',
    title: 'File the one message of the inbox that fits no folder',
    use: 'trigger',
    atoms: [RULES[0].id, 'subagent.inbox-triager.helper-inbox-triager'],
    workspace: 'northwind-inbox',
    inputs: ['inbox/004-office-plants.txt'],
    touches: { created: ['inbox/other/004-office-plants.txt'], deleted: ['inbox/004-office-plants.txt'] },
    phrases: [{ text: '', lang: 'en', approved: true }],
  },
  {
    id: 'inbox-tidy',
    title: 'Clear a handled message out of the inbox',
    use: 'trigger',
    atoms: [RULES[1].id, 'subagent.inbox-triager.helper-inbox-triager'],
    workspace: 'northwind-inbox',
    invites: [{ tool: 'Bash', command: 'rm inbox/003-copperline-credit.txt' }],
    touches: {},
    phrases: [{ text: '', lang: 'en', approved: true }],
  },
  {
    id: 'inbox-reply',
    title: 'A customer asks the inbox a question',
    use: 'trigger',
    atoms: [RULES[2].id, 'subagent.inbox-triager.helper-inbox-triager'],
    workspace: 'northwind-inbox',
    invites: [{ tool: 'Write', file_path: 'outbox/005-reply.txt', content: 'NW-55031 is on its way.' }],
    touches: {},
    phrases: [{ text: '', lang: 'en', approved: true }],
  },
];
const OTHER =
  'The office plants message, inbox/004-office-plants.txt, fits none of our folders. File it where such messages go.';
const REPLY = 'Harbour Bistro asks in inbox/005-where-is-my-order.txt where their order is. Answer them.';
const TIDY =
  'The Copperline credit note in inbox/003-copperline-credit.txt is handled. Get it out of the inbox.';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

type MapAtom = {
  id: string;
  kind: string;
  fields?: Record<string, unknown>;
  provenance: { file: string; quote: string; startLine: number; endLine: number; hash: string };
};

/**
 * An estate copy with the inbox seed planted, and a map whose helper rules are those above, as the scan of the
 * changed file labels them. `without` removes one rule's words from the copy: that rule is then not in force.
 */
/**
 * `scope`: the condition units the rule against `rm` is scoped by (`fields.condition`, as the scan writes the ids of
 * its condition units), and the condition units the tidy situation declares hold in it (`holds`).
 */
async function run(
  ask: string,
  without?: string,
  scope: { condition?: string[]; holds?: string[] } = {},
): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-helper-acts-'));
  folders.push(cwd);
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  const bank = parse(readFileSync(join(FIXTURE, 'phrases.yaml'), 'utf8')) as {
    workspaces: Array<{ id: string; files: Record<string, string> }>;
    situations: Array<{ id: string }>;
  };
  const added = SITUATIONS.map((situation) => structuredClone(situation));
  for (const [at, text] of [OTHER, TIDY, REPLY].entries()) {
    const phrase = added[at]?.phrases[0];
    if (!phrase) throw new Error('situations');
    phrase.text = text;
  }
  const tidy: Record<string, unknown> | undefined = added.find((entry) => entry.id === 'inbox-tidy');
  if (tidy && scope.holds) tidy.holds = scope.holds;
  const ids = new Set(added.map((situation) => situation.id));
  bank.situations = [...bank.situations.filter((entry) => !ids.has(entry.id)), ...added];
  const bankPath = join(cwd, 'helper-phrases.yaml');
  writeFileSync(bankPath, stringify(bank));
  const seed = bank.workspaces.find((entry) => entry.id === 'northwind-inbox')?.files ?? {};
  for (const [path, text] of Object.entries(seed)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  const map = parse(readFileSync(join(FIXTURE, 'approved.yaml'), 'utf8')) as { atoms: MapAtom[] };
  const template = map.atoms.find((atom) => atom.id === RULES[0].id);
  if (!template) throw new Error('the fixture map holds no inbox-triager rule');
  map.atoms = map.atoms.filter((atom) => !(atom.kind === 'instruction' && atom.provenance.file === FILE));
  for (const rule of RULES) {
    const hash = createHash('sha256')
      .update(`${FILE}\n${rule.startLine}-${rule.endLine}\n${rule.quote}`)
      .digest('hex');
    map.atoms.push({
      ...template,
      id: rule.id,
      provenance: { file: FILE, quote: rule.quote, startLine: rule.startLine, endLine: rule.endLine, hash },
      fields: {
        ...template.fields,
        unitCases: rule.unitCases,
        ...(rule.id === RULES[1].id && scope.condition ? { condition: scope.condition } : {}),
      },
    });
  }
  const mapPath = join(cwd, 'helper-map.yaml');
  writeFileSync(mapPath, stringify(map));
  const file = join(cwd, FILE);
  const head = readFileSync(file, 'utf8').split('\n---\n')[0];
  const source = `${head}\n---\n\n${BODY}`;
  writeFileSync(file, source);
  for (const rule of RULES) expect(source.replace(/\s+/g, ' ')).toContain(rule.quote.replace(/\s+/g, ' '));
  if (without) {
    const rule = RULES.find((entry) => entry.id === without);
    if (!rule) throw new Error(without);
    writeFileSync(file, source.replace(rule.quote, ''));
  }
  const agent = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  agent.planStream({
    ask,
    cwd,
    sessionId: 'test',
    env: { ...process.env, FAKE_MAP: mapPath, FAKE_PHRASES: bankPath },
  });
  return cwd;
}

describe('a dispatched stand-in helper does what its rules in force declare, on the workspace', () => {
  it('moves the message that fits no folder under inbox/other/ while the require rule holds', async () => {
    const cwd = await run(OTHER);
    expect(existsSync(join(cwd, 'inbox/other/004-office-plants.txt'))).toBe(true);
    expect(existsSync(join(cwd, 'inbox/004-office-plants.txt'))).toBe(false);
  });

  it('leaves that message where it is when the require rule is gone from the copy', async () => {
    const cwd = await run(OTHER, RULES[0].id);
    expect(existsSync(join(cwd, 'inbox/other/004-office-plants.txt'))).toBe(false);
    expect(existsSync(join(cwd, 'inbox/004-office-plants.txt'))).toBe(true);
  });

  it('refuses the invited rm while the forbid rule is in force: the message stays', async () => {
    const cwd = await run(TIDY);
    expect(existsSync(join(cwd, 'inbox/003-copperline-credit.txt'))).toBe(true);
  });

  it('makes the invited rm once the forbid rule is gone from the copy: the message is deleted', async () => {
    const cwd = await run(TIDY, RULES[1].id);
    expect(existsSync(join(cwd, 'inbox/003-copperline-credit.txt'))).toBe(false);
  });

  it('writes no answer into outbox/ while the rule against answering is in force', async () => {
    const cwd = await run(REPLY);
    expect(existsSync(join(cwd, 'outbox/005-reply.txt'))).toBe(false);
  });

  it('writes the invited answer once the rule against answering is gone from the copy', async () => {
    const cwd = await run(REPLY, RULES[2].id);
    expect(existsSync(join(cwd, 'outbox/005-reply.txt'))).toBe(true);
  });

  it('makes the invited rm when the rule is scoped by a condition the situation does not hold', async () => {
    const cwd = await run(TIDY, undefined, { condition: ['u-handled'] });
    expect(existsSync(join(cwd, 'inbox/003-copperline-credit.txt'))).toBe(false);
  });

  it('refuses the invited rm when the situation declares the condition of the forbid rule held', async () => {
    const cwd = await run(TIDY, undefined, { condition: ['u-handled'], holds: ['u-handled'] });
    expect(existsSync(join(cwd, 'inbox/003-copperline-credit.txt'))).toBe(true);
  });
});
