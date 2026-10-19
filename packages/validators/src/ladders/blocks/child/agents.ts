import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { steadyText } from './wire';

/**
 * The planted agents an item serves over loopback, as the frame's two runs of a command reach them
 * (docs/validators.md section 13, "The bank runs the product through the frame"). Each run of a command first asks
 * every agent of the item for its role: the first run of the command (run A) gets the agent itself, and every
 * request it makes is answered by the item's own scripted agent and recorded; its twin (run B) gets the
 * recording: each request is answered with what run A got for the same request, after the same delay. So the
 * agent's own state and logs see one run only, and a twin that asks what run A did not gets an error, which shows
 * as a difference between the runs. A request with no role (no frame) goes to the agent as it is.
 */

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
type Recorded = {
  body: string;
  status: number;
  headers: OutgoingHttpHeaders;
  text: string;
  delayMs: number;
  used: boolean;
};

const live = new Set<string>();

/** A request without the route its run reached the agent by. */
const unrouted = (text: string) => text.replace(/\/twin\d+(?=\/)/g, '');
/** A request as the recording matches it: its clocks, random ids and the run's own route masked. */
const steady = (text: string) => steadyText(unrouted(text));

/** The agents of this process that a command may call: their base URLs. */
export function liveAgents(): string[] {
  return [...live];
}

export function addAgent(base: string): void {
  live.add(base);
}

export function dropAgent(base: string): void {
  live.delete(base);
}

export function twinRouted(handler: Handler): Handler {
  let asked = 0;
  const roles = new Map<string, 'live' | 'replay'>();
  let records: Recorded[] = [];
  return (request, response) => {
    const url = request.url ?? '/';
    if (url === '/__twin') {
      asked += 1;
      const token = `twin${asked}`;
      const role = asked % 2 === 1 ? 'live' : 'replay';
      roles.set(token, role);
      if (role === 'live') records = [];
      request.resume();
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(token);
      return;
    }
    const match = /^\/(twin\d+)(\/.*)?$/.exec(url);
    const role = match ? roles.get(match[1] as string) : undefined;
    if (!match || !role) {
      handler(request, response);
      return;
    }
    let body = '';
    let ended = 0;
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    if (role === 'live') {
      // The agent reads the request as the command sent it, without the run's route in it.
      const plain = Object.assign(new PassThrough(), {
        url: match[2] ?? '/',
        method: request.method,
        headers: request.headers,
      }) as unknown as IncomingMessage;
      request.on('end', () => {
        ended = Date.now();
        (plain as unknown as PassThrough).end(unrouted(body));
      });
      const record: Recorded = { body: '', status: 200, headers: {}, text: '', delayMs: 0, used: false };
      const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => ServerResponse;
      response.writeHead = ((status: number, ...rest: unknown[]) => {
        record.status = status;
        const headers = rest.find((each) => each !== null && typeof each === 'object');
        if (headers) record.headers = headers as OutgoingHttpHeaders;
        return writeHead(status, ...rest);
      }) as ServerResponse['writeHead'];
      const end = response.end.bind(response) as (...args: unknown[]) => ServerResponse;
      response.end = ((chunk?: unknown, ...rest: unknown[]) => {
        record.body = steady(body);
        record.status = response.statusCode;
        record.text = typeof chunk === 'string' || Buffer.isBuffer(chunk) ? String(chunk) : '';
        record.delayMs = ended === 0 ? 0 : Date.now() - ended;
        if (Object.keys(record.headers).length === 0) record.headers = response.getHeaders();
        records.push(record);
        return end(chunk, ...rest);
      }) as ServerResponse['end'];
      handler(plain, response);
      return;
    }
    request.on('end', () => {
      const asked = steady(body);
      const found = records.find((each) => !each.used && each.body === asked);
      if (!found) {
        if (process.env.BLOCKS_FRAME_DEBUG)
          process.stderr.write(
            `twin request with no recording: ${body.slice(0, 600)}\nrecorded: ${records.map((each) => each.body.slice(0, 600)).join('\n')}\n`,
          );
        response.writeHead(502, { 'content-type': 'text/plain' });
        response.end('run A of this command made no such request');
        return;
      }
      found.used = true;
      setTimeout(() => {
        response.writeHead(found.status, found.headers);
        response.end(found.text);
      }, found.delayMs);
    });
  };
}
