/**
 * Model configuration constants - no external dependencies to avoid circular imports
 */
export type ModelConfig = Record<string, string>

// @[MODEL LAUNCH]: Add a new config constant here.
export const CLAUDE_3_7_SONNET_CONFIG: ModelConfig = {
  firstParty: 'claude-3-7-sonnet-20250219',
  bedrock: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  vertex: 'claude-3-7-sonnet@20250219',
  foundry: 'claude-3-7-sonnet',
  openai: 'claude-3-7-sonnet-20250219',
}

export const CLAUDE_3_5_V2_SONNET_CONFIG: ModelConfig = {
  firstParty: 'claude-3-5-sonnet-20241022',
  bedrock: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  vertex: 'claude-3-5-sonnet-v2@20241022',
  foundry: 'claude-3-5-sonnet',
  openai: 'claude-3-5-sonnet-20241022',
}

export const CLAUDE_3_5_HAIKU_CONFIG: ModelConfig = {
  firstParty: 'claude-3-5-haiku-20241022',
  bedrock: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  vertex: 'claude-3-5-haiku@20241022',
  foundry: 'claude-3-5-haiku',
  openai: 'claude-3-5-haiku-20241022',
}

export const CLAUDE_HAIKU_4_5_CONFIG: ModelConfig = {
  firstParty: 'claude-haiku-4-5-20251001',
  bedrock: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  vertex: 'claude-haiku-4-5@20251001',
  foundry: 'claude-haiku-4-5',
  openai: 'claude-haiku-4-5-20251001',
}

export const CLAUDE_SONNET_4_CONFIG: ModelConfig = {
  firstParty: 'claude-sonnet-4-20250514',
  bedrock: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  vertex: 'claude-sonnet-4@20250514',
  foundry: 'claude-sonnet-4',
  openai: 'claude-sonnet-4-20250514',
}

export const CLAUDE_SONNET_4_5_CONFIG: ModelConfig = {
  firstParty: 'claude-sonnet-4-5-20250929',
  bedrock: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  vertex: 'claude-sonnet-4-5@20250929',
  foundry: 'claude-sonnet-4-5',
  openai: 'claude-sonnet-4-5-20250929',
}

export const CLAUDE_OPUS_4_CONFIG: ModelConfig = {
  firstParty: 'claude-opus-4-20250514',
  bedrock: 'us.anthropic.claude-opus-4-20250514-v1:0',
  vertex: 'claude-opus-4@20250514',
  foundry: 'claude-opus-4',
  openai: 'claude-opus-4-20250514',
}

export const CLAUDE_OPUS_4_1_CONFIG: ModelConfig = {
  firstParty: 'claude-opus-4-1-20250805',
  bedrock: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
  vertex: 'claude-opus-4-1@20250805',
  foundry: 'claude-opus-4-1',
  openai: 'claude-opus-4-1-20250805',
}

export const CLAUDE_OPUS_4_5_CONFIG: ModelConfig = {
  firstParty: 'claude-opus-4-5-20251101',
  bedrock: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  vertex: 'claude-opus-4-5@20251101',
  foundry: 'claude-opus-4-5',
  openai: 'claude-opus-4-5-20251101',
}

export const CLAUDE_OPUS_4_6_CONFIG: ModelConfig = {
  firstParty: 'claude-opus-4-6',
  bedrock: 'us.anthropic.claude-opus-4-6-v1',
  vertex: 'claude-opus-4-6',
  foundry: 'claude-opus-4-6',
  openai: 'claude-opus-4-6',
}

export const CLAUDE_SONNET_4_6_CONFIG: ModelConfig = {
  firstParty: 'claude-sonnet-4-6',
  bedrock: 'us.anthropic.claude-sonnet-4-6',
  vertex: 'claude-sonnet-4-6',
  foundry: 'claude-sonnet-4-6',
  openai: 'claude-sonnet-4-6',
}

// OpenAI Codex models
export const GPT_5_4_CONFIG: ModelConfig = {
  firstParty: 'gpt-5.4',
  bedrock: 'gpt-5.4',
  vertex: 'gpt-5.4',
  foundry: 'gpt-5.4',
  openai: 'gpt-5.4',
}

export const GPT_5_3_CODEX_CONFIG: ModelConfig = {
  firstParty: 'gpt-5.3-codex',
  bedrock: 'gpt-5.3-codex',
  vertex: 'gpt-5.3-codex',
  foundry: 'gpt-5.3-codex',
  openai: 'gpt-5.3-codex',
}

export const GPT_5_4_MINI_CONFIG: ModelConfig = {
  firstParty: 'gpt-5.4-mini',
  bedrock: 'gpt-5.4-mini',
  vertex: 'gpt-5.4-mini',
  foundry: 'gpt-5.4-mini',
  openai: 'gpt-5.4-mini',
}

// @[MODEL LAUNCH]: Register the new config here.
export const ALL_MODEL_CONFIGS = {
  haiku35: CLAUDE_3_5_HAIKU_CONFIG,
  haiku45: CLAUDE_HAIKU_4_5_CONFIG,
  sonnet35: CLAUDE_3_5_V2_SONNET_CONFIG,
  sonnet37: CLAUDE_3_7_SONNET_CONFIG,
  sonnet40: CLAUDE_SONNET_4_CONFIG,
  sonnet45: CLAUDE_SONNET_4_5_CONFIG,
  sonnet46: CLAUDE_SONNET_4_6_CONFIG,
  opus40: CLAUDE_OPUS_4_CONFIG,
  opus41: CLAUDE_OPUS_4_1_CONFIG,
  opus45: CLAUDE_OPUS_4_5_CONFIG,
  opus46: CLAUDE_OPUS_4_6_CONFIG,
  gpt54: GPT_5_4_CONFIG,
  gpt53codex: GPT_5_3_CODEX_CONFIG,
  gpt54mini: GPT_5_4_MINI_CONFIG,
} as const

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS
