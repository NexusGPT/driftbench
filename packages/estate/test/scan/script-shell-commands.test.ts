import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { COMMAND_SCRIPTS, SCRIPT_COMMANDS } from './script-command-corpus';

const folder = '.claude/skills/parcels';
const definition = `${folder}/SKILL.md`;

describe('script anchors follow shell command structure', () => {
  it.each(SCRIPT_COMMANDS)('$kind: $line', async ({ line, runs }) => {
    const root = await estate({
      [definition]: `---\nname: parcels\n---\n${line}\n`,
      ...Object.fromEntries(COMMAND_SCRIPTS.map((path) => [`${folder}/${path}`, '# fictional script\n'])),
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const scripts = map.atoms.filter((atom) => atom.kind === 'script');
    expect(scripts).toHaveLength(COMMAND_SCRIPTS.length);
    for (const path of COMMAND_SCRIPTS) {
      const atom = scripts.find((entry) => entry.fields?.path === `${folder}/${path}`);
      const invoked = (runs as readonly string[]).includes(path);
      expect(atom?.fields?.named, path).toBe(invoked);
      expect(atom?.provenance.file, path).toBe(invoked ? definition : `${folder}/${path}`);
      if (invoked) expect(atom?.provenance).toMatchObject({ startLine: 4, quote: line });
    }
  });
});
