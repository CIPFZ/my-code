import type { PermissionMode } from '../permissions/PermissionMode.js'
import { capitalize } from '../stringUtils.js'
import { MODEL_ALIASES } from './aliases.js'
import { resolveAgentModel } from './configs.js'

export const AGENT_MODEL_OPTIONS = [...MODEL_ALIASES, 'inherit'] as const
export type AgentModelAlias = (typeof AGENT_MODEL_OPTIONS)[number]

export type AgentModelOption = {
  value: AgentModelAlias
  label: string
  description: string
}

/**
 * Get the default subagent model. Returns 'inherit' so subagents inherit
 * the model from the parent thread.
 */
export function getDefaultSubagentModel(): string {
  return 'inherit'
}

/**
 * Get the effective model string for an agent using resolver-style priority:
 * tool-specified, configured agent/default, current provider model, then
 * compatible frontmatter alias. Legacy sonnet/opus/haiku aliases are only
 * accepted when mapped in my-code config.
 */
export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: string,
  _permissionMode?: PermissionMode,
  agentName?: string,
): string {
  return resolveAgentModel({
    agentName,
    toolSpecifiedModel,
    agentModel,
    currentModel: parentModel,
  })
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
  return [
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
    ...MODEL_ALIASES.map(alias => ({
      value: alias,
      label: capitalize(alias),
      description: `Use configured my-code alias '${alias}'`,
    })),
  ]
}
