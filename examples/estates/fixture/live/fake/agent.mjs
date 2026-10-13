/**
 * The fake's agent for an ask its manifest names no stream for: a stream derived by code from the estate it
 * is given, nothing else. It reads the copy in its working folder (the standing file, the skills, the helpers,
 * the settings and the step list), routes the ask by the words it shares with a routing row or a unit's
 * description, and does what the unit and the estate say: load the skill, read the files its body names,
 * dispatch the helpers it names, run the command its body names and the command the ask spells out, read a
 * file before editing it when a standing rule says so, edit the file the ask names, walk the step list, and run every hook the settings
 * declare on each of its tool calls, as the runtime would. It knows nothing of any test, plan row or mutant:
 * what changes its stream is only what the copy says. No model, no cost, fictional data only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STOP = new Set(
  'the and for with that this from into your you are can what which when where who how please just tell give make sure about them they their there here have has had will would could should than then also only each every some any one two all not but our its it'.split(
    ' ',
  ),
);

const words = (text) =>
  new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP.has(word))
      // One stem for a word and its plural or third person: sort, sorts.
      .map((word) => (word.length > 4 ? word.replace(/(?:es|s)$/, '') : word)),
  );

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

/** A frontmatter's top-level scalar fields and the body after it. */
function frontmatter(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return { fields: {}, body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return { fields: {}, body: text };
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

function readEstate(cwd) {
  const standing = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']
    .map((path) => read(join(cwd, path)) ?? '')
    .join('\n');
  const skills = [];
  const skillsDir = join(cwd, '.claude', 'skills');
  if (existsSync(skillsDir)) {
    for (const folder of readdirSync(skillsDir).sort()) {
      const text = read(join(skillsDir, folder, 'SKILL.md'));
      if (text === undefined) continue;
      const { fields, body } = frontmatter(text);
      skills.push({
        kind: 'skill',
        name: folder,
        folder: `.claude/skills/${folder}`,
        description: fields.description ?? '',
        body,
      });
    }
  }
  const helpers = [];
  const agentsDir = join(cwd, '.claude', 'agents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).sort()) {
      if (!file.endsWith('.md')) continue;
      const { fields, body } = frontmatter(read(join(agentsDir, file)) ?? '');
      helpers.push({
        kind: 'helper',
        name: fields.name || file.replace(/\.md$/, ''),
        description: fields.description ?? '',
        body,
      });
    }
  }
  let settings = {};
  try {
    settings = JSON.parse(read(join(cwd, '.claude', 'settings.json')) ?? '{}');
  } catch {
    settings = {};
  }
  let steps = [];
  try {
    steps = JSON.parse(read(join(cwd, '.claude', 'steps.json')) ?? '{}').steps ?? [];
  } catch {
    steps = [];
  }
  return { standing, skills, helpers, settings, steps };
}

/** Rows of the standing file's tables that name a unit: the ask cell and the unit. */
function routingRows(standing, units) {
  const rows = [];
  for (const line of standing.split('\n')) {
    if (!line.includes('|')) continue;
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell !== '');
    if (cells.length < 2) continue;
    for (const unit of units) {
      const named = cells.findIndex((cell) => cell.replace(/[`*]/g, '').includes(unit.name));
      if (named < 0) continue;
      const ask = cells.filter((_, index) => index !== named).join(' ');
      if (/\b(never|not)\b/i.test(cells[named] ?? '')) continue;
      rows.push({ unit, ask });
    }
  }
  return rows;
}

/** The unit an ask goes to: the most words shared with a routing row or a description, at least two. */
function route(ask, estate) {
  const units = [...estate.skills, ...estate.helpers];
  const asked = words(ask);
  const shared = (text) => [...words(text)].filter((word) => asked.has(word)).length;
  let best;
  let score = 1;
  for (const unit of units) {
    const own = Math.max(
      shared(unit.description),
      ...routingRows(estate.standing, units)
        .filter((row) => row.unit === unit)
        .map((row) => shared(row.ask)),
    );
    if (own > score) {
      best = unit;
      score = own;
    }
  }
  return best;
}

/** The step list in its order: from the stage no next enters, along the first next; anytime steps last. */
function walk(steps) {
  const flow = steps.filter((step) => step && !step.anytime && typeof step.id === 'string');
  const targets = new Set(flow.flatMap((step) => step.next ?? []));
  const order = [];
  let at = flow.find((step) => !targets.has(step.id)) ?? flow[0];
  while (at && !order.includes(at.id)) {
    order.push(at.id);
    const next = (at.next ?? []).find((id) => !order.includes(id));
    at = flow.find((step) => step.id === next);
  }
  for (const step of flow) if (!order.includes(step.id)) order.push(step.id);
  const anytime = steps.filter((step) => step?.anytime && typeof step.id === 'string').map((step) => step.id);
  return { order, anytime };
}

/** Whether a settings matcher covers a tool, as the runtime reads it: a pattern over the tool name. */
function covers(matcher, tool) {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return matcher === tool;
  }
}

/** Whether a permission rule of the settings denies a call. */
function denied(settings, tool, input) {
  const rules = settings?.permissions?.deny ?? [];
  return rules.some((rule) => {
    const match = /^([A-Za-z]+)(?:\((.*)\))?$/.exec(rule);
    if (!match || match[1] !== tool) return false;
    if (match[2] === undefined) return true;
    const pattern = match[2].replace(/:\*$/, '').replace(/\*$/, '');
    return typeof input.command === 'string' && input.command.trim().startsWith(pattern);
  });
}

export function planStream({ ask, cwd, sessionId, env }) {
  const estate = readEstate(cwd);
  const out = [];
  let id = 0;
  let blocked = false;
  const text = (value) =>
    out.push({
      type: 'assistant',
      message: {
        id: `msg_agent_${++id}`,
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        content: [{ type: 'text', text: value }],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      parent_tool_use_id: null,
    });

  /** Runs the hooks of an event for a tool call; true when one blocks it (exit 2 on a PreToolUse). */
  const hooks = (event, tool, payload) => {
    let block = false;
    for (const group of estate.settings?.hooks?.[event] ?? []) {
      if (!group || (tool !== undefined && !covers(group.matcher, tool))) continue;
      for (const hook of group.hooks ?? []) {
        if (hook?.type !== 'command' || typeof hook.command !== 'string') continue;
        const hookId = `hook_${++id}`;
        const name = tool === undefined ? event : `${event}:${tool}`;
        out.push({
          type: 'system',
          subtype: 'hook_started',
          hook_id: hookId,
          hook_name: name,
          hook_event: event,
        });
        const ran = spawnSync('/bin/sh', ['-c', hook.command], {
          cwd,
          input: `${JSON.stringify({ session_id: sessionId, cwd, hook_event_name: event, ...payload })}\n`,
          env: { ...env, CLAUDE_PROJECT_DIR: cwd },
          encoding: 'utf8',
          timeout: (hook.timeout ?? 60) * 1000,
        });
        const exit = ran.status ?? 1;
        out.push({
          type: 'system',
          subtype: 'hook_response',
          hook_id: hookId,
          hook_name: name,
          hook_event: event,
          stdout: ran.stdout ?? '',
          stderr: ran.stderr ?? '',
          exit_code: exit,
          outcome: exit === 0 ? 'success' : 'error',
        });
        if (exit === 2 && event === 'PreToolUse') block = true;
      }
    }
    return block;
  };

  /** A tool call as the runtime makes it: denied by a permission, blocked by a hook, else done. */
  const call = (tool, input, perform) => {
    if (denied(estate.settings, tool, input)) return undefined;
    const useId = `toolu_agent_${++id}`;
    out.push({
      type: 'assistant',
      message: {
        id: `msg_agent_${++id}`,
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        content: [{ type: 'tool_use', id: useId, name: tool, input }],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      parent_tool_use_id: null,
    });
    const stopped = hooks('PreToolUse', tool, { tool_name: tool, tool_input: input });
    const result = stopped ? { error: true, content: 'Blocked by a hook.' } : perform();
    out.push({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: useId,
            type: 'tool_result',
            content: result.content,
            ...(result.error ? { is_error: true } : {}),
          },
        ],
      },
      parent_tool_use_id: null,
    });
    if (!stopped)
      hooks('PostToolUse', tool, {
        tool_name: tool,
        tool_input: input,
        tool_response: { stdout: result.content, stderr: '', interrupted: false },
      });
    if (stopped) blocked = true;
    return result;
  };

  const step = (name) => out.push({ fake: 'step', step: name });
  const { order, anytime } = walk(estate.steps);

  hooks('UserPromptSubmit', undefined, { prompt: ask });
  // An ask to explain without acting, or to say what can be done: a reply, nothing else.
  if (
    /^(?:no need to do anything|what kinds of things|what does\b|what would it mean)/i.test(ask) ||
    /\bjust tell me\b/i.test(ask)
  ) {
    text('Here is my answer; I changed nothing.');
    hooks('Stop', undefined, { stop_hook_active: false });
    return { records: out, blocked };
  }

  if (order.includes('plan')) step(order[0]);
  const unit = route(ask, estate);
  if (unit?.kind === 'skill') {
    call('Skill', { skill: unit.name }, () => ({ content: `Launching skill: ${unit.name}` }));
    for (const line of unit.body.split('\n')) {
      if (/\b(never|do not|don't)\b/i.test(line)) continue;
      for (const match of line.matchAll(/`([^`\s]+\.(?:md|txt|json|csv))`/g)) {
        const path = join(unit.folder, match[1]);
        if (existsSync(join(cwd, path)))
          call('Read', { file_path: join(cwd, path) }, () => ({ content: read(join(cwd, path)) ?? '' }));
      }
      // A command the body says to run, its script found in the skill folder; placeholders are left out.
      const runs = /\brun\b/i.test(line) ? /`([^`]+\s[^`]+)`/.exec(line)?.[1] : undefined;
      if (runs) {
        const command = runs
          .split(/\s+/)
          .filter((token) => !/^<.*>$/.test(token))
          .map((token) => (existsSync(join(cwd, unit.folder, token)) ? join(unit.folder, token) : token))
          .join(' ');
        call('Bash', { command, description: 'Run the command the skill names' }, () => {
          const ran = spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 30_000 });
          return {
            content: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim() || `exit ${ran.status}`,
            error: ran.status !== 0,
          };
        });
      }
      for (const helper of estate.helpers) {
        if (line.includes(`\`${helper.name}\``) && /\b(dispatch|call|delegate|hand)\b/i.test(line))
          call(
            'Agent',
            { subagent_type: helper.name, description: `Brief for ${helper.name}`, prompt: ask },
            () => ({
              content: '{"status": "done"}',
            }),
          );
      }
    }
  } else if (unit?.kind === 'helper') {
    call('Agent', { subagent_type: unit.name, description: `Brief for ${unit.name}`, prompt: ask }, () => ({
      content: '{"status": "done"}',
    }));
  }
  const rest = order.slice(1);
  if (rest[0]) step(rest[0]);

  // The command the ask spells out, run as written.
  const command = /\b(?:run|execute)\b[^:]*:\s*(.+?)\s*$/i.exec(ask)?.[1];
  if (command) {
    call('Bash', { command, description: 'Run the command the user gave' }, () => {
      const ran = spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 30_000 });
      return {
        content: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim() || `exit ${ran.status}`,
        error: ran.status !== 0,
      };
    });
  }

  // The workspace file the ask names: read first when a standing rule says so, then edited.
  const target = ask
    .split(/\s+/)
    .map((token) => token.replace(/[.,;:!?]+$/, ''))
    .find((token) => token.includes('/') && !token.startsWith('.claude') && isFile(join(cwd, token)));
  if (target) {
    const readFirst = estate.standing
      .split('\n')
      .some(
        (line) =>
          /\bread\b[^.]*\bbefore\b[^.]*\b(edit|chang|modif|writ)/i.test(line) &&
          !/\bnever read\b/i.test(line),
      );
    const path = join(cwd, target);
    if (readFirst) call('Read', { file_path: path }, () => ({ content: read(path) ?? '' }));
    const before = read(path) ?? '';
    const added = `${before.endsWith('\n') ? '' : '\n'}Updated as asked.\n`;
    const result = call(
      'Edit',
      { file_path: path, old_string: before.split('\n').pop() ?? '', new_string: added },
      () => ({ content: `The file ${target} has been updated.` }),
    );
    if (result && !result.error) out.push({ fake: 'write', path: target, content: `${before}${added}` });
  }

  for (const name of rest.slice(1)) step(name);
  for (const name of anytime) step(name);
  text(
    blocked ? 'A guard blocked part of the work; I stopped there.' : 'Done. Here is what I did, in short.',
  );
  hooks('Stop', undefined, { stop_hook_active: false });
  return { records: out, blocked };
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
