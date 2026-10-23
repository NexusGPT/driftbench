import { basename } from 'node:path';
import { READER_SHAPES } from '../../src/scan/claude-code';
import type { FileClassifier } from '../../src/scan/profile-classify';
import type { FileKind } from '../../src/scan/reader';

/**
 * The Claude Code reader's classification as it was on release/next at 6f0361e94, before the reader read through
 * the profile's part types: `STANDING` and `SETTINGS` as written at lines 57 and 58 of
 * `packages/estate/src/scan/claude-code.ts`, `classify` as written at its lines 890 to 908, and the nested standing
 * name of its line 512. Copied verbatim and frozen: the equality test reads every fixture estate through this and
 * through the profile, and diffs the two. The three structure tests are the reader's own, unchanged by the move.
 */

const STANDING = new Set(['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']);
const SETTINGS = new Set(['.claude/settings.json', '.claude/settings.local.json']);

const isStepList = (text: string, path: string) => READER_SHAPES['step-list']?.(text, path) === true;
const isCatalogue = (text: string, path: string) => READER_SHAPES.catalogue?.(text, path) === true;
const structuredRegistry = (text: string, path: string) =>
  READER_SHAPES['check-table']?.(text, path) === true;

function classify(path: string, text: string): { kind: FileKind; owner?: string } {
  if (STANDING.has(path) || /(?:^|\/)(?:CLAUDE|CLAUDE\.local)\.md$/.test(path)) return { kind: 'standing' };
  if (SETTINGS.has(path)) return { kind: 'settings' };
  const parts = path.split('/');
  if (parts[1] === 'memory' && path.endsWith('.md')) return { kind: 'memory' };
  if (parts[1] === 'skills' && parts.length >= 4) {
    const owner = parts[2] ?? '';
    return parts.length === 4 && parts[3] === 'SKILL.md'
      ? { kind: 'skill', owner }
      : { kind: 'skill_file', owner };
  }
  if (parts[1] === 'agents' && parts.length >= 3 && path.endsWith('.md')) return { kind: 'subagent' };
  if (/registry|catalogu?e?/i.test(basename(path)) && /\.(md|json|ya?ml)$/.test(path))
    return { kind: 'registry' };
  if (/\.(jsonc?|ya?ml)$/.test(path) && isStepList(text, path)) return { kind: 'step_list' };
  if (path.endsWith('.json') && isCatalogue(text, path)) return { kind: 'registry' };
  if (/\.(jsonc?|ya?ml)$/.test(path) && structuredRegistry(text, path)) return { kind: 'registry' };
  return { kind: 'other' };
}

export const LEGACY_CLASSIFIER: FileClassifier = {
  classify,
  besideLayout: (path) => /^CLAUDE(?:\.local)?\.md$/.test(basename(path)),
};
