// No tracked text file names an operator's home folder. A path is written repo-relative, or with a
// placeholder: <repo> for the clone root, <home> for a home folder, <scratchpad> for a session scratch folder.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Account names that identify no person: generic CI and fixture accounts, and spelled-out placeholders. */
const PLACEHOLDER_USERS = new Set([
  'runner', // the GitHub-hosted runner account, in recorded CI logs
  'agent', // the estate fixture account
  'zzzz', // an already-masked name quoted from a public dataset
  'user',
  'username',
  'name',
  'you',
  'example',
]);

/**
 * Hash-bound files kept byte-exact: each one's sha256 is recorded in a seal or runtime freeze that
 * attests the code or data that ran, so a scrub would break that record. Each entry names one binding.
 */
const FROZEN: Record<string, string> = {
  'comparisons/ledger-hard/delivery.json': 'comparisons/ledger-hard/redaction-amendment.json digest map',
  'comparisons/ledger-hard/run.py': 'comparisons/ledger-hard/*/seal.json and transport-amendment.json',
  'comparisons/ledger-hard/score.py': 'comparisons/ledger-hard/flash-lite/seal.json and FINAL.md',
  'examples/ledger-verify/evidence/haiku-test-timeouts.json':
    'examples/ledger-verify/REPORT.md and evidence/cells.json',
  'examples/ledger-verify/haiku-test-timeout-transport.generated.ts':
    'examples/ledger-verify/evidence/haiku-test-timeout-execution.json',
  'examples/ledger-verify/lite-supervise.py': 'examples/ledger-verify/lite/evidence runtime freezes',
  'examples/ledger-verify/lite-transport.ts': 'examples/ledger-verify/lite/evidence/runtime-freeze.json',
  'examples/ledger-verify/lite/results/gemini-3.5-flash-lite.pre-test-network-recovery.json':
    'examples/ledger-verify/lite/evidence/test-recovery-amendment.json',
  'examples/ledger-verify/luna-addendum-transport.generated.ts':
    'examples/ledger-verify/luna-addendum/execution-freeze.json',
  'examples/ledger-verify/new-cell-supervise.py': 'examples/ledger-verify/sol61/evidence runtime freezes',
  'examples/ledger-verify/new-cell-transport.ts': 'examples/ledger-verify/sol61/evidence/runtime-freeze.json',
  'examples/ledger-verify/outage-transport.generated.ts':
    'examples/ledger-verify/evidence/haiku-outage-recovery.json',
  'examples/ledger-verify/publish_results.py':
    'examples/ledger-verify/evidence/publication-scan-amendment.json',
  'examples/ledger-verify/recover-lite-network.py': 'examples/ledger-verify/lite/evidence runtime freezes',
  'examples/ledger-verify/recover-lite-test-network.py':
    'examples/ledger-verify/lite/evidence runtime freezes',
  'examples/ledger-verify/supervise.py': 'examples/ledger-verify/evidence/runtime-freeze.json',
  'examples/ledger-verify/transport.ts': 'examples/ledger-verify/evidence/runtime-freeze.json and REPORT.md',
};

const NAME = '([A-Za-z0-9][A-Za-z0-9._-]*)';
const PATTERNS = [
  // /Users/<name>/ or /home/<name>/, not inside a URL path; JSON-escaped slashes are unescaped first.
  new RegExp(`(?<![A-Za-z0-9._-])/(?:Users|home)/${NAME}/`, 'g'),
  // C:\Users\<name>\, with single or escaped backslashes.
  new RegExp(`[A-Za-z]:(?:\\\\)+Users(?:\\\\)+${NAME}(?:\\\\)+`, 'g'),
  // A home folder flattened into one segment, as a Claude Code project folder is: /-Users-<name>-…
  new RegExp(`/-(?:Users|home)-${NAME.replace('._-', '._')}-`, 'g'),
];

/** The account names a text exposes, placeholders excluded. */
function hostUsers(text: string): string[] {
  const flat = text.replaceAll('\\/', '/');
  const users: string[] = [];
  for (const pattern of PATTERNS)
    for (const [, user = ''] of flat.matchAll(pattern))
      if (!PLACEHOLDER_USERS.has(user.toLowerCase())) users.push(user);
  return users;
}

/** Tracked text files that may hold a home-folder path; git grep narrows, hostUsers decides. */
function candidates(): string[] {
  const result = spawnSync('git', ['grep', '-lIz', '-e', 'Users', '-e', 'home', '--', '.'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  if (result.status !== 0 && result.status !== 1) throw new Error(`git grep failed: ${result.stderr}`);
  return result.stdout.split('\0').filter(Boolean);
}

describe('host paths', () => {
  it('finds a home folder with a user name in every spelling', () => {
    const who = ['jane', 'doe'].join('');
    expect(hostUsers(`cwd /Users/${who}/src/app`)).toEqual([who]);
    expect(hostUsers(`{"p":"\\/home\\/${who}\\/x"}`)).toEqual([who]);
    expect(hostUsers(`C:\\Users\\${who}\\repo`)).toEqual([who]);
    expect(hostUsers(`C:\\\\Users\\\\${who}\\\\repo`)).toEqual([who]);
    expect(hostUsers(`/tmp/claude-501/-Users-${who}-Documents-x/s`)).toEqual([who]);
  });

  it('allows placeholders, generic accounts and URL paths', () => {
    expect(hostUsers('<home>/.local/bin/claude and <repo>/node_modules')).toEqual([]);
    expect(hostUsers('/Users/<user>/x and /home/$USER/x and ~/x')).toEqual([]);
    expect(hostUsers('/home/runner/work/driftbench and /home/agent/.claude')).toEqual([]);
    expect(hostUsers('https://example.com/home/docs/page')).toEqual([]);
  });

  it('no tracked text file holds one outside the frozen list', () => {
    const found: string[] = [];
    for (const file of candidates()) {
      if (file in FROZEN) continue;
      const users = hostUsers(readFileSync(join(root, file), 'utf8'));
      if (users.length) found.push(`${file}: ${users.length} home-folder path(s)`);
    }
    expect(found).toEqual([]);
  });

  it('every frozen file still needs its exemption', () => {
    const stale = Object.keys(FROZEN).filter(
      (file) => hostUsers(readFileSync(join(root, file), 'utf8')).length === 0,
    );
    expect(stale).toEqual([]);
  });
});
