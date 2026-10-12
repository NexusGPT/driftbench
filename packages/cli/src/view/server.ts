import { readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, extname } from 'node:path';
import type { Campaign, RunResult, Spec, Store } from '@driftbench/core';
import { type AnnotationAnchor, labelFilePath, readLabelFile, saveLabel } from '@driftbench/judges';
import {
  type BlockDetail,
  buildScorecard,
  type CampaignData,
  compareCampaigns,
  loadCampaign,
  ReportInputError,
  renderCompare,
  renderHtml,
  renderPage,
  renderRun,
  runDetailOf,
  runPassed,
} from '@driftbench/report';
import { openStore } from '@driftbench/store';

/**
 * The local viewer of `driftbench view`: pages served from the store, with the scorecard's renderer and
 * style, no script and no external asset. It listens on the loopback address only.
 *
 * - `/`: the campaigns of the store.
 * - `/campaign/<id>`: the campaign's scorecard (spread view included), each run linking to its page.
 * - `/campaign/<id>/run/<runId>`: one run block by block, with a label form under every block.
 * - `/compare?baseline=<id>&candidate=<id>&margin=<points>`: the paired comparison of two campaigns.
 * - `POST /labels`: saves one hand label (pass or fail, per block and criterion, with a note) to the labels
 *   folder `judge calibrate --labels` reads, then sends the browser back to the block.
 */

export type ViewerOptions = {
  /** The store file. */
  store: string;
  /** The labels folder labels are written to. */
  labels: string;
  /** The port; 0 picks a free one. */
  port: number;
  /** Who labels, written as `labelled_by` in a new labels file. */
  labelledBy?: string;
};

export type Viewer = {
  /** `http://127.0.0.1:<port>`. */
  url: string;
  close(): Promise<void>;
};

const HOST = '127.0.0.1';
const BODY_LIMIT = 64 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function startViewer(options: ViewerOptions): Promise<Viewer> {
  const store = openStore(options.store);
  const labelledBy = options.labelledBy ?? 'a reviewer, in driftbench view';
  const cache = new Map<string, { runs: number; html: string }>();

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', `http://${HOST}`);
    const parts = url.pathname
      .split('/')
      .filter((part) => part !== '')
      .map(decodeURIComponent);
    if (request.method === 'POST' && url.pathname === '/labels') {
      const fields = new URLSearchParams(await readBody(request));
      const location = await saveFromForm(store, options.labels, labelledBy, fields);
      response.writeHead(303, { location });
      response.end();
      return;
    }
    if (request.method !== 'GET') throw new HttpError(405, 'Only GET, and POST to /labels.');
    if (parts.length === 0) return send(response, await indexPage(store));
    if (parts[0] === 'compare' && parts.length === 1) return send(response, await comparePage(store, url));
    if (parts[0] === 'campaign' && parts.length === 2) {
      const data = await campaignData(store, parts[1] as string);
      const key = data.campaign.campaignId;
      let held = cache.get(key);
      if (!held || held.runs !== data.runs.length) {
        const html = renderHtml(buildScorecard(data, { maxRuns: 400 }), {
          nav: nav(),
          runHref: (runId) => runPath(key, runId),
        });
        held = { runs: data.runs.length, html };
        cache.set(key, held);
      }
      return send(response, held.html);
    }
    if (parts[0] === 'campaign' && parts[2] === 'run' && parts.length === 4) {
      const data = await campaignData(store, parts[1] as string);
      const run = data.runs.find((entry) => entry.runId === parts[3]);
      if (!run) throw new HttpError(404, `No run ${parts[3]} in campaign ${parts[1]}.`);
      return send(response, await runPage(data, run, options.labels, url.searchParams.get('saved')));
    }
    throw new HttpError(404, `Nothing at ${url.pathname}.`);
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((cause: unknown) => {
      const status = cause instanceof HttpError ? cause.status : 500;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (response.headersSent) {
        response.end();
        return;
      }
      send(response, errorPage(status, message), status);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://${HOST}:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await store.close();
    },
  };
}

function send(response: ServerResponse, html: string, status = 200): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // Nothing loads from anywhere: no script, no external style, image or font. Forms post to this server.
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  });
  response.end(html);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, 'The form is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function runPath(campaignId: string, runId: string): string {
  return `/campaign/${encodeURIComponent(campaignId)}/run/${encodeURIComponent(runId)}`;
}

