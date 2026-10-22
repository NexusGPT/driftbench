import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';
import { generateEstateSuite } from '../../../generate/src/estate/generate';
import { fixtureInputs, PLANNER_PATHS } from '../../../generate/test/estate/support';

// Temporary: regenerates the committed generated suite of the fixture (no model call).
vi.setConfig({ testTimeout: 900_000 });
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
it('regenerates the generated suite', async () => {
  const planner = join(ROOT, 'packages/generate/test/estate/fixtures/planner-plan.approved.yaml');
  const result = generateEstateSuite(await fixtureInputs(planner), { paths: PLANNER_PATHS });
  const dir = join(ROOT, 'examples/estates/fixture/generated');
  await rm(dir, { recursive: true, force: true });
  for (const file of result.files) {
    await mkdir(dirname(join(dir, file.path)), { recursive: true });
    await writeFile(join(dir, file.path), file.text);
  }
  console.log(`[REGEN] ${result.files.length} files; ${JSON.stringify(result.report.summary)}`);
});
