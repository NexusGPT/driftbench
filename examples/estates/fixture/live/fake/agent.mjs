/**
 * The fake's default agent: a stream derived by code from the estate it is given and from that estate's own
 * structured definitions, nothing else. It reads the copy in its working folder (the skills, the helpers, the
 * settings and the step list) and, from `FAKE_MAP` and `FAKE_PHRASES`, the approved map and the phrase bank of the
 * estate (see dispatch.mjs). The ask sets off the atoms the map or the bank ties it to; the fake does what those
 * atoms define: loads the unit that owns the rule, reads the files a reference names, provokes the guard its
 * settings name so the real script decides, and replies with the act the atom declares.
 * An ask the map and the bank do not know sets off nothing and is answered plainly.
 * From the loaded skill it does what the map declares the skill holds (dispatch.mjs `unitPlan`): it reads the
 * references, runs the scripts and dispatches the helpers of the skill's atoms in force, orders them by the gates
 * the map declares, refuses a call a declared forbid case names, and runs every hook the settings declare on each
 * of its tool calls. It reads no word of the estate or of the ask: the same map in any wording gives the same run.
 * This deterministic stand-in is not a model or a complete Claude Code simulator. It knows nothing of any test,
 * plan row or mutant: what changes its stream is only what the copy, the map and the bank say. No model, no cost,
 * fictional data only.
 * Each actual reply branch emits its own typed replyAct, pointing at the emitted text content block.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, matchesGlob, resolve } from 'node:path';
import {
  intentsOf,
  loadDispatch,
  provocation,
  recoveryReads,
  replyActOf,
  setOff,
  unitPlan,
} from './dispatch.mjs';

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
      // Project helper files require both fields; unnamed files are adjacent documentation.
      if (!fields.name || !fields.description) continue;
      helpers.push({
        kind: 'helper',
        name: fields.name,
        description: fields.description,
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
  return { skills, helpers, settings, steps };
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

// Skill paths are local to that skill; explicit .claude/ and absolute paths are estate-wide.
function fileTarget(literal, cwd, folder) {
  return resolve(cwd, isAbsolute(literal) || literal.startsWith('.claude/') ? '' : folder, literal);
}

function commandTarget(literal, cwd, folder) {
  return literal
    .trim()
    .split(/\s+/)
    .map((token) =>
      token.includes('/') || existsSync(fileTarget(token, cwd, folder))
        ? fileTarget(token, cwd, folder)
        : token,
    )
    .join(' ');
}

function actionTarget(kind, literal, cwd, folder) {
  return kind === 'Bash'
    ? commandTarget(literal, cwd, folder)
    : kind === 'Read' || kind === 'Edit' || kind === 'Write'
      ? fileTarget(literal, cwd, folder)
      : literal;
}

/**
 * The skill's actions in the order its gates allow: a gate puts its read (or its command) before every action of
 * the tool its act uses, adding that read when no reference declares it; a gate on two calls of one tool puts the
 * call holding its first part before the call holding its second. A gate whose two acts use one tool and that
 * names no calls orders nothing. Without a gate, actions keep the order of their lines. A cycle stops the skill as
 * contradictory; two calls a gate names that no action holds stop it as unresolved. Nothing falls back to prose.
 */
function ordered(plan, cwd) {
  const actions = plan.actions.map((action) => ({
    ...action,
    target: actionTarget(action.kind, action.literal, cwd, action.folder),
    needs: new Set(),
  }));
  const ensure = (kind, literal, folder) => {
    const target = actionTarget(kind, literal, cwd, folder);
    let action = actions.find((other) => other.kind === kind && other.target === target);
    if (!action) {
      action = { kind, literal, folder, target, needs: new Set() };
      actions.push(action);
    }
    return action;
  };
  let unresolved = false;
  for (const gate of plan.gates) {
    if (gate.second !== undefined) {
      const tool = gate.before.split('~')[0];
      const holding = (part) =>
        actions.filter(
          (action) => action.kind === tool && part !== undefined && action.literal.includes(part),
        );
      const firsts = holding(gate.first);
      const seconds = holding(gate.second);
      if (!firsts.length || !seconds.length || firsts.some((action) => seconds.includes(action))) {
        unresolved = true;
        continue;
      }
      for (const second of seconds) for (const first of firsts) second.needs.add(first);
      continue;
    }
    if (gate.before === gate.after) continue;
    const governed = actions.filter((action) => action.kind === gate.after);
    if (!governed.length) continue;
    const first =
      gate.before === 'Read' && gate.path
        ? ensure('Read', gate.path, '')
        : gate.before === 'Bash' && gate.first
          ? ensure('Bash', gate.first, gate.folder)
          : undefined;
    if (!first) {
      unresolved = true;
      continue;
    }
    for (const action of governed) if (action !== first) action.needs.add(first);
  }
  const order = [];
  const remaining = new Set(actions);
  while (remaining.size) {
    const ready = actions.find(
      (action) => remaining.has(action) && [...action.needs].every((need) => !remaining.has(need)),
    );
    if (!ready) return { error: 'The skill has contradictory ordering obligations.', actions: [] };
    remaining.delete(ready);
    order.push(ready);
  }
  return unresolved
    ? { error: 'The skill has an ordering obligation whose actions cannot be resolved.', actions: [] }
    : { actions: order };
}

