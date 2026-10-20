export type { CampaignDeps, CampaignScope } from './commands/campaign';
export { type CoverageOptions, coverageCommand } from './commands/coverage';
export { lintCommand, validateCommand } from './commands/spec';
export { type Io, processIo } from './io';
export { type MainOptions, main } from './main';
export {
  type DriftbenchPlugin,
  definePlugin,
  type PluginAdapterFactory,
  type PluginApi,
  type PluginFunction,
  type PluginImpl,
  type PluginKind,
  type PluginPromptTemplate,
  type PluginScope,
} from './plugins';
export { VERSION } from './version';

/**
 * The campaign commands' own exports, loaded on demand so that importing this package stays light:
 * `defaultDeps`, what the commands run with, and `campaignRunCommand(paths, options, io, deps)`, one campaign
 * without the argument parser.
 */
export async function campaignCommands() {
  const { campaignRunCommand, defaultDeps } = await import('./commands/campaign');
  return { campaignRunCommand, defaultDeps };
}
