import { ROOT, STANDING, skillFile } from '../../layout';
import type { Family } from '../frame';
import { type Case, caseFamily } from '../hostile';
import { BASE, type PlantedEstate } from '../planted';
import { atomAt, CODE, freeHelper, freeSkill, noAtomOn, standingFree, tag, theme } from './util';

/**
 * blind.gates: the four fixed forms of a gate ("Before X: Read Y", "Before X, read Y", "Read Y before X",
 * "Do not X until you have read Y") in the places a runtime reads prose, and the runtime hazards the docs
 * name, in many sentences. Each item plants one passage and asks for one atom on its line; the decoys own
 * their lines and ask for none.
 */

type Form = 'colon' | 'comma' | 'after' | 'until';
const FORMS: readonly Form[] = ['colon', 'comma', 'after', 'until'];

function gateText(form: Form, act: string, file: string): string {
  switch (form) {
    case 'colon':
      return `Before ${act}: Read \`${file}\`.`;
    case 'comma':
      return `Before ${act}, read \`${file}\`.`;
    case 'after':
      return `Read \`${file}\` before ${act}.`;
    case 'until':
      return `Do not ${act} until you have read \`${file}\`.`;
  }
}

const FORM_TITLE: Record<Form, string> = {
  colon: 'Before X: Read Y',
  comma: 'Before X, read Y',
  after: 'Read Y before X',
  until: 'Do not X until you have read Y',
};

const SAME_FORMS = 'recognise a gate in each of the four fixed forms wherever a prose line sits';
const SAME_LISTS = 'strip a list marker, a number or a bold label before matching the gate forms';
const SAME_BODIES = 'read gates in skill, helper and memory bodies as it reads them in the standing file';
const SAME_HAZARDS = 'name every hazard of the docs list wherever a prose line sits';
const SAME_COMMENTS = 'blank out comments and code fences before reading prose forms';

function act(seed: number, owner: string): string {
  const { place, thing } = theme(seed, owner);
  return `weighing a ${thing} at the ${place}`;
}

function gateFile(estate: PlantedEstate, owner: string, base: string): string {
  const path = `${base}/${tag(owner)}-rules.md`;
  estate.raw(path, '# Rules\n', BASE);
  return path;
}

type Prefix = {
  id: string;
  tier: 1 | 2 | 3 | 4;
  title: string;
  wrap: (text: string) => string;
  cause: string;
};

const PREFIXES: Prefix[] = [
  {
    id: 'plain',
    tier: 1,
    title: 'on a line of its own in the standing file',
    wrap: (t) => t,
    cause: SAME_FORMS,
  },
  {
    id: 'bullet',
    tier: 2,
    title: 'as a bullet in the standing file',
    wrap: (t) => `- ${t}`,
    cause: SAME_LISTS,
  },
];

function standingCases(): Case[] {
  const out: Case[] = [];
  for (const prefix of PREFIXES) {
    for (const form of FORMS) {
      out.push({
        key: `${prefix.id}-${form}`,
        tier: prefix.tier,
        title: `the gate "${FORM_TITLE[form]}" ${prefix.title}`,
        component: CODE,
        cause: prefix.cause,
        plant: (e, s, o) => {
          const writer = standingFree(e);
          const file = gateFile(e, o, 'docs');
          const line = writer.line(prefix.wrap(gateText(form, act(s, o), file)));
          e.check(o, atomAt('gate', STANDING, line));
        },
      });
    }
  }
  return out;
}

function skillCases(): Case[] {
  return FORMS.map((form) => ({
    key: `skill-body-${form}`,
    tier: 2 as const,
    title: `the gate "${FORM_TITLE[form]}" in a skill body`,
    component: CODE,
    cause: SAME_BODIES,
    plant: (e: PlantedEstate, s: number, o: string) => {
      const { place } = theme(s, o);
      const name = `${place}-gate-${tag(o)}`;
      const ref = skillFile(name, 'references/rules.md');
      e.raw(ref, '# Rules\n', BASE);
      const made = freeSkill(e, name, 'Gates the work.', [gateText(form, act(s, o), 'references/rules.md')]);
      e.check(o, atomAt('gate', made.path, made.lines[0] as number));
    },
  }));
}

