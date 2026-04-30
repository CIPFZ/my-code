import { resolveTeamModel } from '../model/configs.js'

// Teammates inherit the current provider/model unless configured in my-code.
// Do not fall back to a Claude model family silently.
export function getHardcodedTeammateModelFallback(leaderModel?: string | null): string {
  return resolveTeamModel({ currentModel: leaderModel })
}
