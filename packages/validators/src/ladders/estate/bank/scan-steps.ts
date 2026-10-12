import { ROOT, STANDING } from '../layout';
import { namesFor, writeSettings } from './common';
import { type Family, itemsOf, type Tier } from './frame';
import { PlantedEstate } from './planted';

/**
 * scan.steps: step lists and process maps in the shapes estates write. The oracle: one stage atom per step,
 * on the line that declares the step's id, and a `next` edge for every successor that exists in the same
 * process. Shapes: a top-level steps array, a map of named processes (an object or an array), steps keyed
 * by id, a successor as a string or under `then`, nesting under another key, YAML, JSON with comments,
 * trailing commas or a byte order mark, long lists, and the same ids in two processes.
 */

const COMPONENT = 'packages/estate/src/scan/claude-code.ts';
const FAMILY = 'scan.steps';

type Step = { id: string; next: string[]; anytime?: boolean };
type Process = { name: string; steps: Step[] };
type Render = (processes: Process[]) => {
  lines: string[];
  declares: (process: number, id: string) => number;
};
type Shape = {
  key: string;
  tier: Tier;
  title: string;
  file: string;
  processes: number;
  render: Render;
  size?: number;
};

/** Finds the line holding a step's declaration, from a needle per step, in process order. */
function locator(lines: string[], needle: (id: string) => string, starts: number[]) {
  return (process: number, id: string) => {
    const from = starts[process] ?? 0;
    const index = lines.findIndex((line, at) => at >= from && line.includes(needle(id)));
    return index + 1;
  };
}

function oneLine(step: Step, nextKey = 'next', nextAsString = false): string {
  const tail = step.anytime
    ? '"anytime": true'
    : nextAsString
      ? `"${nextKey}": ${JSON.stringify(step.next[0] ?? '')}`
      : `"${nextKey}": ${JSON.stringify(step.next)}`;
  return `{ "id": ${JSON.stringify(step.id)}, ${tail} }`;
}

function arrayOf(
  steps: Step[],
  indent: string,
  line: (step: Step) => string = (step) => oneLine(step),
): string[] {
  return steps.map((step, index) => `${indent}${line(step)}${index === steps.length - 1 ? '' : ','}`);
}

const topLevel =
  (line?: (step: Step) => string, key = 'id'): Render =>
  (processes) => {
    const lines = [
      '{',
      '  "steps": [',
      ...arrayOf((processes[0] as Process).steps, '    ', line),
      '  ]',
      '}',
    ];
    return { lines, declares: locator(lines, (id) => `"${key}": ${JSON.stringify(id)}`, [0]) };
  };

const processMap: Render = (processes) => {
  const lines = ['{', '  "processes": {'];
  const starts: number[] = [];
  processes.forEach((process, index) => {
    starts.push(lines.length);
    lines.push(
      `    ${JSON.stringify(process.name)}: {`,
      '      "steps": [',
      ...arrayOf(process.steps, '        '),
      '      ]',
    );
    lines.push(`    }${index === processes.length - 1 ? '' : ','}`);
  });
  lines.push('  }', '}');
  return { lines, declares: locator(lines, (id) => `"id": ${JSON.stringify(id)}`, starts) };
};

