import type { PermissionMode } from '../permissions/PermissionMode.js'
import { capitalize } from '../stringUtils.js'
import {
  loadModelsConfig,
  resolveConfiguredModelAlias,
  type ModelsConfig,
} from './providerConfig.js'

export const AGENT_MODEL_OPTIONS = ['inherit'] as const
export type AgentModelAlias = string

export type AgentModelOption = {
  value: AgentModelAlias
  label: string
  description: string
}

/**
 * Get the default subagent model. Returns 'inherit' so subagents inherit
 * the model from the parent thread.
 */
export function getDefaultSubagentModel(
  config?: ModelsConfig,
  parentModel?: string,
): string {
  if (parentModel) return 'inherit'
  return (
    config?.agents?.defaultModel ??
    loadModelsConfig().agents?.defaultModel ??
    'inherit'
  )
}

/**
 * Get the effective model string for an agent.
 *
 * Model selection priority:
 * 1. CLAUDE_CODE_SUBAGENT_MODEL override, resolved through configured aliases.
 * 2. Tool-specified model, resolved through configured aliases, with `inherit` using the parent model.
 * 3. Agent frontmatter model, resolved through agents.models and configured aliases.
 * 4. `inherit` by default, falling back to agents.defaultModel when no parent is available.
 */
export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: string,
  _permissionMode?: PermissionMode,
): string {
  const config = loadModelsConfig()

  if (process.env.CLAUDE_CODE_SUBAGENT_MODEL) {
    return resolveAgentModelValue(process.env.CLAUDE_CODE_SUBAGENT_MODEL, parentModel, config)
  }

  if (toolSpecifiedModel) {
    return resolveAgentModelValue(toolSpecifiedModel, parentModel, config)
  }

  const agentModelWithDefault =
    agentModel ?? getDefaultSubagentModel(config, parentModel)
  return resolveAgentModelValue(agentModelWithDefault, parentModel, config)
}

function resolveAgentModelValue(
  model: string,
  parentModel: string,
  config: ModelsConfig,
): string {
  const trimmedModel = model.trim()
  if (trimmedModel === 'inherit') return parentModel

  const routedModel = config.agents?.models?.[trimmedModel] ?? trimmedModel
  return resolveConfiguredModelAlias(routedModel, config) ?? routedModel
}

export function getDefaultTeamModel(parentModel?: string): string {
  if (parentModel) return parentModel
  const config = loadModelsConfig()
  const configuredModel =
    config.teams?.models?.main ??
    config.teams?.models?.agent ??
    config.teams?.defaultModel ??
    config.agents?.defaultModel
  if (!configuredModel) return 'inherit'
  return resolveConfiguredModelAlias(configuredModel, config) ?? configuredModel
}

export function getAgentModelDisplay(model: string | undefined): string {
  // When model is omitted, getDefaultSubagentModel() returns 'inherit' at runtime
  if (!model) return 'Inherit from parent (default)'
  if (model === 'inherit') return 'Inherit from parent'
  return capitalize(model)
}

/**
 * Get available model options for agents
 */
export function getAgentModelOptions(): AgentModelOption[] {
  const config = loadModelsConfig()
  return [
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
    ...Object.entries(config.agents?.models ?? {}).map(([value, model]) => ({
      value,
      label: capitalize(value),
      description: `Use configured agent model ${model}`,
    })),
  ]
}
