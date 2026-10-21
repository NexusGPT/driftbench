import { fileURLToPath } from 'node:url';
import { type AgentAdapter, loadSpecFile, runSpec } from '@agent-nexus/driftbench-core';
import { initializeShippedObjects } from '@agent-nexus/driftbench-checks';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { expect, it } from 'vitest';
import { createSimulatedUser, loadPersona, loadUserRecording, personaOptions, userRecordingPort } from '../src/index';

initializeShippedObjects();

it('pairs the Northwind invoice recording with a stand-in that asks before receiving facts', async () => {
  const root = new URL('../../../examples/northwind-campaign/', import.meta.url);
  const persona = await loadPersona(fileURLToPath(new URL('personas/nora-whitfield.yaml', root)));
  const recording = await loadUserRecording(fileURLToPath(new URL('personas/recordings/nora-whitfield.yaml', root)));
  const loaded = await loadSpecFile(fileURLToPath(new URL('specs/invoice-over.yaml', root)));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const pluginPath = fileURLToPath(new URL('plugin.mjs', root));
  const { default: plugin } = await import(pluginPath);
  let adapter: AgentAdapter | undefined;
  await plugin({ adapter: (_name: string, factory: (target: { agent: string }) => AgentAdapter) => { adapter = factory({ agent: 'northwind' }); } });
  if (adapter === undefined) throw new Error('Northwind adapter was not registered');
  const port = userRecordingPort(recording);
  const driver = createSimulatedUser({ ...personaOptions(persona), port, agentFamily: 'anthropic', judgeFamilies: [] });
  const result = await runSpec(loaded.spec, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
  expect(result.status, result.error).toBe('completed');
  expect(result.blocks).toHaveLength(3);
  expect(result.blocks[0]?.observed.text).toMatch(/invoice.*\?/i);
  expect(port.requests[1]?.user).toContain('- invoice: INV-1004');
  expect(port.requests[1]?.user).toContain('- order: PO-77');
});

it('uses the stop recording for the stop sibling, not the other sibling at the same depth', async () => {
  const root = new URL('../../../examples/northwind-campaign/', import.meta.url);
  const persona = await loadPersona(fileURLToPath(new URL('personas/priya-nand.yaml', root)));
  const recording = await loadUserRecording(fileURLToPath(new URL('personas/recordings/priya-nand.yaml', root)));
  const loaded = await loadSpecFile(fileURLToPath(new URL('specs/ledger-branches.yaml', root)));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const seen: string[] = [];
  const adapter = functionAdapter({ create: () => undefined, respond: (messages) => {
    seen.push(messages.at(-1)?.content ?? '');
    return { segments: [], text: 'Noted.', toolCalls: [], cost: {}, latencyMs: 0 };
  } });
  const driver = createSimulatedUser({ ...personaOptions(persona), port: userRecordingPort(recording), agentFamily: 'none', judgeFamilies: [] });
  const result = await runSpec(loaded.spec, { adapter, driver, checks: [], mode: 'F', repeat: 0 });
  expect(result.status, result.error).toBe('completed');
  expect(seen).toEqual(recording.answers);
});