function nav(extra = ''): string {
  return `<nav class="top"><strong>driftbench view</strong><a href="/">Campaigns</a><a href="/compare">Compare</a>${extra}</nav>`;
}

function errorPage(status: number, message: string): string {
  return renderPage(`Error ${status}`, [
    nav(),
    `<section><h2>Error ${status}</h2><p>${esc(message)}</p></section>`,
  ]);
}

async function campaignData(store: Store, campaignId: string): Promise<CampaignData> {
  try {
    return await loadCampaign(store, campaignId);
  } catch (cause) {
    if (cause instanceof ReportInputError) throw new HttpError(404, cause.message);
    throw cause;
  }
}

async function indexPage(store: Store): Promise<string> {
  const campaigns = await store.listCampaigns();
  const rows: string[] = [];
  for (const campaign of campaigns) {
    const data = await loadCampaign(store, campaign.campaignId);
    const passing = data.runs.filter(runPassed).length;
    rows.push(
      `<tr><td class="mono"><a href="/campaign/${encodeURIComponent(campaign.campaignId)}">${esc(campaign.campaignId)}</a></td><td>${esc(campaign.createdAt)}</td><td>${esc(campaign.modes.join(', '))}</td><td class="num">${campaign.specs.length}</td><td class="num">${data.runs.length} runs</td><td class="num">${passing}</td><td class="num">${data.runs.length - passing}</td></tr>`,
    );
  }
  const body =
    rows.length === 0
      ? '<p class="muted">The store holds no campaign. Run one with driftbench campaign run.</p>'
      : `<div class="table-wrap"><table><caption>Campaigns, newest first</caption><thead><tr><th scope="col">campaign</th><th scope="col">created</th><th scope="col">modes</th><th scope="col">specs</th><th scope="col">runs</th><th scope="col">passing</th><th scope="col">not passing</th></tr></thead><tbody>${rows.join('\n')}</tbody></table></div>`;
  return renderPage('driftbench view', [
    nav(),
    `<section id="campaigns"><h2>Campaigns</h2><p>Open a campaign for its scorecard and its runs; open a run to label its blocks. Compare two campaigns paired on the goldens both ran.</p>${body}</section>`,
  ]);
}

function campaignOptions(campaigns: readonly Campaign[], chosen: string | null): string {
  return campaigns
    .map(
      (campaign) =>
        `<option value="${esc(campaign.campaignId)}"${campaign.campaignId === chosen ? ' selected' : ''}>${esc(campaign.campaignId)}</option>`,
    )
    .join('');
}

async function comparePage(store: Store, url: URL): Promise<string> {
  const campaigns = await store.listCampaigns();
  const baseline = url.searchParams.get('baseline');
  const candidate = url.searchParams.get('candidate');
  const marginText = url.searchParams.get('margin') ?? '2';
  const form = `<section id="compare-form"><h2>Compare two campaigns</h2><form method="get" action="/compare" class="labels">
<label>Baseline <select name="baseline">${campaignOptions(campaigns, baseline)}</select></label>
<label>Candidate <select name="candidate">${campaignOptions(campaigns, candidate)}</select></label>
<label>Margin, points <input name="margin" value="${esc(marginText)}" inputmode="decimal" size="4"></label>
<button type="submit">Compare</button></form></section>`;
  if (baseline === null || candidate === null) return renderPage('Compare', [nav(), form]);
  const margin = Number(marginText);
  if (!Number.isFinite(margin) || margin <= 0 || margin >= 100) {
    throw new HttpError(
      400,
      `The margin takes a number of points above 0 and below 100, not "${marginText}".`,
    );
  }
  const left = await campaignData(store, baseline);
  const right = await campaignData(store, candidate);
  let result: ReturnType<typeof compareCampaigns>;
  try {
    result = compareCampaigns(left, right, { margin: margin / 100 });
  } catch (cause) {
    throw new HttpError(400, cause instanceof Error ? cause.message : String(cause));
  }
  return renderPage(`Compare ${candidate} with ${baseline}`, [nav(), form, renderCompare(result)]);
}

type HeldLabel = { criterion: string; label: string; note?: string };