const SHAPES: Shape[] = [
  {
    key: 'top-level',
    tier: 1,
    title: 'a top-level steps array',
    file: 'steps.json',
    processes: 1,
    render: topLevel(),
  },
  {
    key: 'anytime',
    tier: 1,
    title: 'a step allowed at any point',
    file: 'steps.json',
    processes: 1,
    render: topLevel(),
  },
  {
    key: 'process-map',
    tier: 3,
    title: 'a map of named processes',
    file: 'process-steps.json',
    processes: 1,
    render: processMap,
  },
  {
    key: 'process-map-two',
    tier: 3,
    title: 'two named processes in one map',
    file: 'process-steps.json',
    processes: 2,
    render: processMap,
  },
  {
    key: 'process-array',
    tier: 3,
    title: 'an array of named processes',
    file: 'processes.json',
    processes: 2,
    render: (processes) => {
      const lines = ['{', '  "processes": ['];
      const starts: number[] = [];
      processes.forEach((process, index) => {
        starts.push(lines.length);
        lines.push(
          `    { "name": ${JSON.stringify(process.name)}, "steps": [`,
          ...arrayOf(process.steps, '      '),
        );
        lines.push(`    ] }${index === processes.length - 1 ? '' : ','}`);
      });
      lines.push('  ]', '}');
      return { lines, declares: locator(lines, (id) => `"id": ${JSON.stringify(id)}`, starts) };
    },
  },
  {
    key: 'keyed-by-id',
    tier: 3,
    title: 'steps keyed by their id',
    file: 'steps.json',
    processes: 1,
    render: (processes) => {
      const steps = (processes[0] as Process).steps;
      const lines = [
        '{',
        '  "steps": {',
        ...steps.map(
          (step, index) =>
            `    ${JSON.stringify(step.id)}: { "next": ${JSON.stringify(step.next)} }${index === steps.length - 1 ? '' : ','}`,
        ),
        '  }',
        '}',
      ];
      return { lines, declares: locator(lines, (id) => `${JSON.stringify(id)}:`, [0]) };
    },
  },
  {
    key: 'next-string',
    tier: 2,
    title: 'a successor given as a string',
    file: 'steps.json',
    processes: 1,
    render: topLevel((step) => oneLine(step, 'next', true)),
  },
  {
    key: 'then-key',
    tier: 3,
    title: 'successors under a then key',
    file: 'steps.json',
    processes: 1,
    render: topLevel((step) => oneLine(step, 'then')),
  },
  {
    key: 'yaml',
    tier: 4,
    title: 'a YAML step list',
    file: 'steps.yaml',
    processes: 1,
    render: (processes) => {
      const lines = ['steps:'];
      for (const step of (processes[0] as Process).steps) {
        lines.push(`  - id: ${step.id}`, `    next: [${step.next.join(', ')}]`);
      }
      return { lines, declares: locator(lines, (id) => `- id: ${id}`, [0]) };
    },
  },
  {
    key: 'id-not-first',
    tier: 2,
    title: 'the id after the other keys',
    file: 'steps.json',
    processes: 1,
    render: topLevel((step) => `{ "next": ${JSON.stringify(step.next)}, "id": ${JSON.stringify(step.id)} }`),
  },
  {
    key: 'multi-line',
    tier: 2,
    title: 'one key per line',
    file: 'steps.json',
    processes: 1,
    render: (processes) => {
      const steps = (processes[0] as Process).steps;
      const lines = ['{', '  "steps": ['];
      steps.forEach((step, index) => {
        lines.push(
          '    {',
          `      "id": ${JSON.stringify(step.id)},`,
          `      "next": ${JSON.stringify(step.next)}`,
        );
        lines.push(`    }${index === steps.length - 1 ? '' : ','}`);
      });
      lines.push('  ]', '}');
      return { lines, declares: locator(lines, (id) => `"id": ${JSON.stringify(id)}`, [0]) };
    },
  },
  {
    key: 'nested-workflow',
    tier: 3,
    title: 'steps nested under a workflow key',
    file: 'workflow.json',
    processes: 1,
    render: (processes) => {
      const lines = [
        '{',
        '  "workflow": {',
        '    "steps": [',
        ...arrayOf((processes[0] as Process).steps, '      '),
        '    ]',
        '  }',
        '}',
      ];
      return { lines, declares: locator(lines, (id) => `"id": ${JSON.stringify(id)}`, [0]) };
    },
  },
  {
    key: 'spaced-ids',
    tier: 2,
    title: 'ids with capitals and spaces',
    file: 'steps.json',
    processes: 1,
    render: topLevel(),
  },
  {
    key: 'hooks-lib',
    tier: 3,
    title: 'a process map in the guards library folder',
    file: 'hooks/lib/process-steps.json',
    processes: 2,
    render: processMap,
  },
  {
    key: 'same-ids',
    tier: 4,
    title: 'the same step ids in two processes',
    file: 'process-steps.json',
    processes: 2,
    render: processMap,
  },
  {
    key: 'comments',
    tier: 4,
    title: 'JSON with comments',
    file: 'steps.jsonc',
    processes: 1,
    render: (processes) => {
      const base = topLevel()(processes);
      const lines = ['// The step list of the team.', ...base.lines];
      return { lines, declares: locator(lines, (id) => `"id": ${JSON.stringify(id)}`, [0]) };
    },
  },
  {
    key: 'trailing-commas',
    tier: 4,
    title: 'JSON with trailing commas',
    file: 'steps.json',
    processes: 1,
    render: (processes) => {
      const steps = (processes[0] as Process).steps;
      const lines = ['{', '  "steps": [', ...steps.map((step) => `    ${oneLine(step)},`), '  ],', '}'];
      return { lines, declares: locator(lines, (id) => `"id": ${JSON.stringify(id)}`, [0]) };
    },
  },
  {
    key: 'long-list',
    tier: 2,
    title: 'a list of sixty steps',
    file: 'steps.json',
    processes: 1,
    render: topLevel(),
    size: 60,
  },
  {
    key: 'dangling-next',
    tier: 2,
    title: 'a successor that names no step',
    file: 'steps.json',
    processes: 1,
    render: topLevel(),
  },
  {
    key: 'name-key',
    tier: 3,
    title: 'steps named under a name key',
    file: 'steps.json',
    processes: 1,
    render: topLevel(
      (step) => `{ "name": ${JSON.stringify(step.id)}, "next": ${JSON.stringify(step.next)} }`,
      'name',
    ),
  },
];