const CASES: Case[] = [
  ...standingCases(),
  ...skillCases(),
  {
    key: 'numbered-colon',
    tier: 3,
    title: 'the gate "Before X: Read Y" as a numbered step',
    component: CODE,
    cause: SAME_LISTS,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const line = writer.line(`3. ${gateText('colon', act(s, o), gateFile(e, o, 'docs'))}`);
      e.check(o, atomAt('gate', STANDING, line));
    },
  },
  {
    key: 'numbered-until',
    tier: 3,
    title: 'the gate "Do not X until you have read Y" as a numbered step',
    component: CODE,
    cause: SAME_LISTS,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const line = writer.line(`12. ${gateText('until', act(s, o), gateFile(e, o, 'docs'))}`);
      e.check(o, atomAt('gate', STANDING, line));
    },
  },
  {
    key: 'rule-label-comma',
    tier: 3,
    title: 'the gate "Before X, read Y" behind a bold rule label',
    component: CODE,
    cause: SAME_LISTS,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const line = writer.line(`- **R4.** ${gateText('comma', act(s, o), gateFile(e, o, 'docs'))}`);
      e.check(o, atomAt('gate', STANDING, line));
    },
  },
  {
    key: 'rule-label-after',
    tier: 3,
    title: 'the gate "Read Y before X" behind a bold rule label',
    component: CODE,
    cause: SAME_LISTS,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const line = writer.line(`- **R9.** ${gateText('after', act(s, o), gateFile(e, o, 'docs'))}`);
      e.check(o, atomAt('gate', STANDING, line));
    },
  },
  {
    key: 'indented-bullet',
    tier: 3,
    title: 'the gate "Before X: Read Y" as a nested bullet',
    component: CODE,
    cause: SAME_LISTS,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      writer.line('- When the shift starts:');
      const line = writer.line(`    - ${gateText('colon', act(s, o), gateFile(e, o, 'docs'))}`);
      e.check(o, atomAt('gate', STANDING, line));
    },
  },
  {
    key: 'code-in-act',
    tier: 3,
    title: 'the gate "Before X: Read Y" whose act quotes a command',
    component: CODE,
    cause: SAME_FORMS,
    plant: (e, _s, o) => {
      const writer = standingFree(e);
      const file = gateFile(e, o, 'docs');
      const line = writer.line(`Before running \`make report\`: Read \`${file}\`.`);
      e.check(o, atomAt('gate', STANDING, line));
    },
  },
  {
    key: 'two-gates-in-a-row',
    tier: 3,
    title: 'two gates on neighbouring lines',
    component: CODE,
    cause: SAME_FORMS,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const first = writer.line(gateText('colon', act(s, o), gateFile(e, `${o}-a`, 'docs')));
      const second = writer.line(
        gateText('after', `closing the ${theme(s, o).place}`, gateFile(e, `${o}-b`, 'docs')),
      );
      e.check(o, atomAt('gate', STANDING, first));
      e.check(o, atomAt('gate', STANDING, second));
    },
  },
  {
    key: 'helper-body-until',
    tier: 3,
    title: 'the gate "Do not X until you have read Y" in a helper body',
    component: CODE,
    cause: SAME_BODIES,
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const made = freeHelper(e, `${place}-clerk-${tag(o)}`, [
        gateText('until', act(s, o), `${ROOT}/memory/rota.md`),
      ]);
      e.check(o, atomAt('gate', made.path, made.lines[0] as number));
    },
  },
  {
    key: 'memory-body-colon',
    tier: 3,
    title: 'the gate "Before X: Read Y" in a memory file',
    component: CODE,
    cause: SAME_BODIES,
    plant: (e, s, o) => {
      standingFree(e);
      const path = `${ROOT}/memory/${tag(o)}-habits.md`;
      const writer = e.file(path, BASE);
      writer.lines_(['# Habits', '']);
      const line = writer.line(gateText('colon', act(s, o), gateFile(e, o, 'docs')));
      e.check(o, atomAt('gate', path, line));
    },
  },
  {
    key: 'decoy-open-not-read',
    tier: 3,
    title: 'a "Before X: Open Y" line and finds no gate in it',
    component: CODE,
    cause: 'match the gate forms on the word read only',
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const file = gateFile(e, o, 'docs');
      const line = writer.line(`Before ${act(s, o)}: Open \`${file}\`.`);
      e.check(o, noAtomOn('gate', STANDING, [line]));
    },
  },
  {
    key: 'decoy-until-no-read',
    tier: 3,
    title: 'a "Do not X until Z agrees" line and finds no gate in it',
    component: CODE,
    cause: 'match the gate forms on the word read only',
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const line = writer.line(`Do not publish the ${theme(s, o).thing} list until the owner agrees.`);
      e.check(o, noAtomOn('gate', STANDING, [line]));
    },
  },
  {
    key: 'decoy-never-read-before',
    tier: 4,
    title: 'a line that forbids reading a file before an act and finds no gate in it',
    component: CODE,
    cause: 'match the gate forms at the start of the line, with the verb read first',
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const file = gateFile(e, o, 'docs');
      const line = writer.line(`Never read \`${file}\` before ${act(s, o)}; the draft is private.`);
      e.check(o, noAtomOn('gate', STANDING, [line]));
    },
  },
  {
    key: 'decoy-gate-in-comment',
    tier: 4,
    title: 'a gate written inside a comment and finds no gate in it',
    component: CODE,
    cause: SAME_COMMENTS,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      const file = gateFile(e, o, 'docs');
      const line = writer.line(`<!-- old rule: ${gateText('colon', act(s, o), file)} -->`);
      e.check(o, noAtomOn('gate', STANDING, [line]));
    },
  },
  {
    key: 'decoy-multiline-comment',
    tier: 4,
    title: 'a gate on the middle line of a multi-line comment and finds no gate in it',
    component: CODE,
    cause: SAME_COMMENTS,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      writer.lines_(['<!--', 'draft rules, not in force:']);
      const line = writer.line(gateText('comma', act(s, o), gateFile(e, o, 'docs')));
      writer.lines_(['-->', '']);
      e.check(o, noAtomOn('gate', STANDING, [line]));
    },
  },
  {
    key: 'decoy-tilde-fence',
    tier: 4,
    title: 'a gate inside a tilde fence and finds no gate in it',
    component: CODE,
    cause: SAME_COMMENTS,
    plant: (e, s, o) => {
      const writer = standingFree(e);
      writer.lines_(['~~~text']);
      const line = writer.line(gateText('colon', act(s, o), gateFile(e, o, 'docs')));
      writer.lines_(['~~~', '']);
      e.check(o, noAtomOn('gate', STANDING, [line]));
    },
  },
];

