import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Case } from './generate.mts';
import type { Outcome, Prompt } from './harness';

export const MAIN_COMMIT = '40aab09551e1b8702d576d3f28b63b12848cf572';
const path = fileURLToPath(new URL(`./.cache/arch-pinned/${MAIN_COMMIT}/`, import.meta.url));
const promptFile = `${path}packages/judges/src/prompt.ts`;
const snapshot = JSON.parse(
  readFileSync(new URL('./deciding/main-snapshot.json', import.meta.url), 'utf8'),
) as {
  commit: string;
  files: { path: string; sha256: string; source: string }[];
};
if (snapshot.commit !== MAIN_COMMIT) throw new Error('Main snapshot commit mismatch');
mkdirSync(`${path}packages/judges/src`, { recursive: true });
for (const file of snapshot.files) {
  if (createHash('sha256').update(file.source).digest('hex') !== file.sha256)
    throw new Error(`Main snapshot hash mismatch: ${file.path}`);
  const target = `${path}packages/judges/src/${file.path}`;
  if (existsSync(target) && readFileSync(target, 'utf8') !== file.source)
    throw new Error(`Main cache differs from pinned source: ${file.path}`);
  if (!existsSync(target)) writeFileSync(target, file.source);
}
const modules = `${path}packages/judges/node_modules`;
if (!existsSync(modules))
  symlinkSync(
    fileURLToPath(new URL('../../../packages/judges/node_modules', import.meta.url)),
    modules,
    'dir',
  );
// Core and stats sources have no diff between the baseline and this commit.
// Relative judge imports use the exact archived source; external packages and
// unchanged workspace dependencies resolve through the worktree's loader.
const prompt = await import(pathToFileURL(promptFile).href);
const contract = await import(pathToFileURL(`${path}packages/judges/src/contract.ts`).href);
export function mainRequest(c: Case) {
  return { criterion: c.criterion, transcript: [{ role: 'agent' as const, text: c.submission }] };
}
export function mainPrompt(c: Case): Prompt {
  // No answerContract override, assessment, reference or custom system prompt.
  return prompt.buildPrompt(mainRequest(c));
}
export function mainResult(text: string) {
  return contract.parseAnswerText(text);
}
export function parseMain(text: string): Outcome {
  return mainResult(text).answer.outcome;
}
