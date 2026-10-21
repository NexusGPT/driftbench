// A driftbench plugin: it registers the `claude-code` adapter for `campaign run`, so a campaign can drive the
// live Claude Code runtime on the Northwind fixture estate. `estate run` is the only built-in way to reach that
// runtime; it has no personas, no parent blocks and no diagnostics, which this campaign needs.
//
// Settings come from the environment, so the workflow and a person set them the same way:
//   NORTHWIND_COMMAND        the headless runtime: `claude`, or a stand-in file. Default: the fake runtime of
//                            this campaign's protocol recording (no model call, no cost).
//   NORTHWIND_ALLOW_BILLED   `1` lets a command that is not a stand-in run. It is billed.
//   NORTHWIND_MODEL          passed as --model (the fixture's own setting names opus).
//   NORTHWIND_MAX_TURNS      passed as --max-turns.
//   NORTHWIND_MAX_BLOCK_USD  passed as --max-budget-usd: the most one block may spend.
//   NORTHWIND_PERMISSION_MODE  passed as --permission-mode, such as acceptEdits (edits and writes need no prompt).
//   NORTHWIND_ESTATE         the estate folder. Default: examples/estates/fixture.
import { open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeCodeLiveAdapter } from '@agent-nexus/driftbench-adapters';
import { parseShell } from '@agent-nexus/driftbench-checks';
import { machineVerdict } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAND_IN_MARKER = '@driftbench-stand-in';

/** True when the first lines of the command file carry the stand-in marker. A bare command name never does. */
async function isStandIn(path) {
  if (!path.includes('/')) return false;
  const handle = await open(path, 'r').catch(() => undefined);
  if (handle === undefined) return false;
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(2048), 0, 2048, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').includes(STAND_IN_MARKER);
  } finally {
    await handle.close();
  }
}

/** Keep command words and comments distinct; admit only simple commands joined by &&. */
function withoutComments(line) {
  let result = '';
  let unsupported = false;
  let andCount = 0;
  let quote;
  let boundary = true;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\' && quote !== "'" && index + 1 < line.length) {
      result += char + line[++index];
      boundary = false;
      continue;
    }
    if ((char === '$' || char === '`') && quote !== "'") unsupported = true;
    if (quote !== undefined) {
      result += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '#' && boundary) {
      while (index < line.length && line[index] !== '\n') index += 1;
      result += '\n';
      boundary = true;
      continue;
    }
    if (char === '&' && line[index + 1] === '&') {
      result += '&&';
      index += 1;
      andCount += 1;
      boundary = true;
      continue;
    }
    if (/[;|()<>&]/.test(char)) unsupported = true;
    result += char;
    if (char === "'" || char === '"') quote = char;
    boundary = /[\s;&|()<>]/.test(char);
  }
  return { text: result, unsupported, andCount };
}

function reconcilePath(path) {
  const normalized = posix.normalize(path);
  return normalized === 'scripts/reconcile.py' ||
    normalized === '.claude/skills/invoice-reconcile/scripts/reconcile.py' ||
    normalized.endsWith('/.claude/skills/invoice-reconcile/scripts/reconcile.py');
}

/** A script is executed as the program itself or as Python's script operand, never as command data. */
function invokesReconcile(line) {
  const shell = withoutComments(line);
  if (shell.unsupported) return false;
  const parsed = parseShell(shell.text);
  // No empty chain member or additional newline command may hide in the flattened parser output.
  if (parsed.unknown || parsed.commands.length !== shell.andCount + 1) return false;
  // Only the first simple command is unconditional. A later && member may never execute.
  const words = parsed.commands[0] ?? [];
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? '')) index += 1;
  const program = words[index++];
  if (program === undefined) return false;
  if (reconcilePath(program)) return true;
  if (!/^python(?:3(?:\.\d+)?)?$/.test(basename(program))) return false;
  for (; index < words.length; index += 1) {
    const word = words[index];
    if (word === '--') return reconcilePath(words[index + 1] ?? '');
    if (!word.startsWith('-')) return reconcilePath(word);
    // These no-operand Python flags keep the next non-option word in the script position.
    // Code/module modes and options with operands are deliberately unsupported, hence cannot count.
    if (!/^-[IBEOqsSuvx]+$/.test(word)) return false;
  }
  return false;
}

