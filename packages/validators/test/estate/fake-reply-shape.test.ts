import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const REGISTER = 'register.ledger-auditor.answer-with-one-json-object-and';
const ASK = 'Audit ledger/2026-W41.csv for double payments and unapproved credit notes. Answer with one JSON object.';
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The closing reply of the stand-in agent, with a map whose register declares the shape, in an estate copy. */
async function reply(options: { withoutRegister?: boolean }): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-shape-'));
  folders.push(cwd);
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  const map = parse(readFileSync(join(FIXTURE, 'approved.yaml'), 'utf8')) as {
    atoms: Array<{ id: string; fields?: Record<string, unknown>; provenance: { file: string; quote: string } }>;
  };
  const atom = map.atoms.find((candidate) => candidate.id === REGISTER);
  if (!atom) throw new Error(`the fixture holds no ${REGISTER}`);
  atom.fields = { ...atom.fields, replyShape: 'json_only' };
  const mapPath = join(cwd, 'shape-map.yaml');
  writeFileSync(mapPath, stringify(map));
  if (options.withoutRegister) {
    const file = join(cwd, atom.provenance.file);
    writeFileSync(file, readFileSync(file, 'utf8').replace(atom.provenance.quote, ''));
  }
  const agent = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  const out = agent.planStream({
    ask: ASK,
    cwd,
    sessionId: 'test',
    env: { ...process.env, FAKE_MAP: mapPath, FAKE_PHRASES: join(FIXTURE, 'phrases.yaml') },
  });
  const texts = (out.records as Array<{ message?: { content?: Array<{ type?: string; text?: string }> } }>).flatMap(
    (record) => (record.message?.content ?? []).filter((item) => item.type === 'text').map((item) => item.text ?? ''),
  );
  return texts.at(-1) ?? '';
}

describe('the stand-in agent answers in the shape a reply rule in force declares', () => {
  it('answers one JSON object when the register that declares json_only is in force', async () => {
    expect(() => JSON.parse(reply_(await reply({})))).not.toThrow();
  });

  it('answers in prose when that register is gone from the estate copy', async () => {
    expect(() => JSON.parse(reply_(await reply({ withoutRegister: true })))).toThrow();
  });
});

const reply_ = (text: string) => text;
