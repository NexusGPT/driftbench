import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const SETTINGS = '.claude/settings.json';

async function read(settings: string) {
  const root = await estate({ 'CLAUDE.md': '# Rules\n', [SETTINGS]: settings });
  return { root, raw: await new ClaudeCodeReader().read(root) };
}

describe('hooks the settings declare in a shape the reader does not run', () => {
  it('notes an event whose hooks are an object, not a list', async () => {
    const { raw } = await read('{\n  "hooks": { "Stop": { "type": "command", "command": "x.sh" } }\n}\n');
    expect(raw.guards).toEqual([]);
    expect(raw.notes).toEqual([
      { file: SETTINGS, message: 'the hooks of Stop are not a list of matcher groups: not read' },
    ]);
  });

  it('notes a hooks key that is no mapping and a group without a hooks list', async () => {
    const list = await read('{ "hooks": ["x.sh"] }');
    expect(list.raw.notes.map((note) => note.message)).toEqual([
      'hooks is not a mapping from an event to its matcher groups: not read',
    ]);
    const group = await read('{ "hooks": { "Stop": [ { "type": "command", "command": "x.sh" } ] } }');
    expect(group.raw.guards).toEqual([]);
    expect(group.raw.notes.map((note) => note.message)).toEqual([
      'a matcher group of Stop holds no hooks list: not read',
    ]);
  });

  it('reads a hook of type prompt as a guard with no script', async () => {
    const { root, raw } = await read(
      '{\n  "hooks": {\n    "Stop": [ { "hooks": [ { "type": "prompt", "prompt": "Check the reply." } ] } ]\n  }\n}\n',
    );
    expect(raw.notes).toEqual([]);
    expect(raw.guards).toHaveLength(1);
    expect(raw.guards[0]).toMatchObject({
      event: 'Stop',
      command: 'Check the reply.',
      type: 'prompt',
      anchored: true,
      at: { startLine: 3 },
    });
    expect(raw.guards[0]?.script).toBeUndefined();
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const guard = map.atoms.find((atom) => atom.kind === 'guard');
    expect(guard?.fields).toMatchObject({ event: 'Stop', type: 'prompt', name: 'check-the-reply' });
    expect(guard?.fields?.script).toBeUndefined();
  });

  it('notes a hook of a type it cannot read, and still reads the command beside it', async () => {
    const { raw } = await read(
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: 'http', url: 'http://localhost:1' },
                { type: 'command', command: 'x.sh' },
              ],
            },
          ],
        },
      }),
    );
    expect(raw.guards.map((guard) => guard.command)).toEqual(['x.sh']);
    expect(raw.notes.map((note) => note.message)).toEqual(['a Stop hook of type http is not read']);
  });
});
