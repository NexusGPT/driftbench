import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  type BlockResult,
  type DriverStep,
  loadSpecFile,
  provenanceHash,
  runSpec,
  type Spec,
} from '@agent-nexus/driftbench-core';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import {
  createPerturbingDriver,
  createScriptedDriver,
  createSimulatedUser,
  loadPersona,
  loadUserRecording,
  personaOptions,
  type SimulatedUserOptions,
  userRecordingPort,
} from '../src/index';
import { acmeSales, acmeSpec, block, PERSONA_DIR, runP, spec } from './support';

const FLOW = spec({
  id: 'flow',
  blocks: [
    { user: 'I want more data on my phone.' },
    { user: "It's sam.rivera@example.com" },
    { user: 'The unlimited one.' },
  ],
});

/** The options of a simulated user on a fake port that replays hand-written answers. */
function options(answers: string[], over: Partial<SimulatedUserOptions> = {}) {
  const port = new FakeModelPort(answers, { family: 'mistral', model: 'fake-mistral' });
  const base: SimulatedUserOptions = {
    persona: 'A busy customer who writes short messages.',
    goal: 'Get a plan with more data.',
    facts: { email: 'sam.rivera@example.com', phone: '+1 202 555 0142' },
    revealWhenAsked: { email: ['e-?mail'], phone: ['phone number'] },
    stopToken: '###STOP###',
    port,
    agentFamily: 'anthropic',
    judgeFamilies: ['openai', 'google', 'jev'],
    ...over,
  };
  return { port, options: base };
}

/** An agent reply written by hand, with a tool call the simulated user must never see. */
function reply(position: number, text: string): BlockResult {
  return block(position, {
    observed: {
      segments: [],
      text,
      toolCalls: [{ label: 'catalog.search', input: { q: 'TOOL-INPUT-7' }, output: 'TOOL-OUTPUT-7' }],
      cost: {},
      latencyMs: 0,
    },
  });
}

const step = (
  driver: ReturnType<typeof createSimulatedUser>,
  history: BlockResult[],
  blockIndex = history.length,
) => driver.next({ spec: FLOW, mode: 'F', blockIndex, history }) as Promise<DriverStep>;