const HAZARDS: Array<{
  key: string;
  hazard: string;
  tier: 1 | 2 | 3 | 4;
  title: string;
  text: (thing: string) => string;
  cause?: string;
}> = [
  {
    key: 'compaction',
    hazard: 'compaction',
    tier: 1,
    title: 'a compaction',
    text: (t) => `After a compaction, read the ${t} notes again.`,
  },
  {
    key: 'restart',
    hazard: 'restart',
    tier: 1,
    title: 'a restart',
    text: (t) => `After a restart, reopen the ${t} tracker.`,
  },
  {
    key: 'rate-limits',
    hazard: 'rate_wave',
    tier: 1,
    title: 'rate limits',
    text: (t) => `When rate limits hit, wait and send the ${t} again.`,
  },
  {
    key: 'new-session',
    hazard: 'session_boundary',
    tier: 1,
    title: 'a new session',
    text: (t) => `In a new session, start from the ${t} handoff note.`,
  },
  {
    key: 'helper-notification',
    hazard: 'notification',
    tier: 2,
    title: 'a helper notification',
    text: (t) => `A helper notification may arrive after the ${t} count closed.`,
  },
  {
    key: 'hook-nudges',
    hazard: 'nudge_storm',
    tier: 2,
    title: 'repeated hook nudges',
    text: (t) => `Repeated hook nudges mean the ${t} loop is stuck.`,
  },
  {
    key: 'compaction-capital',
    hazard: 'compaction',
    tier: 2,
    title: 'a capitalised compaction at the start of a line',
    text: (t) => `Compaction drops the ${t} list from memory.`,
  },
  {
    key: 'restarts-plural',
    hazard: 'restart',
    tier: 3,
    title: 'restarts in the plural',
    text: (t) => `Restarts lose the ${t} cursor, so save it first.`,
  },
  {
    key: 'compactions-plural',
    hazard: 'compaction',
    tier: 3,
    title: 'compactions in the plural',
    text: (t) => `Long runs see compactions; keep the ${t} summary short.`,
  },
  {
    key: 'bold-compaction',
    hazard: 'compaction',
    tier: 3,
    title: 'a compaction inside bold text',
    text: (t) => `**After a compaction**, reload the ${t} checklist.`,
  },
];

