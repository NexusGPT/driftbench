/**
 * What the pointer level runs in: a child process whose built-in objects are read-only before the module under
 * test is imported (`lock.ts`), so the module cannot change the way the bank counts its misses. The child runs
 * every item of the pointer bank on one seed and prints one JSON line. Usage: <seed> <root>, with
 * DRIFTBENCH_POINTER_IMPL naming a copy of the module, as in `loadPointerImpl`.
 */
import { lockIntrinsics } from './lock';

lockIntrinsics();

async function main(): Promise<void> {
  const [seedText, root] = process.argv.slice(2);
  const seed = Number(seedText);
  const { loadPointerImpl, pointerBank, pointerFixtures } = await import('./pointer');
  const fixtures = pointerFixtures(root as string);
  let impl: Awaited<ReturnType<typeof loadPointerImpl>> | undefined;
  let loadError: string | undefined;
  try {
    impl = await loadPointerImpl();
  } catch (cause) {
    loadError = `the module under audit did not load: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`;
  }
  const results: Array<{
    id: string;
    family: string;
    tier: number;
    component: string;
    cause: string;
    misses: string[];
  }> = [];
  for (const item of pointerBank()) {
    let misses: string[];
    if (!impl) misses = [loadError ?? 'the module under audit did not load'];
    else {
      try {
        misses = await item.run(impl, fixtures, seed, root as string);
      } catch (cause) {
        misses = [`threw ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`];
      }
    }
    results.push({
      id: item.id,
      family: item.family,
      tier: item.tier,
      component: item.component,
      cause: item.cause,
      misses,
    });
  }
  process.stdout.write(`${JSON.stringify(results)}\n`, () => process.exit(0));
}

main().catch((cause) => {
  process.stderr.write(`pointer child failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
  process.exit(1);
});