/** Every label in the labels folder, by block id. */
async function labelsById(dir: string): Promise<Map<string, HeldLabel[]>> {
  const out = new Map<string, HeldLabel[]>();
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => ['.yaml', '.yml'].includes(extname(name))).sort();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw cause;
  }
  for (const name of names) {
    const criterion = basename(name, extname(name));
    let blocks: Awaited<ReturnType<typeof readLabelFile>>;
    try {
      blocks = await readLabelFile(dir, criterion);
    } catch {
      // A file that is not a labels file is judge calibrate's to report; the viewer shows the others.
      continue;
    }
    for (const block of blocks) {
      const list = out.get(block.id) ?? [];
      list.push({ criterion, label: block.label, ...(block.note === undefined ? {} : { note: block.note }) });
      out.set(block.id, list);
    }
  }
  return out;
}

/** The judged criteria a block can be labelled on: the spec's, the block's, and any judged verdict's. */
function criteriaOf(spec: Spec | undefined, run: RunResult, index: number): string[] {
  const names = new Set<string>();
  for (const def of spec?.criteria ?? []) names.add(def.name);
  const block = run.blocks[index];
  for (const verdict of block?.verdicts ?? []) if (verdict.kind === 'judge') names.add(verdict.name);
  return [...names].sort();
}

function blockId(runId: string, index: number): string {
  return `${runId}.b${index}`;
}

async function runPage(
  data: CampaignData,
  run: RunResult,
  labelsDir: string,
  saved: string | null,
): Promise<string> {
  const detail = runDetailOf(data, run);
  const spec = data.specs.get(`${run.specId}@${run.specHash}`)?.spec;
  const held = await labelsById(labelsDir);
  const campaignId = data.campaign.campaignId;
  const form = (block: BlockDetail): string => {
    const criteria = criteriaOf(spec, run, block.index);
    const existing = held.get(blockId(run.runId, block.index)) ?? [];
    const shown = existing
      .map(
        (entry) =>
          `<li class="mono">${esc(entry.criterion)}: ${esc(entry.label)}${entry.note ? `. ${esc(entry.note)}` : ''}</li>`,
      )
      .join('');
    const criterionField =
      criteria.length > 0
        ? `<select name="criterion" aria-label="Criterion">${criteria.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select>`
        : '<input name="criterion" aria-label="Criterion" placeholder="criterion" required pattern="[A-Za-z0-9][A-Za-z0-9._-]*">';
    const anchorField = `<label>Anchor <select name="anchor" aria-label="Anchor"><option value="none">no anchor</option>${anchorOptions(block)
      .map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`)
      .join('')}</select></label>`;
    return `<div class="labels"><p class="label">Your label for this block${existing.length > 0 ? `, ${existing.length} saved` : ''}</p>${shown ? `<ul>${shown}</ul>` : ''}<form method="post" action="/labels">