function hazardCases(): Case[] {
  const out: Case[] = [];
  for (const hazard of HAZARDS) {
    out.push({
      key: `skill-${hazard.key}`,
      tier: hazard.tier,
      title: `${hazard.title} named in a skill body`,
      component: CODE,
      cause: SAME_HAZARDS,
      plant: (e, s, o) => {
        const { place, thing } = theme(s, o);
        const made = freeSkill(e, `${place}-watch-${tag(o)}`, 'Watches the desk.', [hazard.text(thing)]);
        e.check(o, atomAt('hazard', made.path, made.lines[0] as number, hazard.hazard));
      },
    });
  }
  out.push(
    {
      key: 'standing-bullet-nudges',
      tier: 2,
      title: 'repeated hook nudges named in a bullet of the standing file',
      component: CODE,
      cause: SAME_LISTS,
      plant: (e, s, o) => {
        const writer = standingFree(e);
        const line = writer.line(`- ${HAZARDS[5]?.text(theme(s, o).thing)}`);
        e.check(o, atomAt('hazard', STANDING, line, HAZARDS[5]?.hazard));
      },
    },
    {
      key: 'helper-rate-limits',
      tier: 3,
      title: 'rate limits named in a helper body',
      component: CODE,
      cause: SAME_BODIES,
      plant: (e, s, o) => {
        const { place, thing } = theme(s, o);
        const made = freeHelper(e, `${place}-scout-${tag(o)}`, [HAZARDS[2]?.text(thing) as string]);
        e.check(o, atomAt('hazard', made.path, made.lines[0] as number, HAZARDS[2]?.hazard));
      },
    },
    {
      key: 'memory-new-session',
      tier: 3,
      title: 'a new session named in a memory file',
      component: CODE,
      cause: SAME_BODIES,
      plant: (e, s, o) => {
        standingFree(e);
        const path = `${ROOT}/memory/${tag(o)}-habits.md`;
        const writer = e.file(path, BASE);
        writer.lines_(['# Habits', '']);
        const line = writer.line(HAZARDS[3]?.text(theme(s, o).thing) as string);
        e.check(o, atomAt('hazard', path, line, HAZARDS[3]?.hazard));
      },
    },
    {
      key: 'two-hazard-lines',
      tier: 3,
      title: 'two different hazards on neighbouring lines',
      component: CODE,
      cause: SAME_HAZARDS,
      plant: (e, s, o) => {
        const { place, thing } = theme(s, o);
        const made = freeSkill(e, `${place}-pair-${tag(o)}`, 'Pairs the hazards.', [
          HAZARDS[0]?.text(thing) as string,
          HAZARDS[2]?.text(thing) as string,
        ]);
        for (const [index, line] of made.lines.entries()) {
          e.check(o, atomAt('hazard', made.path, line, HAZARDS[index === 0 ? 0 : 2]?.hazard));
        }
      },
    },
    {
      key: 'decoy-hazard-in-comment',
      tier: 4,
      title: 'a hazard named inside a comment and finds no hazard in it',
      component: CODE,
      cause: SAME_COMMENTS,
      plant: (e, s, o) => {
        const writer = standingFree(e);
        const line = writer.line(`<!-- ${HAZARDS[0]?.text(theme(s, o).thing)} -->`);
        e.check(o, noAtomOn('hazard', STANDING, [line]));
      },
    },
    {
      key: 'decoy-restart-in-word',
      tier: 4,
      title: 'a word that only holds the letters of a hazard and finds no hazard in it',
      component: CODE,
      cause: 'match hazard words as whole words',
      plant: (e, s, o) => {
        const writer = standingFree(e);
        const line = writer.line(
          `The ${theme(s, o).place} bakery sells a precompaction brick and a restarting-kit label.`,
        );
        e.check(o, noAtomOn('hazard', STANDING, [line]));
      },
    },
  );
  return out;
}

export function gatesFamily(): Family {
  return caseFamily('blind.gates', CODE, [...CASES, ...hazardCases()], 'the reader reads');
}
