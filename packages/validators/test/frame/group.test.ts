import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync: spawn }));

beforeEach(() => {
  vi.resetModules();
  spawn.mockReset();
  vi.stubEnv('DRIFTBENCH_FRAME_NO_NAMESPACE', '');
  vi.stubGlobal('process', { ...process, platform: 'linux', getuid: () => 1001, getgid: () => 1001 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('run C namespace startup', () => {
  it('refuses both failed Linux routes, names their causes, and never launches a fallback', async () => {
    spawn.mockImplementation((command: string) => ({
      status: 1,
      stderr: command === 'unshare' ? 'unshare: Operation not permitted' : 'sudo: a password is required',
    }));
    const { spawnGrouped } = await import('../../src/frame/group');
    const run = () =>
      spawnGrouped('node', ['product.mjs'], { name: 'TEST_RUN', value: 'fictional' }, { encoding: 'utf8' });
    // Repeating the call must not turn a cached failure into permission to start without a namespace.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(run).toThrow(/PID namespace/);
      expect(run).toThrow(/unshare.*Operation not permitted/);
      expect(run).toThrow(/sudo.*password is required/);
      expect(run).toThrow(/DRIFTBENCH_FRAME_NO_NAMESPACE=1/);
    }
    expect(spawn.mock.calls.every(([command]) => command === 'unshare' || command === 'sudo')).toBe(true);
  });

  it('reports a missing executable and a signal instead of silently falling back', async () => {
    spawn.mockImplementation((command: string) =>
      command === 'unshare'
        ? { status: null, error: new Error('spawnSync unshare ENOENT') }
        : { status: null, signal: 'SIGTERM' },
    );
    const { namespacePrefix } = await import('../../src/frame/group');
    expect(namespacePrefix).toThrow(/ENOENT/);
    expect(namespacePrefix).toThrow(/SIGTERM/);
  });

  it('uses the sudo route with the original uid and gid when user namespaces are refused', async () => {
    spawn.mockImplementation((command: string) => ({ status: command === 'sudo' ? 0 : 1 }));
    const { namespacePrefix } = await import('../../src/frame/group');
    expect(namespacePrefix()).toEqual([
      'sudo', '-n', '-E', 'unshare', '--pid', '--fork', '--kill-child', '--', 'setpriv',
      '--reuid=1001', '--regid=1001', '--clear-groups', '--',
    ]);
    expect(namespacePrefix()[0]).toBe('sudo');
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it.each(['linux', 'darwin'])('prints the accepted residual once per invocation on %s', async (platform) => {
    vi.stubGlobal('process', { ...process, platform });
    if (platform === 'linux') vi.stubEnv('DRIFTBENCH_FRAME_NO_NAMESPACE', '1');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { namespacePrefix } = await import('../../src/frame/group');
    const { finishInvocation } = await import('../../src/frame/confine');
    expect(namespacePrefix()).toEqual([]);
    expect(namespacePrefix()).toEqual([]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]?.[0]).toMatch(/leaves the session.*clears its environment.*outlive/);
    finishInvocation();
    expect(namespacePrefix()).toEqual([]);
    expect(err).toHaveBeenCalledTimes(2);
    expect(spawn).not.toHaveBeenCalled();
  });
});