<input type="hidden" name="campaign" value="${esc(campaignId)}"><input type="hidden" name="run" value="${esc(run.runId)}"><input type="hidden" name="block" value="${block.index}">
${criterionField}
${anchorField}
<label><input type="radio" name="label" value="pass" required> pass</label><label><input type="radio" name="label" value="fail"> fail</label>
<input name="note" aria-label="Note" placeholder="note: why">
<button type="submit">Save label</button></form></div>`;
  };
  const banner = saved ? `<p class="saved">Label saved: ${esc(saved)}.</p>` : '';
  const tally = new Map<string, { pass: number; fail: number }>();
  for (const list of held.values()) {
    for (const entry of list) {
      const count = tally.get(entry.criterion) ?? { pass: 0, fail: 0 };
      if (entry.label === 'pass') count.pass += 1;
      else count.fail += 1;
      tally.set(entry.criterion, count);
    }
  }
  const counts = [...tally.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([criterion, count]) =>
        `<li><span class="mono">${esc(criterion)}</span>: ${count.pass} pass, ${count.fail} fail${count.pass === 0 || count.fail === 0 ? `. judge calibrate needs at least one ${count.pass === 0 ? 'pass' : 'fail'} label on it` : ''}.</li>`,
    )
    .join('');
  const summary = counts === '' ? '<p class="muted">No label in the folder yet.</p>' : `<ul>${counts}</ul>`;
  return renderPage(`Run ${run.runId}`, [
    nav(`<a href="/campaign/${encodeURIComponent(campaignId)}">${esc(campaignId)}</a>`),
    `<section id="labelling"><h2>Labelling</h2>${banner}<p>Mark each block pass or fail on a criterion, with a note. Labels go to <span class="mono">${esc(labelsDir)}</span>, one file per criterion, the folder <span class="mono">driftbench judge calibrate --labels</span> reads. Labelling a block again on the same criterion replaces its label.</p>${summary}</section>`,
    renderRun(detail, form),
  ]);
}

/** Saves the label a form posted and returns where the browser goes next. */
/** The transcript a label judges: the stimulus, each tool call with its result, then the reply. */
function transcriptOf(block: BlockDetail) {
  return [
    ...(block.stimulus === undefined ? [] : [{ role: 'user' as const, text: block.stimulus }]),
    ...block.toolCalls.flatMap((call) => [
      { role: 'tool_call' as const, text: JSON.stringify(call.input ?? null), tool: call.label },
      ...(call.output === undefined && call.error === undefined
        ? []
        : [
            {
              role: 'tool_result' as const,
              text: call.error ?? JSON.stringify(call.output),
              tool: call.label,
            },
          ]),
    ]),
    { role: 'agent' as const, text: block.text },
  ];
}

/**
 * The anchors a label can pick in this block: each transcript line by its index, and each tool call by its name
 * and occurrence. The value is what the form posts; the anchor is what the label file keeps.
 */
export function anchorOptions(block: BlockDetail): { value: string; label: string; anchor: AnnotationAnchor }[] {
  const options: { value: string; label: string; anchor: AnnotationAnchor }[] = [];
  const occurrences = new Map<string, number>();
  transcriptOf(block).forEach((entry, index) => {
    options.push({
      value: `message:${index}`,
      label: `line ${index}: ${entry.role}`,
      anchor: { kind: 'message', index },
    });
    if (entry.role === 'tool_call') {
      const tool = entry.tool ?? '';
      const occurrence = (occurrences.get(tool) ?? 0) + 1;
      occurrences.set(tool, occurrence);
      options.push({
        value: `tool:${tool}:${occurrence}`,
        label: `tool ${tool}, call ${occurrence}`,
        anchor: { kind: 'tool_call', tool, occurrence },
      });
    }
  });
  return options;
}

async function saveFromForm(
  store: Store,
  labelsDir: string,
  labelledBy: string,
  fields: URLSearchParams,
): Promise<string> {
  const campaignId = fields.get('campaign') ?? '';
  const runId = fields.get('run') ?? '';
  const criterion = fields.get('criterion') ?? '';
  const label = fields.get('label');
  const note = (fields.get('note') ?? '').trim();
  const index = Number(fields.get('block'));
  if (label !== 'pass' && label !== 'fail') throw new HttpError(400, 'The label is pass or fail.');
  try {
    labelFilePath(labelsDir, criterion);
  } catch {
    throw new HttpError(400, `Not a criterion name: ${criterion}.`);
  }
  let data: CampaignData;
  try {
    data = await loadCampaign(store, campaignId);
  } catch (cause) {
    if (cause instanceof ReportInputError) throw new HttpError(400, cause.message);
    throw cause;
  }
  const run = data.runs.find((entry) => entry.runId === runId);
  if (!run) throw new HttpError(400, `No run ${runId} in campaign ${campaignId}.`);
  const detail = runDetailOf(data, run);
  const block = detail.blocks.find((entry) => entry.index === index);
  if (!Number.isInteger(index) || !block)
    throw new HttpError(400, `The run has no block ${fields.get('block')}.`);
  const transcript = transcriptOf(block);
  const picked = fields.get('anchor') ?? 'none';
  let anchor: AnnotationAnchor | undefined;
  if (picked !== 'none') {
    const option = anchorOptions(block).find((entry) => entry.value === picked);
    if (!option) throw new HttpError(400, `${picked} is not an anchor of this block.`);
    anchor = option.anchor;
  }
  await saveLabel(
    labelsDir,
    criterion,
    {
      id: blockId(run.runId, index),
      label,
      ...(note === '' ? {} : { note }),
      transcript,
      ...(anchor === undefined ? {} : { anchor }),
    },
    labelledBy,
  );
  return `${runPath(campaignId, run.runId)}?saved=${encodeURIComponent(criterion)}#block-${index}`;
}