/** The steps of one process of an item: a chain with a loop back, ids unique to the item. */
function stepsOf(prefix: string, shape: Shape, process: number): Step[] {
  const size = shape.size ?? 4;
  const ids = Array.from({ length: size }, (_, index) =>
    shape.key === 'spaced-ids' ? `${prefix} Step ${index + 1}` : `${prefix}-s${index + 1}`,
  ).map((id) => (shape.key === 'same-ids' ? id : `${id}${process > 0 ? `-p${process}` : ''}`));
  const steps: Step[] = ids.map((id, index) => ({
    id,
    next: index + 1 < ids.length ? [ids[index + 1] as string] : [],
  }));
  if (shape.key === 'anytime') steps.push({ id: `${prefix}-note`, next: [], anytime: true });
  if (shape.key === 'dangling-next') (steps[0] as Step).next.push(`${prefix}-nowhere`);
  return steps;
}

export function stepsFamily(): Family {
  const items = itemsOf(
    FAMILY,
    1,
    COMPONENT,
    SHAPES.map(({ key, tier, title }) => ({ key, tier, title: `the reader reads the stages of ${title}` })),
  );
  return {
    id: FAMILY,
    level: 1,
    component: COMPONENT,
    items,
    async evaluate(seed) {
      const estate = new PlantedEstate();
      estate.file(STANDING, 'base').line('# Planted estate');
      writeSettings(estate);
      SHAPES.forEach((shape, index) => {
        const owner = `${FAMILY}.${shape.key}`;
        const prefix = `${namesFor(seed, owner).noun}${index}`;
        const processes: Process[] = Array.from({ length: shape.processes }, (_, process) => ({
          name: `process-${process + 1}`,
          steps: stepsOf(prefix, shape, process),
        }));
        const rendered = shape.render(processes);
        const file = `${ROOT}/${shape.file.replace(/^([^/]+)$/, `${prefix}-$1`).replace(/\/([^/]+)$/, `/${prefix}-$1`)}`;
        const writer = estate.file(file, owner);
        const atoms = new Map<number, Array<{ hid: string; kind: 'stage'; key: string }>>();
        processes.forEach((process, p) => {
          for (const step of process.steps) {
            const line = rendered.declares(p, step.id);
            atoms.set(line, [
              ...(atoms.get(line) ?? []),
              { hid: `${owner}:${p}:${step.id}`, kind: 'stage', key: step.id },
            ]);
            for (const next of step.next) {
              if (process.steps.some((candidate) => candidate.id === next)) {
                estate.edge(owner, `${owner}:${p}:${step.id}`, `${owner}:${p}:${next}`, 'next');
              }
            }
          }
        });
        if ([...atoms.keys()].some((line) => line < 1))
          throw new Error(`${owner}: a step has no declaring line`);
        rendered.lines.forEach((text, at) => {
          writer.line(text, atoms.get(at + 1) ?? []);
        });
      });
      const scan = await estate.scan();
      return estate.judge(
        scan,
        items.map((item) => item.id),
      );
    },
  };
}