/** Enforce the skill prerequisite across turns, and require actual reconciliation in its named block. */
export function invoicePrerequisite(ctx) {
  let read = false;
  let reconciles = 0;
  const missing = [];
  for (const block of [...ctx.history, { observed: ctx.observed }]) {
    for (const call of block.observed.toolCalls) {
      const path = call.input?.file_path;
      if (
        call.label === 'Read' &&
        call.error === undefined &&
        typeof path === 'string' &&
        /(?:^|\/)invoice-reconcile\/references\/matching-rules\.md$/.test(path)
      )
        read = true;
      if (
        call.label !== 'Bash' ||
        typeof call.input?.command !== 'string' ||
        !invokesReconcile(call.input.command)
      )
        continue;
      if (block.observed !== ctx.observed) continue;
      reconciles += 1;
      if (!read) missing.push(call.input.command);
    }
  }
  if (reconciles === 0 && ctx.block.id !== 'reconcile') return [];
  const pass = reconciles > 0 && missing.length === 0;
  return [
    machineVerdict(
      'northwind-invoice-prerequisite',
      'read-before-reconcile',
      pass ? 'pass' : 'fail',
      reconciles === 0
        ? 'The reconcile block did not invoke scripts/reconcile.py.'
        : missing.length > 0
          ? `${missing.length} reconcile invocation(s) had no successful matching-rules read before them.`
          : `Every reconcile invocation (${reconciles}) has a successful matching-rules read before it, in this block or its history.`,
    ),
  ];
}

export default async function plugin(api) {
  api.check('northwind-invoice-prerequisite', invoicePrerequisite);
  const estateRoot = resolve(process.env.NORTHWIND_ESTATE ?? resolve(HERE, '../estates/fixture'));
  const configured = process.env.NORTHWIND_COMMAND ?? resolve(HERE, 'rehearsal/claude.mjs');
  const command = configured.includes('/') ? resolve(configured) : configured;
  const standIn = await isStandIn(command);
  if (!standIn && process.env.NORTHWIND_ALLOW_BILLED !== '1') {
    throw new Error(
      `${configured} is not a stand-in: a live run is billed. Set NORTHWIND_ALLOW_BILLED=1 to run it.`,
    );
  }
  const args = [];
  if (process.env.NORTHWIND_PERMISSION_MODE) {
    args.push('--permission-mode', process.env.NORTHWIND_PERMISSION_MODE);
  }
  if (process.env.NORTHWIND_MODEL) args.push('--model', process.env.NORTHWIND_MODEL);
  if (process.env.NORTHWIND_MAX_TURNS) args.push('--max-turns', process.env.NORTHWIND_MAX_TURNS);
  if (process.env.NORTHWIND_MAX_BLOCK_USD) {
    args.push('--max-budget-usd', process.env.NORTHWIND_MAX_BLOCK_USD);
  }

  const settings = JSON.parse(await readFile(join(estateRoot, '.claude/settings.json'), 'utf8'));
  args.push(
    '--allowed-tools',
    ...settings.permissions.allow,
    'Skill',
    'Bash(.claude/skills/shipment-tracker/scripts/track.sh *)',
  );
  const instructions = await readFile(new URL('./agent/CLAUDE.local.md', import.meta.url), 'utf8');

  // Every target `claude-code:northwind` reaches the live runtime in a sandbox that holds a copy of the estate.
  api.adapter('claude-code', (target) => {
    if (target.agent !== 'northwind') return undefined;
    return claudeCodeLiveAdapter({
      command,
      args,
      estateRoot,
      provider: localProvider(),
      config: 'isolated',
      ...(standIn || process.env.ANTHROPIC_API_KEY === undefined
        ? {}
        : { env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } }),
      lock: { deny: [join(homedir(), '.nexus-secrets')] },
      // `args` carries the estate allow-list plus only the exact tracker command this harness needs.
      trustEstate: false,
      workspace: { files: { 'CLAUDE.local.md': instructions } },
      // Lets the parent-linked spec run: a continuation resumes the parent's turns and starts from its files.
      branching: true,
      ...(standIn ? { retries: { backoffMs: 0 } } : {}),
    });
  });
}