describe('the simulated user at config time', () => {
  it("refuses a model of the agent's family or a judge's family, compared without case", () => {
    expect(() => createSimulatedUser(options([], { agentFamily: 'Mistral' }).options)).toThrow(
      'the simulated user runs on the mistral family, the family of the agent under test: refused',
    );
    expect(() =>
      createSimulatedUser(options([], { judgeFamilies: ['openai', ' MISTRAL '] }).options),
    ).toThrow('the simulated user runs on the mistral family, a family of the judges: refused');
    const unknown = { ...options([]).options, port: new FakeModelPort([], { family: 'unknown' }) };
    expect(() => createSimulatedUser(unknown)).toThrow(/names no family/);
    expect(() => createSimulatedUser(options([], { agentFamily: ' ' }).options)).toThrow(
      'the agent family is not set: use none for an agent that is not a model',
    );
    expect(() =>
      createSimulatedUser(options([], { agentFamily: 'none', judgeFamilies: [] }).options),
    ).not.toThrow();
  });

  it('refuses a fact that can never be asked for, a broken pattern, a pattern for no fact, and an empty stop token', () => {
    expect(() => createSimulatedUser(options([], { revealWhenAsked: { email: ['mail'] } }).options)).toThrow(
      'the fact phone has no ask pattern, so it could never be given',
    );
    expect(() =>
      createSimulatedUser(options([], { revealWhenAsked: { email: ['('], phone: ['x'] } }).options),
    ).toThrow(/the ask pattern \( of email does not compile/);
    expect(() =>
      createSimulatedUser(
        options([], { revealWhenAsked: { email: ['x'], phone: ['y'], iban: ['z'] } }).options,
      ),
    ).toThrow('reveal_when_asked names iban, which is not a fact');
    expect(() => createSimulatedUser(options([], { stopToken: ' ' }).options)).toThrow(
      'the stop token is empty',
    );
  });

  it('refuses a persona or a goal that already holds a fact, a phone number in any spacing included', () => {
    expect(() =>
      createSimulatedUser(options([], { persona: 'Writes from SAM.RIVERA@example.com.' }).options),
    ).toThrow(
      'the persona holds the value of the fact email, so the user would know to give it unasked: keep it in facts alone',
    );
    expect(() => createSimulatedUser(options([], { goal: 'Call back on (202) 555-0142.' }).options)).toThrow(
      /the goal holds the value of the fact phone/,
    );
  });
});

describe('the simulated user in a run', () => {
  it('gives a fact only after the agent asks for it, and hides it from the words of the block until then', async () => {
    const { port, options: config } = options(['I need more data.', "It's sam.rivera@example.com"]);
    const driver = createSimulatedUser(config);
    const first = await step(driver, [], 1);
    expect(first).toEqual({ kind: 'block', blockIndex: 1, stimulus: { user: 'I need more data.' } });
    const opening = port.requests[0]?.user ?? '';
    expect(opening).toMatch(/^Turn 1\./);
    expect(opening).toContain('Facts you may give now, because the assistant asked for them:\n(none)');
    expect(opening).toContain("What you mean to say now, in your own words: It's [your email, once asked]");
    expect(opening).not.toContain('sam.rivera');
    expect(driver.revealed()).toEqual([]);

    await step(driver, [reply(0, 'Thanks. What is the email on your account?')], 1);
    const second = port.requests[1]?.user ?? '';
    expect(second).toContain('- email: sam.rivera@example.com');
    expect(second).not.toContain('+1 202 555 0142');
    expect(second).toContain("What you mean to say now, in your own words: It's sam.rivera@example.com");
    expect(driver.revealed()).toEqual(['email']);
  });

  it("reads the agent's visible text only, never its tool calls, and keeps its own messages in the transcript", async () => {
    const { port, options: config } = options(['One.', 'Two.']);
    const driver = createSimulatedUser(config);
    await step(driver, []);
    await step(driver, [reply(0, 'Hello, how can I help?')]);
    const transcript = port.requests[1]?.user ?? '';
    expect(transcript).toContain('Customer: One.\nAssistant: Hello, how can I help?');
    for (const request of port.requests) {
      expect(`${request.system}\n${request.user}`).not.toMatch(/TOOL-(INPUT|OUTPUT)-7|catalog\.search/);
    }
  });

  it('stops on the stop token, stops past the last block without asking the model, and refuses an empty message', async () => {
    const { port, options: config } = options(['Great, thanks! ###STOP###', '  ']);
    const driver = createSimulatedUser(config);
    expect(await step(driver, [])).toEqual({
      kind: 'stop',
      reason: 'the simulated user said the stop token at block 0',
    });
    expect(await step(driver, [reply(0, 'a'), reply(1, 'b'), reply(2, 'c')])).toEqual({
      kind: 'stop',
      reason: 'the spec has no block 3',
    });
    expect(port.requests).toHaveLength(1);
    await expect(step(driver, [])).rejects.toThrow('the model gave an empty message at block 0');
  });

  it('fails the run when the model gives a fact the agent has not asked for', async () => {
    const driver = createSimulatedUser(options(['Hi, call me on 202 555 0142.']).options);
    await expect(step(driver, [reply(0, 'Hello!')])).rejects.toThrow(
      'the simulated user gave phone at block 1 before the agent asked for it',
    );
  });

  it('writes from the persona and the goal alone with script none, and starts afresh on a new run', async () => {
    const { port, options: config } = options(['First.', 'Again.'], { script: 'none' });
    const driver = createSimulatedUser(config);
    await step(driver, []);
    await step(driver, []);
    expect(port.requests[0]?.user).not.toContain('What you mean to say now');
    expect(port.requests[1]?.user).toContain('(nothing yet: you write first)');
    expect(port.requests.map((request) => request.user.split('\n')[0])).toEqual(['Turn 1.', 'Turn 1.']);
    expect(port.requests[0]?.system).toContain('Your goal: Get a plan with more data.');
    expect(port.requests[0]?.system).toContain('reply with ###STOP### and nothing else');
  });
});

describe('the Acme personas', () => {
  it('are three, valid, fictional, each playing an Acme spec that exists', async () => {
    const files = (await readdir(PERSONA_DIR)).filter((name) => name.endsWith('.yaml')).sort();
    expect(files).toEqual(['alex-newhome.yaml', 'dana-porting.yaml', 'sam-upgrader.yaml']);
    for (const file of files) {
      const persona = await loadPersona(join(PERSONA_DIR, file));
      expect(`${persona.id}.yaml`).toBe(file);
      for (const value of Object.values(persona.facts)) {
        // Fictional: an email at example.com, an Acmeville address, or a phone in the reserved range.
        const reservedPhone =
          /^\+[\d ]+$/.test(value) && value.replace(/\D/g, '').startsWith(['1', '202', '555', '01'].join(''));
        expect(/example\.com$|Acmeville$/.test(value) || reservedPhone, value).toBe(true);
      }
      const loaded = await loadSpecFile(resolve(dirname(join(PERSONA_DIR, file)), persona.spec ?? ''));
      expect(loaded.ok).toBe(true);
      const port = new FakeModelPort([], { family: 'mistral' });
      expect(() =>
        createSimulatedUser({
          ...personaOptions(persona),
          port,
          agentFamily: 'none',
          judgeFamilies: ['jev'],
        }),
      ).not.toThrow();
    }
  });

  it('refuses a recorded turn the recording does not hold, and a request with no turn', async () => {
    const port = userRecordingPort({ family: 'hand-written', model: 'm', persona: 'p', answers: ['one'] });
    await expect(port.complete({ system: 's', user: 'Turn 1.\n...' })).resolves.toBe('one');
    await expect(port.complete({ system: 's', user: 'Turn 2.\n...' })).rejects.toThrow(
      'the recording of p holds 1 answers, none for turn 2',
    );
    await expect(port.complete({ system: 's', user: 'hello' })).rejects.toThrow('the request names no turn');
  });
});

describe('the simulated user through the real runner, on the Acme agent, with the recording port', () => {
  async function samRun(
    driverOf: (
      base: ReturnType<typeof createSimulatedUser>,
      plan: Spec,
    ) => {
      driver: Parameters<typeof runP>[1];
      spec: Spec;
      id?: string;
    },
  ) {
    const persona = await loadPersona(join(PERSONA_DIR, 'sam-upgrader.yaml'));
    const recording = await loadUserRecording(join(PERSONA_DIR, 'recordings', 'sam-upgrader.yaml'));
    const port = userRecordingPort(recording);
    const user = createSimulatedUser({
      ...personaOptions(persona),
      port,
      agentFamily: 'none',
      judgeFamilies: ['jev', 'openai', 'google', 'anthropic'],
    });
    const plan = await acmeSpec('conversations/plan-upgrade.yaml');
    const made = driverOf(user, plan);
    const result = await runP(made.spec, made.driver, acmeSales(), made.id);
    return { result, port, plan, made };
  }

  it('plays the plan upgrade to the end: every block passes, and the email goes out only once asked', async () => {
    const { result, port } = await samRun((user, plan) => ({ driver: user, spec: plan }));
    expect(result.status).toBe('completed');
    expect(result.blocks.map((each) => [each.stageObserved, each.pass])).toEqual([
      ['identify', true],
      ['offer', true],
      ['recap', true],
      ['order_placed', true],
      ['closing', true],
    ]);
    expect(port.requests).toHaveLength(5);
    expect(port.requests[0]?.user).not.toContain('sam.rivera@example.com');
    expect(result.blocks[0]?.observed.text).toMatch(/email address/);
    expect(port.requests[1]?.user).toContain('- email: sam.rivera@example.com');
    expect(port.requests[4]?.user).toContain('Assistant: Done. Your order ORD-');
    expect(port.requests.some((request) => request.user.includes('catalog.search'))).toBe(false);
  });

  it('stores the text each block sent when asked, its hash otherwise, and nothing for a scripted run', async () => {
    const persona = await loadPersona(join(PERSONA_DIR, 'sam-upgrader.yaml'));
    const recording = await loadUserRecording(join(PERSONA_DIR, 'recordings', 'sam-upgrader.yaml'));
    const user = createSimulatedUser({
      ...personaOptions(persona),
      port: userRecordingPort(recording),
      agentFamily: 'none',
      judgeFamilies: ['jev', 'openai', 'google', 'anthropic'],
    });
    const plan = await acmeSpec('conversations/plan-upgrade.yaml');
    // The last user message of each request is the text the adapter received for that block.
    const received: string[] = [];
    const adapter = acmeSales((agent) => ({
      respond: (messages, world) => {
        received.push(messages.filter((message) => message.role === 'user').at(-1)?.content ?? '');
        return agent.respond(messages, world);
      },
    }));
    const result = await runSpec(plan, {
      adapter,
      driver: user,
      checks: [],
      mode: 'P',
      repeat: 0,
      recordRealizedText: true,
    });
    expect(result.status).toBe('completed');
    const authored = plan.blocks.map((each) => (each.when as { user: string }).user);
    // A block whose sent text differs from the authored one stores it; one that sent the authored text does not.
    const expected = received.map((text, index) =>
      text === authored[index] ? undefined : { hash: provenanceHash(text), text },
    );
    expect(result.blocks.map((each) => each.realized)).toEqual(expected);
    expect(expected.filter((each) => each !== undefined).length).toBeGreaterThan(0);
    // Without the request, the same run keeps each hash and no text.
    const hashed = await runSpec(plan, {
      adapter: acmeSales(),
      driver: createSimulatedUser({
        ...personaOptions(persona),
        port: userRecordingPort(recording),
        agentFamily: 'none',
        judgeFamilies: ['jev', 'openai', 'google', 'anthropic'],
      }),
      checks: [],
      mode: 'P',
      repeat: 0,
    });
    expect(hashed.blocks.map((each) => each.realized)).toEqual(
      expected.map((each) => (each === undefined ? undefined : { hash: each.hash })),
    );
    const scripted = await runP(plan, createScriptedDriver(), acmeSales());
    expect(scripted.blocks.some((each) => 'realized' in each)).toBe(false);
  });

  it('drives a perturbed run as the base of the perturbing driver', async () => {
    const { result, made } = await samRun((user, plan) => {
      const driver = createPerturbingDriver({ spec: plan, perturbation: 'billing-aside', base: user });
      return { driver, spec: driver.spec, id: 'billing-aside' };
    });
    expect(result.blocks.map((each) => each.pass)).toEqual([true, true, true, true, true, true]);
    expect(made.spec.perturbations?.map((each) => each.id)).toContain('billing-aside');
    expect(result.recovery).toMatchObject({ injectedAt: 2, turnsToRecover: 0, label: 'immediate' });
  });
});
