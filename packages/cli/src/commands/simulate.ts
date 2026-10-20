import {
  blockStatus,
  type DriverStep,
  isScored,
  runSpec,
  type Stimulus,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import { portFromEnv } from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import type { Io } from '../io';
import { optionNumber } from '../number';
import {
  type CampaignDeps,
  defaultDeps,
  loadValidSpecs,
  parseTarget,
  resolveAdapter,
  showTarget,
  specRuns,
} from './campaign';
import { agentFamilyOf, describeSource, loadPersonas, portFor, userFactory, userSource } from './personas';
import { hasSimulatedBlocks, type SimulateBlocksOptions, simulateBlocks } from './simulate-blocks';

export type SimulateDeps = CampaignDeps;

type SimulateOptions = SimulateBlocksOptions & {
  persona?: string;
  target?: string;
  turns?: string;
  model?: boolean;
  recording?: string[];
  agentFamily?: string;
  judgeFamily?: string[];
  json?: boolean;
};

/**
 * `driftbench simulate <spec> --persona <file> [--target t] [--turns n] (--model | --recording <file>)`:
 * a simulated user plays the persona on the spec, through the model port or a recording, in mode F. The
 * user reveals a fact only once the agent asks for it, says its stop token when the goal is met or given up,
 * and never sees the agent's tool calls; its model must belong to another family than the agent's and the
 * judges'. Prints each turn (user, agent, stage, pass) and the facts given.
 *
 * Exit 0 when the run completes and every block passes, 1 otherwise, 2 on bad input (nothing ran).
 */
export function registerSimulateCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: SimulateDeps = defaultDeps,
): void {
  program
    .command('simulate')
    .description(
      'Run one spec with a simulated user playing a persona, through the model port or a recording',
    )
    .argument('<spec>', 'one spec file')
    .option(
      '--persona <file>',
      'the persona the user plays; without it, the simulated user the spec defines in its blocks',
    )
    .option(
      '--target <adapter[:agent]>',
      "the agent, such as function:acme-sales; without it, the spec's own",
    )
    .option('--turns <n>', 'stop after this many user turns')
    .option('--model', 'speak through the model port the environment configures (a paid call)')
    .option(
      '--recording <file>',
      'replay the answers of a recording, by turn; repeat for several personas',
      collect,
    )
    .option(
      '--agent-family <family>',
      'the model family of the agent under test; none for an agent that is not a model',
    )
    .option('--judge-family <family>', 'a model family of the judges; repeat it', collect)
    .option(
      '--cassette <file>',
      'block mode: recorded responses of one simulator family; repeat it for the flip flag',
      collect,
    )
    .option('--record-cassette <file>', 'block mode, with --model: write the responses as a cassette')
    .option('--trials <k>', "block mode: runs per family; without it, the blocks' trials, else 1")
    .option('--seed <seed>', "block mode: the engine's seed; without it, the spec's, else its id")
    .option('--labeller <kind>', 'block mode: how the engine reads agent turns, model (default) or patterns')
    .option('--freeze <file>', 'block mode: write the first failing run as a spec of fixed replay turns')
    .option('--json', 'print one JSON document')
    .action(async (path: string, options: SimulateOptions) => {
      setExit(await simulateCommand(path, options, io, deps));
    });
}

