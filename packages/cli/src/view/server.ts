import { createHash, randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, extname } from 'node:path';
import {
  type Campaign,
  type RunResult,
  realizedTextOf,
  type Spec,
  type Store,
} from '@agent-nexus/driftbench-core';
import {
  type AnnotationAnchor,
  agreementOf,
  assign,
  completeItem,
  type LabelledBlock,
  labelFilePath,
  readLabelFile,
  readQueue,
  saveLabel,
  writeQueue,
} from '@agent-nexus/driftbench-judges';
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
  scoredRuns,
} from '@agent-nexus/driftbench-report';
import { openStore } from '@agent-nexus/driftbench-store';
import { fixListOption } from '../report-fixes';

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
  /** The score scale per criterion, from the config; a criterion without one scores 0 to 1. */
  scales?: Record<string, { min: number; max: number }>;
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
  const csrf = randomBytes(32).toString('hex');
  const cache = new Map<string, { runs: number; html: string }>();

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const authority = `${HOST}:${request.socket.localPort}`;
    const origin = `http://${authority}`;
    if (request.headers.host !== authority) throw new HttpError(403, 'Forbidden: untrusted Host.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '')) {
      let source = request.headers.origin;
      if (source === undefined && request.headers.referer !== undefined) {
        try {
          source = new URL(request.headers.referer).origin;
        } catch {
          throw new HttpError(403, 'Forbidden: invalid Referer.');
        }
      }
      if (source !== origin) throw new HttpError(403, 'Forbidden: untrusted origin.');
    }
    const fields = request.method === 'POST' ? new URLSearchParams(await readBody(request)) : undefined;
    if (fields && fields.get('csrf') !== csrf) throw new HttpError(403, 'Forbidden: invalid form token.');
    const url = new URL(request.url ?? '/', origin);
    const parts = url.pathname
      .split('/')
      .filter((part) => part !== '')
      .map(decodeURIComponent);
    if (fields && url.pathname === '/labels') {
      const location = await saveFromForm(store, options.labels, labelledBy, fields, options.scales ?? {});
      response.writeHead(303, { location });
      response.end();
      return;
    }
    if (fields && url.pathname === '/queue/assign') {
      const criterion = fields.get('criterion') ?? '';
      const id = fields.get('id') ?? '';
      try {
        await writeQueue(options.labels, assign(await readQueue(options.labels), criterion, id, labelledBy));
      } catch (cause) {
        throw new HttpError(400, cause instanceof Error ? cause.message : String(cause));
      }
      response.writeHead(303, { location: '/queue' });
      response.end();
      return;
    }
    if (request.method !== 'GET')
      throw new HttpError(405, 'Only GET, and POST to /labels and /queue/assign.');
    if (parts.length === 0) return send(response, await indexPage(store));
    if (parts[0] === 'compare' && parts.length === 1) return send(response, await comparePage(store, url));
    if (parts[0] === 'keys' && parts.length === 1) return send(response, keysPage());
    if (parts[0] === 'queue' && parts.length === 1)
      return send(
        response,
        await queuePage(options.labels, labelledBy, csrf),
        200,
        scriptHashOf(QUEUE_KEYS_SCRIPT),
      );
    if (parts[0] === 'campaign' && parts.length === 2) {
      const data = await campaignData(store, parts[1] as string);
      const key = data.campaign.campaignId;
      let held = cache.get(key);
      if (!held || held.runs !== data.runs.length) {
        const html = renderHtml(buildScorecard(data, { maxRuns: 400, ...fixListOption(data) }), {
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
      return send(
        response,
        await runPage(data, run, options.labels, url.searchParams.get('saved'), csrf),
        200,
        scriptHashOf(LABEL_KEYS_SCRIPT),
      );
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
      if (status === 403) {
        response.writeHead(status, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(message);
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

/** The one script a viewer page may run: the queue's keyboard moves, allowed by the hash of its exact text. */
export const QUEUE_KEYS_SCRIPT = `(function () {
  var items = function () {
    return Array.prototype.slice.call(document.querySelectorAll('#queue tbody a, #queue tbody button'));
  };
  document.addEventListener('keydown', function (event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === '?') { window.location.href = '/keys'; event.preventDefault(); return; }
    var down = event.key === 'j' || event.key === 'ArrowDown';
    var up = event.key === 'k' || event.key === 'ArrowUp';
    if (!down && !up) return;
    var list = items();
    if (list.length === 0) return;
    var at = list.indexOf(document.activeElement);
    var next = down ? Math.min(list.length - 1, at + 1) : Math.max(0, at - 1);
    list[next].focus();
    event.preventDefault();
  });
})();`;

function send(response: ServerResponse, html: string, status = 200, scriptHash?: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // Nothing loads from anywhere: no external script, style, image or font. The scorecard's font faces are
    // embedded in the page as data. Forms post to this server.
    'content-security-policy': [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      'font-src data:',
      ...(scriptHash === undefined ? [] : [`script-src 'sha256-${scriptHash}'`]),
      "form-action 'self'",
      "base-uri 'none'",
    ].join('; '),
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
  return `<nav class="top"><strong>driftbench view</strong><a href="/">Campaigns</a><a href="/compare">Compare</a><a href="/queue">Queue</a><a href="/keys">Keys</a>${extra}</nav>`;
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

/** The review queue: each item with its state, who holds it, and the action the viewer reviewer can take. */
/**
 * The label form's keys, progressive enhancement only: 1 checks pass, 2 checks fail (not while typing in the
 * note), Cmd or Ctrl+Enter submits the form. Every control works without it.
 */
export const LABEL_KEYS_SCRIPT = `(function () {
  var typing = function (target) {
    return target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type !== 'radio'));
  };
  var blocks = function () {
    return Array.prototype.slice.call(document.querySelectorAll('div.block'));
  };
  document.addEventListener('keydown', function (event) {
    var target = event.target;
    var form = target && target.closest ? target.closest('div.labels form') : null;
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && form) {
      event.preventDefault();
      if (form.requestSubmit) form.requestSubmit(); else form.submit();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || typing(target)) return;
    if (event.key === '?') {
      window.location.href = '/keys';
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (target && target.tagName === 'SELECT') return;
      var list = blocks();
      if (list.length === 0) return;
      var at = -1;
      for (var i = 0; i < list.length; i += 1) if (list[i].contains(target)) at = i;
      var step = event.key === 'ArrowDown' ? 1 : -1;
      var nextAt = at < 0 ? (step > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + step));
      var shown = Array.prototype.slice.call(list[nextAt].querySelectorAll('select, input, a, button')).filter(function (el) { return el.offsetParent !== null; });
      var control = shown[0] || list[nextAt];
      if (control === list[nextAt] && !control.hasAttribute('tabindex')) control.setAttribute('tabindex', '-1');
      control.focus();
      list[nextAt].scrollIntoView({ block: 'nearest' });
      event.preventDefault();
      return;
    }
    if (!form) return;
    if (event.key !== '1' && event.key !== '2') return;
    var radio = form.querySelector('input[name=label][value=' + (event.key === '1' ? 'pass' : 'fail') + ']');
    if (!radio) return;
    radio.checked = true;
    radio.focus();
    event.preventDefault();
  });
})();`;

/** The keyboard cheatsheet: plain HTML, no script, linked from every page. */
function keysPage(): string {
  return renderPage('driftbench view: keys', [
    nav(),
    `<section id="keys"><h2>Keyboard</h2><p>These keys work when the page runs its script. Every button and link also works without them.</p><table><caption>Keys</caption><thead><tr><th scope="col">key</th><th scope="col">where</th><th scope="col">does</th></tr></thead><tbody><tr><td class="mono">j, ArrowDown</td><td>queue</td><td>next item</td></tr><tr><td class="mono">k, ArrowUp</td><td>queue</td><td>previous item</td></tr><tr><td class="mono">Enter</td><td>queue</td><td>open or take the focused item</td></tr><tr><td class="mono">ArrowDown, ArrowUp</td><td>block page</td><td>next or previous block</td></tr><tr><td class="mono">1</td><td>block page</td><td>check pass</td></tr><tr><td class="mono">2</td><td>block page</td><td>check fail</td></tr><tr><td class="mono">Cmd or Ctrl+Enter</td><td>block page</td><td>save the label</td></tr><tr><td class="mono">?</td><td>every page</td><td>open this page</td></tr></tbody></table><p class="muted">Keys are ignored while you type in the note.</p></section>`,
  ]);
}

function scriptHashOf(text: string): string {
  return createHash('sha256').update(text).digest('base64');
}

async function queuePage(labelsDir: string, reviewer: string, csrf: string): Promise<string> {
  const queue = await readQueue(labelsDir);
  const agreement = agreementOf(queue);
  const agreementLine =
    agreement.items === 0 || agreement.percent === undefined
      ? 'No item has two votes yet: no agreement to show.'
      : `Agreement over ${agreement.items} item${agreement.items === 1 ? '' : 's'} with two votes: ${agreement.agreed} agree (${Math.round(agreement.percent * 100)}%), kappa ${agreement.kappa === undefined ? 'n/a' : agreement.kappa.toFixed(2)}.`;
  const rows = queue.entries.map((entry) => {
    const block = `${runPath(entry.campaign, entry.runId)}#block-${entry.index}`;
    const action =
      entry.state === 'open'
        ? `<form method="post" action="/queue/assign"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="criterion" value="${esc(entry.criterion)}"><input type="hidden" name="id" value="${esc(entry.id)}"><button type="submit">Take</button></form>`
        : entry.state === 'assigned' && entry.assignee === reviewer
          ? `<a href="${esc(block)}">Label it</a>`
          : entry.state === 'done'
            ? 'done'
            : '';
    return `<tr><td>${esc(entry.state)}</td><td class="mono">${esc(entry.criterion)}</td><td class="mono"><a href="${esc(block)}">${esc(entry.id)}</a></td><td>${esc(entry.assignee ?? '-')}</td><td>${action}</td></tr>`;
  });
  const body =
    rows.length === 0
      ? '<p class="muted">The queue is empty. Queue a campaign with driftbench queue create.</p>'
      : `<div class="table-wrap"><table><caption>${queue.entries.length} items</caption><thead><tr><th scope="col">state</th><th scope="col">criterion</th><th scope="col">block</th><th scope="col">held by</th><th scope="col"></th></tr></thead><tbody>${rows.join('\n')}</tbody></table></div>`;
  return renderPage('driftbench view: queue', [
    nav(),
    `<section id="queue"><h2>Review queue</h2><p>Take an item, open its block, label it. Saving the label marks the item done. Keys: j and k move between items; Enter opens or takes the focused one.</p>${body}<p class="muted">${esc(agreementLine)}</p></section><script>${QUEUE_KEYS_SCRIPT}</script>`,
  ]);
}

/** Runs that pass, fail, or neither, for the index: a run not run or blocked is in its own column. */
export function passingAndFailing(runs: readonly RunResult[]): {
  passing: number;
  failing: number;
  unscored: number;
} {
  const passing = runs.filter(runPassed).length;
  const scored = scoredRuns(runs).length;
  return { passing, failing: scored - passing, unscored: runs.length - scored };
}

async function indexPage(store: Store): Promise<string> {
  const campaigns = await store.listCampaigns();
  const rows: string[] = [];
  for (const campaign of campaigns) {
    const data = await loadCampaign(store, campaign.campaignId);
    const { passing, failing, unscored } = passingAndFailing(data.runs);
    rows.push(
      `<tr><td class="mono"><a href="/campaign/${encodeURIComponent(campaign.campaignId)}">${esc(campaign.campaignId)}</a></td><td>${esc(campaign.createdAt)}</td><td>${esc(campaign.modes.join(', '))}</td><td class="num">${campaign.specs.length}</td><td class="num">${data.runs.length} runs</td><td class="num">${unscored}</td><td class="num">${passing}</td><td class="num">${failing}</td></tr>`,
    );
  }
  const body =
    rows.length === 0
      ? '<p class="muted">The store holds no campaign. Run one with driftbench campaign run.</p>'
      : `<div class="table-wrap"><table><caption>Campaigns, newest first</caption><thead><tr><th scope="col">campaign</th><th scope="col">created</th><th scope="col">modes</th><th scope="col">specs</th><th scope="col">runs</th><th scope="col">not run or blocked</th><th scope="col">passing</th><th scope="col">failing</th></tr></thead><tbody>${rows.join('\n')}</tbody></table></div>`;
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

type HeldLabel = { criterion: string; label: string; note?: string; flags?: LabelledBlock['flags'] };

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
      list.push({
        criterion,
        label: block.label,
        ...(block.flags === undefined ? {} : { flags: block.flags }),
        ...(block.note === undefined ? {} : { note: block.note }),
      });
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
  csrf: string,
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
          `<li class="mono">${esc(entry.criterion)}: ${esc(entry.label)}${entry.note ? `. ${esc(entry.note)}` : ''}${entry.flags?.includes('sent text not stored') ? '. Sent text not stored; excluded from calibration' : ''}</li>`,
      )
      .join('');
    const criterionField =
      criteria.length > 0
        ? `<select name="criterion" aria-label="Criterion">${criteria.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select>`
        : '<input name="criterion" aria-label="Criterion" placeholder="criterion" required pattern="[A-Za-z0-9][A-Za-z0-9._-]*">';
    const anchorField = `<label>Anchor <select name="anchor" aria-label="Anchor"><option value="none">no anchor</option>${anchorOptions(
      block,
    )
      .map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`)
      .join('')}</select></label>`;
    return `<div class="labels"><p class="label">Your label for this block${existing.length > 0 ? `, ${existing.length} saved` : ''}</p>${shown ? `<ul>${shown}</ul>` : ''}<form method="post" action="/labels">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="campaign" value="${esc(campaignId)}"><input type="hidden" name="run" value="${esc(run.runId)}"><input type="hidden" name="block" value="${block.index}">
${criterionField}
${anchorField}
<label><input type="radio" name="label" value="pass" required> pass</label><label><input type="radio" name="label" value="fail"> fail</label>
<label>Score <input name="score" type="number" min="0" max="1" step="0.01" aria-label="Score" placeholder="0 to 1"></label>
<p class="muted">With script on: 1 marks pass, 2 marks fail, Cmd or Ctrl+Enter saves. Without it the buttons work the same.</p>
<input name="note" aria-label="Note" placeholder="note: why">
<button type="submit">Save label</button></form></div>`;
  };
  const banner = saved ? `<p class="saved">Label saved: ${esc(saved)}.</p>` : '';
  const tally = new Map<string, { pass: number; fail: number }>();
  for (const list of held.values()) {
    for (const entry of list) {
      if (entry.flags?.includes('sent text not stored')) continue;
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
    `<script>${LABEL_KEYS_SCRIPT}</script>`,
  ]);
}

/** Saves the label a form posted and returns where the browser goes next. */
/** The transcript a label judges: the stimulus, each tool call with its result, then the reply. */
function transcriptOf(block: BlockDetail) {
  const text = realizedTextOf(block.authoredText, block.realized);
  return [
    ...(text === undefined ? [] : [{ role: 'user' as const, text }]),
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
export function anchorOptions(
  block: BlockDetail,
): { value: string; label: string; anchor: AnnotationAnchor }[] {
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
  for (const [call, output] of block.toolCalls.map((call) => [call, call.output] as const)) {
    for (const path of leafPaths(output, 3)) {
      options.push({
        value: `field:${call.label}:${path}`,
        label: `field ${path} of ${call.label}`,
        anchor: { kind: 'field', path },
      });
    }
  }
  for (const event of block.timelineEvents ?? []) {
    options.push({
      value: `span:${event.id}`,
      label: event.label,
      anchor: { kind: 'span', span_id: event.id },
    });
  }
  for (const event of block.runtimeEvents ?? []) {
    const spanId = `${event.kind}:${event.name}`;
    options.push({
      value: `span:${spanId}`,
      label: `${event.kind} ${event.name}`,
      anchor: { kind: 'span', span_id: spanId },
    });
  }
  return options;
}

/** The dot paths of the leaf values of a JSON value, up to a depth. Arrays and text count as leaves. */
export function leafPaths(value: unknown, depth: number, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || depth === 0) {
    return prefix === '' ? [] : [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, depth - 1, prefix === '' ? key : `${prefix}.${key}`),
  );
}

async function saveFromForm(
  store: Store,
  labelsDir: string,
  labelledBy: string,
  fields: URLSearchParams,
  scales: Record<string, { min: number; max: number }>,
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
  // The form offers the judged criteria of the spec and those that voted on the block; when it offers some,
  // a label on any other criterion is refused and writes no file. With none, the form takes a free name.
  const offered = criteriaOf(data.specs.get(`${run.specId}@${run.specHash}`)?.spec, run, index);
  if (offered.length > 0 && !offered.includes(criterion)) {
    throw new HttpError(400, `The block offers the criteria ${offered.join(', ')}, not ${criterion}.`);
  }
  const transcript = transcriptOf(block);
  const picked = fields.get('anchor') ?? 'none';
  let anchor: AnnotationAnchor | undefined;
  if (picked !== 'none') {
    const option = anchorOptions(block).find((entry) => entry.value === picked);
    if (!option) throw new HttpError(400, `${picked} is not an anchor of this block.`);
    anchor = option.anchor;
  }
  const scoreText = (fields.get('score') ?? '').trim();
  const score = scoreText === '' ? undefined : Number(scoreText);
  const scale = scales[criterion] ?? { min: 0, max: 1 };
  if (score !== undefined && !(Number.isFinite(score) && score >= scale.min && score <= scale.max)) {
    throw new HttpError(400, `score ${scoreText} is outside the scale ${scale.min} to ${scale.max}.`);
  }
  const labelled: LabelledBlock = {
    id: blockId(run.runId, index),
    label,
    ...(note === '' ? {} : { note }),
    transcript,
    ...(block.realized !== undefined && realizedTextOf(block.authoredText, block.realized) === undefined
      ? { flags: ['sent text not stored' as const] }
      : {}),
    ...(anchor === undefined ? {} : { anchor }),
  };
  const queue = await readQueue(labelsDir);
  const entry = queue.entries.find((item) => item.criterion === criterion && item.id === labelled.id);
  // Another reviewer cannot label an item held by someone else.
  if (entry && entry.state === 'assigned' && entry.assignee !== labelledBy) {
    throw new HttpError(409, `${entry.id} on ${criterion} is held by ${entry.assignee}.`);
  }
  if (entry && entry.state === 'assigned' && entry.assignee === labelledBy) {
    await writeQueue(
      labelsDir,
      await completeItem(labelsDir, queue, criterion, entry.id, labelledBy, labelled, score, scale),
    );
  } else {
    await saveLabel(labelsDir, criterion, labelled, labelledBy);
  }
  return `${runPath(campaignId, run.runId)}?saved=${encodeURIComponent(criterion)}#block-${index}`;
}
