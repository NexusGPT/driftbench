import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as entry from '../../src/labeler-contract';
import {
  CONTRACT_FILES,
  CONTRACT_SETS,
  labelerContract,
  labelerContractCases,
} from '../../src/labeler-contract';
import { createHttpLabeler, type Labeler, type LabelerClass, loadModuleLabeler } from '../../src/pointer';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as {
  exports: Record<string, { types: string; import: string }>;
  scripts: { build: string };
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

describe('the labeler contract entry of the estate package', () => {
  it('is a second export of the package, built beside the main entry', () => {
    expect(manifest.exports['./labeler-contract']).toEqual({
      types: './dist/labeler-contract.d.ts',
      import: './dist/labeler-contract.js',
    });
    expect(manifest.scripts.build).toContain('src/labeler-contract.ts');
    expect(manifest.scripts.build).toContain('--external vitest');
  });

  it('needs vitest as an optional peer only', () => {
    expect(manifest.peerDependencies.vitest).toBeDefined();
    expect(manifest.peerDependenciesMeta.vitest?.optional).toBe(true);
  });

  it('exports the suite and its fixture, nothing else', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'CONTRACT_FILES',
      'CONTRACT_SETS',
      'labelerContract',
      'labelerContractCases',
    ]);
    expect(CONTRACT_FILES.every((file) => file.text.length > 0)).toBe(true);
    expect(CONTRACT_SETS).toContain('set: harbour-rules');
  });
});

// A local endpoint in the shape of each class: system 2 answers a label per unit, system 1 a probability per
// question. Invented answers; the endpoint reads only the request it is sent.
const VERBS = /^(?:- )?(Hang|Close|Check|Tie)\b/;
const labelOf = (text: string) =>
  /^(?:- )?Never\b/.test(text) ? 'prohibition' : VERBS.test(text) ? 'rule' : 'none';
let server: Server;
let base = '';
let requests = 0;
beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests++;
      const parsed = JSON.parse(body) as {
        window: { units: Array<{ n: number; text: string }> };
        questions?: Record<string, string>;
      };
      const send = (status: number, value: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (request.url === '/down') return send(503, { error: 'down' });
      if (request.url === '/garbled') return send(200, ['rule', 'none']);
      if (request.url === '/system1') {
        const text = new Map(parsed.window.units.map((unit) => [unit.n, unit.text]));
        const probabilities: Record<string, number> = {};
        for (const key of Object.keys(parsed.questions ?? {})) {
          const [, n, label] = /^u(\d+)__(.+)$/.exec(key) ?? [];
          probabilities[key] = labelOf(text.get(Number(n)) ?? '') === label ? 0.9 : 0.05;
        }
        return send(200, { model: 'harbour-p1', probabilities, usage: { input_tokens: 30 } });
      }
      return send(200, {
        model: 'harbour-1',
        labels: parsed.window.units.map((unit) => ({ units: String(unit.n), label: labelOf(unit.text) })),
      });
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

const http = (path: string, cls: LabelerClass) => (mode: { replayOnly: boolean }) =>
  // The factory runs inside each test, after the server is listening.
  createHttpLabeler({ url: `${base}${path}`, cls, maxRetries: 0, sleep: async () => {}, ...mode });

labelerContract('an HTTP endpoint of system 2', http('/system2', 'system2'), {
  cls: 'system2',
  broken: () => http('/down', 'system2')({ replayOnly: false }),
  malformed: () => http('/garbled', 'system2')({ replayOnly: false }),
});

labelerContract('an HTTP endpoint of system 1', http('/system1', 'system1'), {
  cls: 'system1',
  broken: () => http('/down', 'system1')({ replayOnly: false }),
  malformed: () => http('/garbled', 'system1')({ replayOnly: false }),
});

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const cwd = fileURLToPath(new URL('.', import.meta.url));
labelerContract('a module', (mode) => loadModuleLabeler(fixture('harbour-labeler.mjs'), { cwd, ...mode }), {
  cls: 'system2',
  broken: () => loadModuleLabeler(fixture('broken-labeler.mjs'), { cwd }),
  malformed: () => loadModuleLabeler(fixture('malformed-labeler.mjs'), { cwd }),
});

/** Runs one named check of the contract on a labeler, and says whether it held. */
async function holds(make: (mode: { replayOnly: boolean }) => Labeler | Promise<Labeler>, check: string) {
  const found = labelerContractCases(make, { cls: 'system2' }).find((each) => each.name.startsWith(check));
  if (!found) throw new Error(`no check ${check}`);
  return found.run().then(
    () => true,
    () => false,
  );
}

describe('the contract fails a labeler that breaks it', () => {
  const good = (mode: { replayOnly: boolean }) =>
    loadModuleLabeler(fixture('harbour-labeler.mjs'), { cwd, ...mode });

  it('holds the good module to every check', async () => {
    for (const check of ['names itself', 'renders a request', 'records every answer', 'puts its id'])
      expect(await holds(good, check), check).toBe(true);
  });

  it('fails a labeler that declares another class', async () => {
    const wrong = async (mode: { replayOnly: boolean }) => ({
      ...(await good(mode)),
      cls: 'system1' as const,
    });
    expect(await holds(wrong, 'names itself')).toBe(false);
  });

  it('fails a labeler whose request changes from one render to the next', async () => {
    let count = 0;
    const drifting = async (mode: { replayOnly: boolean }) => {
      const labeler = await good(mode);
      return {
        ...labeler,
        render: (...args: Parameters<Labeler['render']>) => ({
          ...labeler.render(...args),
          body: { n: count++ },
        }),
      };
    };
    expect(await holds(drifting, 'renders a request')).toBe(false);
  });

  it('fails a replay twin that can still call its service', async () => {
    const leaky = async () => good({ replayOnly: false });
    expect(await holds(leaky, 'records every answer')).toBe(false);
  });

  it('fails a labeler that keeps its id out of the cassette key', async () => {
    const anonymous = async (mode: { replayOnly: boolean }) => {
      const labeler = await good(mode);
      return {
        ...labeler,
        render: (...args: Parameters<Labeler['render']>) => ({
          ...labeler.render(...args),
          labeler: 'shared',
        }),
      };
    };
    expect(await holds(anonymous, 'renders a request')).toBe(false);
  });

  it('reached the endpoint only when recording', () => {
    expect(requests).toBeGreaterThan(0);
  });
});
