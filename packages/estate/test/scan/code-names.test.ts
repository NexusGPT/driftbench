import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const settings = JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 .claude/hooks/gate.py' }] }],
  },
});

async function lint(files: Record<string, string>) {
  const root = await estate(files);
  const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return { map, raw, result: lintEstate(map, raw) };
}

describe('files that code and registries name', () => {
  it('counts a file a script names as named and reachable, and leaves an unnamed neighbour a finding', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py':
        'import json\nREQUEST = "judges/check.request.json"\nSTATE = ".claude/hooks/state/seen.json"\n',
      '.claude/hooks/judges/check.request.json': '{"ask": "x"}\n',
      '.claude/hooks/judges/other.request.json': '{"ask": "y"}\n',
    });
    const subjects = result.findings
      .filter((finding) => finding.code === 'ORPHAN' || finding.code === 'UNREACHABLE')
      .map((finding) => `${finding.code} ${finding.subject}`);
    expect(subjects).toEqual(['ORPHAN .claude/hooks/judges/other.request.json']);
  });

  it('does not let a stray script that nothing names legitimise the files it mentions', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py': 'print("ok")\n',
      '.claude/hooks/old-tool.py': 'LOG = "stale-notes.json"\n',
      '.claude/hooks/stale-notes.json': '{}\n',
    });
    expect(
      result.findings
        .filter((finding) => finding.code === 'ORPHAN')
        .map((finding) => finding.subject)
        .sort(),
    ).toEqual(['.claude/hooks/old-tool.py', '.claude/hooks/stale-notes.json']);
  });

  it('does not report a runtime product named by code as a missing file, and still reports an unnamed one', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\nRead `.claude/guide.md`.\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py': 'MARKER = ".claude/hooks/state/compacted.json"\n',
      '.claude/guide.md':
        '# Guide\nAfter a restart, read `.claude/hooks/state/compacted.json`.\nRead `.claude/hooks/state/never-made.md`.\n',
    });
    const missing = result.findings.filter((finding) => finding.code === 'MISSING_REFERENCE');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('never-made.md');
  });

  it('does not let a bare file name in code hide an ambiguous or unrelated missing reference', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\nRead `README.md` first.\nRead `.claude/missing-guide.md`.\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py': 'NAMES = ["README.md", "missing-guide.md"]\n',
      '.claude/a/README.md': '# A\n',
      '.claude/b/README.md': '# B\n',
    });
    expect(result.counts.AMBIGUOUS_REFERENCE).toBe(1);
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });

  it('keeps a file nothing names an orphan when only prose in a navigation document mentions its folder', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\n',
      '.claude/settings.json': settings,
      '.claude/hooks/gate.py': 'print("ok")\n',
      '.claude/hooks/state/stray.json': '{}\n',
    });
    expect(
      result.findings.filter((finding) => finding.code === 'ORPHAN').map((finding) => finding.subject),
    ).toEqual(['.claude/hooks/state/stray.json']);
  });
});

describe('counter-examples and fill-in values are not live references', () => {
  it('blanks a wrong example up to its right counterpart and keeps the live part of the line', async () => {
    const { map, result } = await lint({
      'CLAUDE.md':
        '# Rules\n✗ read `old/gone.md` → ✓ read `.claude/live.md`.\nWRONG: read `old/gone-two.md`.\n- Right: read `.claude/live.md`.\n',
      '.claude/live.md': '# Live\n',
    });
    expect(result.counts.MISSING_REFERENCE).toBe(0);
    expect(map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path)).toEqual([
      '.claude/live.md',
      '.claude/live.md',
    ]);
  });

  it('treats a block after a standalone wrong marker as an example', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\n\n✗\n\n> Read `old/gone.md` first.\n\nRead `real-missing/guide.md` first.\n',
    });
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });

  it('does not report a bracketed, doubled-letter or format-specifier path as missing', async () => {
    const { result } = await lint({
      'CLAUDE.md':
        '# Rules\nRead `logs/[session]/out.md`.\nRead `notes/YYYY-MM-DD.md`.\nRead `runs/XXX/report.md`.\nRead `notes/%s.md`.\nRead `real-missing/guide.md`.\n',
    });
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });
});

describe('reach by dispatch', () => {
  it('reaches a helper dispatched from a live skill', async () => {
    const { result } = await lint({
      'CLAUDE.md': '# Rules\nRead `.claude/skills/editor/SKILL.md`.\n',
      '.claude/skills/editor/SKILL.md':
        '---\nname: editor\ndescription: Edit pages.\n---\n# Editing\nDispatch the `reviewer` agent after each edit.\n',
      '.claude/agents/reviewer.md':
        '---\nname: reviewer\ndescription: Reviews pages.\n---\n# Reviewer\nCheck the page.\n',
    });
    expect(result.findings.filter((finding) => finding.code === 'UNREACHABLE')).toEqual([]);
  });
});

describe('a sentence is not a path', () => {
  it('reads a long quoted sentence ending in a quote mark as no reference and does not crash the scan', async () => {
    const sentence = `Items that say ${'do exactly what they will do '.repeat(14)}instead of 'Footnote 3.'`;
    const { result } = await lint({
      'CLAUDE.md': `# Rules\nRead "${sentence}" before editing.\nRead \`real-missing/guide.md\`.\n`,
    });
    expect(result.counts.MISSING_REFERENCE).toBe(1);
  });

  it('quotes a hazard line as written when a counter-example on the same line is masked', async () => {
    const { map } = await lint({
      'CLAUDE.md':
        '# Rules\n✗ ignore the repeated guard nudges and read `old/gone.md` → ✓ after a compaction, stop and recover from repeated guard nudges.\n',
    });
    const hazard = map.atoms.find((atom) => atom.kind === 'hazard');
    expect(hazard?.provenance.quote).toContain('✗ ignore the repeated guard nudges');
  });
});
