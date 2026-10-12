import { mergeConfig } from 'vitest/config';
import root from '../../../../vitest.config';

/** Runs the fixture files only, with the aliases of the repository. */
export default mergeConfig(root, {
  test: {
    include: ['packages/vitest/test/fixtures/*.fixture.ts'],
    root: new URL('../../../../', import.meta.url).pathname,
  },
});