/** The refusal a declared forbid case gives a call, if any: the same tool on a target its material matches. */
function prohibitions(bans, cwd) {
  return (tool, input) => {
    const target =
      tool === 'Bash'
        ? commandTarget(input.command, cwd, '')
        : tool === 'Read' || tool === 'Edit' || tool === 'Write'
          ? input.file_path
          : input.subagent_type;
    if (typeof target !== 'string') return undefined;
    for (const ban of bans) {
      if (ban.tool !== tool) continue;
      const rule = actionTarget(tool, ban.material, cwd, ban.folder);
      if (target !== rule && !matchesGlob(target, rule)) continue;
      return ban.conditional
        ? 'The condition of an estate prohibition cannot be resolved; I stopped before the tool call.'
        : 'An estate prohibition forbids this action; I stopped before the tool call.';
    }
    return undefined;
  };
}

export function planStream({ ask, cwd, sessionId, env, compacted = false }) {
  const estate = readEstate(cwd);
  // The atoms the ask sets off, and what they define; a unit whose file the copy lacks is not loaded.
  const dispatch = loadDispatch(env);
  const setOffBy = dispatch ? setOff(dispatch, ask) : { atoms: [], named: [] };
  const intent = dispatch
    ? intentsOf(dispatch, setOffBy.atoms, cwd)
    : { units: [], reads: [], guards: [], replies: [] };
  const loaded = intent.units
    .map((entry) =>
      (entry.kind === 'skill' ? estate.skills : estate.helpers).find((u) => u.name === entry.name),
    )
    .filter(Boolean);
  const unit = loaded[0];
  // What the loaded skill holds, as the map declares it; a helper's own acts are the helper's, not this agent's.
  const plan =
    unit?.kind === 'skill' && dispatch
      ? unitPlan(dispatch, { kind: 'skill', name: unit.name }, cwd)
      : { actions: [], gates: [], bans: [] };
  const prohibited = prohibitions(plan.bans, cwd);
  const out = [];
  let id = 0;
  let blocked = false;
  let lastReply = '';
  const text = (value, act, part = 'reply') => {
    lastReply = value;
    out.push({
      replyAct: {
        id: act,
        evidence: { type: 'text_segment', part, index: 0 },
        source: { kind: 'adapter', name: 'driftbench-fictional-agent' },
      },
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
  };

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
  const call = (tool, input, perform, attempt = false) => {
    // A provoked guard is an attempt the guard must catch, not one the agent's own reading of the rules declines.
    const prohibition = attempt ? undefined : prohibited(tool, input);
    if (prohibition) {
      blocked = true;
      text(prohibition, 'refuse');
      return undefined;
    }
    // The agent does not make a call the settings deny. A provoked attempt is made: the runtime runs its PreToolUse
    // hooks before it applies the settings' permission rules, so the guard sees the attempt either way.
    const refused = denied(estate.settings, tool, input);
    if (refused && !attempt) return undefined;
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
    const result = stopped
      ? { error: true, content: 'Blocked by a hook.' }
      : refused
        ? { error: true, content: 'Denied by a permission rule of the settings.' }
        : perform();
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
    if (!stopped && !refused)
      hooks('PostToolUse', tool, {
        tool_name: tool,
        tool_input: input,
        tool_response: { stdout: result.content, stderr: '', interrupted: false },
      });
    if (stopped || refused) blocked = true;
    return result;
  };

  const step = (name) => out.push({ fake: 'step', step: name });
  const { order, anytime } = walk(estate.steps);

  const declared = replyActOf(intent.replies);
  let acted = false;
  const sayings = {
    answer: 'Here is my answer; I changed nothing.',
    report: 'Done. Here is what I did, in short.',
    clarify: 'Before I go on I need one thing from you. Which one do you mean?',
    refuse: 'I will not do that, and I changed nothing.',
    draft: 'Here is a draft for you to review. I have sent nothing.',
    acknowledge: 'Stopped. Everything is paused.',
  };
  /** The closing reply: the act the atoms set off declare, else what the run did decides. */
  const close = (note, padTo = 0) => {
    const act = declared?.id ?? (blocked ? 'refuse' : acted ? 'report' : 'answer');
    let body = note ?? sayings[act];
    // A guard on the length of a reply is provoked by a reply longer than its limit, made of the estate's own text.
    for (let at = 0; body.length <= padTo; at++) {
      const unitText = estate.skills[at % Math.max(1, estate.skills.length)];
      body += ` ${unitText ? `${unitText.name}: ${unitText.description}` : 'More detail.'}`;
    }
    text(body, act, declared?.id === act ? declared.part : 'reply');
    hooks('Stop', undefined, { stop_hook_active: false, last_assistant_message: lastReply });
    return { records: out, blocked };
  };

  hooks('UserPromptSubmit', undefined, { prompt: ask });
  // After a compaction the agent reads again what the hazard atoms of the map name, whatever it is asked next.
  if (compacted && dispatch) {
    for (const path of recoveryReads(dispatch, cwd)) {
      const target = fileTarget(path, cwd, '');
      acted = true;
      call('Read', { file_path: target }, () => ({ content: read(target) ?? '' }));
    }
  }
  // An ask that concerns no atom of the map is answered plainly: no step is walked.
  if (setOffBy.atoms.length === 0) return close();

  if (order[0]) step(order[0]);
  const load = (entry) => {
    acted = true;
    if (entry.kind === 'skill') {
      call('Skill', { skill: entry.name }, () => ({ content: `Launching skill: ${entry.name}` }));
    } else {
      call(
        'Agent',
        { subagent_type: entry.name, description: `Brief for ${entry.name}`, prompt: ask },
        () => ({
          content: '{"status": "done"}',
        }),
      );
    }
  };
  const steps = ordered(plan, cwd);
  // The unit is loaded before its obligations are read: a skill whose ordering cannot be resolved still loads,
  // then the run stops on the error.
  if (unit) load(unit);
  if (steps.error) {
    text(steps.error);
    hooks('Stop', undefined, { stop_hook_active: false });
    return { records: out, blocked: true, error: steps.error };
  }
  // The other units the atoms set off, and the files their references name.
  for (const entry of loaded.slice(1)) load(entry);
  for (const path of intent.reads) {
    const target = fileTarget(path, cwd, '');
    if (
      steps.actions.some(
        (action) => action.kind === 'Read' && fileTarget(action.literal, cwd, action.folder) === target,
      )
    )
      continue;
    acted = true;
    call('Read', { file_path: target }, () => ({ content: read(target) ?? '' }));
  }
  // A guard is provoked by the event its settings name, so that its real script decides.
  let longerThan = 0;
  for (const guard of intent.guards) {
    const matcher = matcherOf(estate.settings, guard);
    const provoked = provocation(dispatch, guard, matcher, covers);
    if (provoked === undefined) continue;
    if (provoked.longerThan !== undefined) {
      longerThan = Math.max(longerThan, provoked.longerThan);
    } else if (provoked.tool === 'Bash') {
      acted = true;
      call(
        'Bash',
        { command: provoked.material, description: 'Run the named command' },
        () => ({ content: '' }),
        true,
      );
    } else {
      acted = true;
      const path = fileTarget(provoked.material, cwd, '');
      call(
        provoked.tool,
        { file_path: path, old_string: '', new_string: '' },
        () => ({ content: `The file ${provoked.material} has been updated.` }),
        true,
      );
    }
  }
  for (const action of steps.actions) {
    let result;
    acted = true;
    if (action.kind === 'Read') {
      const path = fileTarget(action.literal, cwd, action.folder);
      result = call('Read', { file_path: path }, () => {
        const content = read(path);
        return content === undefined
          ? { error: true, content: `File not found: ${action.literal}` }
          : { content };
      });
    } else if (action.kind === 'Bash') {
      // Resolve commands against the skill folder; omit unfilled placeholders as before.
      const command = action.literal
        .split(/\s+/)
        .filter((token) => !/^<.*>$/.test(token))
        .map((token) => (existsSync(join(cwd, action.folder, token)) ? join(action.folder, token) : token))
        .join(' ');
      result = call('Bash', { command, description: 'Run the named command' }, () => {
        const ran = spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 30_000 });
        return {
          content: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim() || `exit ${ran.status}`,
          error: ran.status !== 0,
        };
      });
    } else {
      result = call(
        'Agent',
        { subagent_type: action.literal, description: `Brief for ${action.literal}`, prompt: ask },
        () => ({ content: '{"status": "done"}' }),
      );
    }
    // A denied, missing or failed prerequisite is not satisfied. Never execute its dependent action.
    if (!result || result.error) {
      text('An action could not complete; I stopped before continuing.', declared?.id ?? 'report');
      hooks('Stop', undefined, { stop_hook_active: false, last_assistant_message: lastReply });
      return { records: out, blocked: true };
    }
  }
  const rest = order.slice(1);
  if (rest[0]) step(rest[0]);

  for (const name of rest.slice(1)) step(name);
  for (const name of anytime) step(name);
  return close(undefined, longerThan);
}

/** The matcher the settings put on the hook that runs a guard's command: how the runtime scopes the guard. */
function matcherOf(settings, guard) {
  for (const group of settings?.hooks?.[guard.fields?.event] ?? [])
    for (const hook of group?.hooks ?? []) if (hook?.command === guard.fields?.command) return group.matcher;
  return undefined;
}
