import { FLOORS_FILE, type FloorsFile } from '@agent-nexus/driftbench-validators';

/** Reproduce a documented floor state without coupling the example to today's repository floors. */
export function parseFloorExample(example: string): FloorsFile {
  const prefix = `Floors (${FLOORS_FILE}): `;
  if (!example.startsWith(prefix) || !example.endsWith('.')) throw new Error('invalid floor output example');
  const fixture: FloorsFile = { version: 2, ladderVersion: {}, floors: {} };
  const body = example.slice(prefix.length, -1);
  if (body === 'none') return fixture;
  for (const entry of body.split(', ')) {
    const match = /^([a-z][a-z0-9-]*) = (\d+) \(ladder version (\d+)\)$/.exec(entry);
    if (!match) throw new Error(`invalid floor entry ${entry}`);
    const [, component, floor, version] = match;
    if (!component || floor === undefined || version === undefined)
      throw new Error(`incomplete floor entry ${entry}`);
    fixture.floors[component] = Number(floor);
    fixture.ladderVersion[component] = Number(version);
  }
  return fixture;
}
