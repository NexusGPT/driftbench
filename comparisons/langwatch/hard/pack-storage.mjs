import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { scanText } from '../../../tools/guard/guard.mjs';

const here = new URL('./', import.meta.url);
const digest = (data) => createHash('sha256').update(data).digest('hex');
const manifest = {
  version: 1,
  originalCommit: '73939d09686bd7d214acc6dfcc74b831d1ed991d',
  modelInputsResponsesLabelsCostsUnchanged: true,
  files: [],
};
mkdirSync(new URL('storage/', here), { recursive: true });
for (const path of ['recorded/calls.jsonl', 'pii/hard.json', 'pii/heldout.json']) {
  const original = readFileSync(new URL(path, here));
  const lines = original.toString().match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const parts = [];
  let body = '',
    index = 0,
    allowed = 0;
  function flush() {
    if (!body) return;
    const file = `storage/${path.replaceAll('/', '-')}-part-${String(index++).padStart(4, '0')}.jsonl`;
    writeFileSync(new URL(file, here), body);
    parts.push({ path: file, sha256: digest(body), bytes: Buffer.byteLength(body) });
    body = '';
  }
  for (const line of lines) {
    const findings = scanText(line).findings;
    if (findings.some((f) => f.kind !== 'iban' || !/^GB\d{2}ZZZZ\d{14}$/.test(f.value)))
      throw Error(`Unproven pattern in ${path}`);
    const record = { line };
    if (findings.length) {
      record['guard:allow'] =
        'Constructed synthetic GB IBAN with unallocated ZZZZ bank code; original bytes restored for replay';
      allowed += findings.length;
    }
    const encoded = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(body) + Buffer.byteLength(encoded) > 6 * 1024 * 1024) flush();
    body += encoded;
  }
  flush();
  manifest.files.push({
    path,
    originalSha256: digest(original),
    originalBytes: original.length,
    lineCount: lines.length,
    provenSyntheticFindings: allowed,
    parts,
  });
}
writeFileSync(new URL('storage/manifest.json', here), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify(
    manifest.files.map((f) => ({
      path: f.path,
      parts: f.parts.length,
      syntheticIbanFindings: f.provenSyntheticFindings,
    })),
  ),
);