export async function simulateCommand(
  path: string,
  options: SimulateOptions,
  io: Io,
  deps: SimulateDeps,
): Promise<number> {
  let turns: number | undefined;
  if (options.turns !== undefined) {
    if (!/^\d+$/.test(options.turns) || optionNumber(options.turns) < 1) {
      io.err(`--turns takes a whole number from 1, not "${options.turns}".\n`);
      return 2;
    }
    turns = optionNumber(options.turns);
  }
  if (options.persona === undefined) return simulateFromBlocks(path, options, io, deps);
  const blockOnly = (['cassette', 'recordCassette', 'trials', 'seed', 'labeller', 'freeze'] as const).filter(
    (key) => options[key] !== undefined,
  );
  if (blockOnly.length > 0) {
    io.err(
      `--${blockOnly.map(kebab).join(', --')} go with a spec that defines its simulated user in the blocks, not with --persona.\n`,
    );
    return 2;
  }
  const source = await userSource(options, () => (deps.modelPort ?? portFromEnv)(), io);
  if (!source) return 2;
  const [loadedPersona] = (await loadPersonas([options.persona], io)) ?? [];
  if (!loadedPersona) return 2;
  const { persona } = loadedPersona;
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const [entry, ...others] = loaded;
  if (!entry || others.length > 0) {
    io.err(`simulate takes one spec; ${path} holds ${loaded.length}.\n`);
    return 2;
  }
  const given = options.target === undefined ? [] : [parseTarget(options.target)];
  const [planned] = specRuns([entry], given, io) ?? [];
  const target = planned?.targets[0];
  if (planned === undefined || target === undefined) return 2;
  const adapter = await resolveAdapter(
    target,
    () => deps.adapterFor(target),
    io,
    planned.pinned === undefined ? [] : [entry.spec.id],
  );
  if (!adapter) {
    return 2;
  }
  const agentFamily = agentFamilyOf(target, options.agentFamily);
  if (agentFamily === undefined) {
    io.err(
      `Name the model family of ${showTarget(target)} with --agent-family (none for an agent that is not a model): the simulated user must run on another one.\n`,
    );
    return 2;
  }
  const port = portFor(source, persona);
  if (typeof port === 'string') {
    io.err(`${port}\n`);
    return 2;
  }
  const make = userFactory(persona, port, agentFamily, options.judgeFamily ?? []);
  if (typeof make === 'string') {
    io.err(`${make}\n`);
    return 2;
  }

  const said: string[] = [];
  let ended = '';
  const driver = recorded(make(), turns, said, (reason) => {
    ended = reason;
  });
  const result = await runSpec(entry.spec, {
    adapter,
    driver,
    checks: deps.checks,
    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
    mode: 'F',
    repeat: 0,
    target,
    now: () => deps.now(),
  });
  if (!ended && result.error) ended = result.error;
  const revealed = (driver as RecordedDriver).revealed();
  const passed = result.blocks.filter((block) => blockStatus(block) === 'pass').length;
  // A block not run or blocked is no pass (ok stays false) and no failure: it is counted apart.
  const unscored = result.blocks.filter((block) => !isScored(block)).length;
  const ok = result.status === 'completed' && passed === result.blocks.length && result.blocks.length > 0;

  if (options.json) {
    io.out(
      `${JSON.stringify(
        {
          specId: entry.spec.id,
          target,
          persona: persona.id,
          source: describeSource(source, persona),
          status: result.status,
          ended,
          revealed,
          blocks: result.blocks.map((block, index) => ({
            index: block.index,
            user: said[index] ?? null,
            agent: block.observed.text,
            stage: block.stageObserved ?? null,
            pass: blockStatus(block) === 'pass',
            ...(isScored(block) ? {} : { status: blockStatus(block) }),
          })),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    io.out(
      `Simulate: ${entry.spec.id} on ${showTarget(target)}, persona ${persona.id} (${persona.name}), ${describeSource(source, persona)}.\n`,
    );
    result.blocks.forEach((block, index) => {
      io.out(`  ${block.index}  user   ${oneLine(said[index] ?? '')}\n`);
      io.out(`  ${block.index}  agent  ${oneLine(block.observed.text)}\n`);
      io.out(
        `     ${block.stageObserved ?? '-'}  ${{ pass: '✓', fail: '✗', not_run: '- not run', blocked: '- blocked' }[blockStatus(block)]}\n`,
      );
    });
    io.out(`Facts given, each once asked: ${revealed.length > 0 ? revealed.join(', ') : 'none'}.\n`);
    io.out(
      `${ok ? '✓' : '✗'} ${passed} of ${result.blocks.length - unscored} blocks pass${unscored > 0 ? `, ${unscored} not run or blocked` : ''}. The run ended: ${ended || result.status}.\n`,
    );
  }
  return ok ? 0 : 1;
}

/** Block mode: the spec defines the simulated user in its blocks. */
async function simulateFromBlocks(
  path: string,
  options: SimulateOptions,
  io: Io,
  deps: SimulateDeps,
): Promise<number> {
  if (options.recording !== undefined || options.turns !== undefined) {
    io.err(
      '--recording and --turns go with --persona; a spec whose blocks define the user takes --cassette.\n',
    );
    return 2;
  }
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const [entry, ...others] = loaded;
  if (!entry || others.length > 0) {
    io.err(`simulate takes one spec; ${path} holds ${loaded.length}.\n`);
    return 2;
  }
  if (!hasSimulatedBlocks(entry.spec)) {
    io.err(
      `${entry.spec.id} defines no simulated user in its blocks: give --persona <file>, or write when.simulated_user with mode simulated.\n`,
    );
    return 2;
  }
  const given = options.target === undefined ? [] : [parseTarget(options.target)];
  const [planned] = specRuns([entry], given, io) ?? [];
  const target = planned?.targets[0];
  if (planned === undefined || target === undefined) return 2;
  const adapter = await resolveAdapter(
    target,
    () => deps.adapterFor(target),
    io,
    planned.pinned === undefined ? [] : [entry.spec.id],
  );
  if (!adapter) return 2;
  const agentFamily = agentFamilyOf(target, options.agentFamily);
  if (agentFamily === undefined) {
    io.err(
      `Name the model family of ${showTarget(target)} with --agent-family (none for an agent that is not a model): the simulated user must run on another one.\n`,
    );
    return 2;
  }
  return simulateBlocks({ spec: entry.spec, target, adapter, agentFamily }, options, io, deps);
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

type RecordedDriver = UserDriver & { revealed(): string[] };

/** The user, with what it said kept in order, a turn cap, and the reason it stopped. */
function recorded(
  user: UserDriver & { revealed?: () => string[] },
  turns: number | undefined,
  said: string[],
  stopped: (reason: string) => void,
): RecordedDriver {
  return {
    id: user.id,
    revealed: () => user.revealed?.() ?? [],
    async next(ctx): Promise<DriverStep> {
      if (turns !== undefined && said.length >= turns) {
        const reason = `--turns ${turns} reached`;
        stopped(reason);
        return { kind: 'stop', reason };
      }
      const step = await user.next(ctx);
      if (step.kind === 'stop') stopped(step.reason);
      else said.push(words(step.stimulus));
      return step;
    },
  };
}

function words(stimulus: Stimulus): string {
  if ('user' in stimulus) return stimulus.user;
  if ('burst' in stimulus) return stimulus.burst.join(' / ');
  return stimulus.injection.user;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
