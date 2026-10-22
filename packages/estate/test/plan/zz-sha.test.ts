import { createHash } from 'node:crypto';
import { it } from 'vitest';
import { buildPlan, renderPlan, renderPlanSummary, toEstateSpaceMap } from '../../src/index';
import { approvedFixture } from './support';

it('prints the snapshot', async () => {
  const map = await approvedFixture();
  const built = buildPlan(map, { space: toEstateSpaceMap(map) });
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  console.log(`SNAPSHOT ${sha(renderPlan(built.plan))} ${sha(renderPlanSummary(built.plan, built.details))}`);
});
