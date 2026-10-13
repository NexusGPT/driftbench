import type { ArtifactKind } from '@agent-nexus/driftbench-core';
import { isRecord } from './args';
import { type CheckTable, type KindReader, ReaderDocument, type TextCheck } from './document';
import { decodeText, lines, TEXT_CHECKS } from './text';

/**
 * The text and code readers. A code file answers the text checks; its tests are not run here. Running a
 * command is the execution check's job, in the sandbox, so `tests` fails and says so instead of passing
 * on a file nobody executed.
 */

const tests: TextCheck = {
  reads: 'text',
  usage: 'tests: { command: "pnpm test" }; the execution check runs commands, not the code reader',
  run(arg) {
    const command =
      isRecord(arg) && typeof arg.command === 'string' ? ` (${JSON.stringify(arg.command)} was not run)` : '';
    return {
      ok: false,
      evidence: `the code reader runs no command: the execution check owns commands${command}; check the run with expect.execution`,
    };
  },
};

export const TEXT_FILE_CHECKS: CheckTable<never> = { ...TEXT_CHECKS, lines };

export const CODE_CHECKS: CheckTable<never> = { ...TEXT_CHECKS, lines, tests };

function plainReader(kind: ArtifactKind, checks: CheckTable<never>): KindReader {
  return {
    kind,
    checkNames: Object.keys(checks),
    async open(bytes, path) {
      return new ReaderDocument<never>(kind, path, decodeText(bytes), checks, undefined);
    },
  };
}

export const textReader = plainReader('text', TEXT_FILE_CHECKS);

export const codeReader = plainReader('code', CODE_CHECKS);
