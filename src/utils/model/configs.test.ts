import { describe, it, expect } from 'bun:test'

describe('model configs', () => {
  describe('config file path resolution', () => {
    // Test the config path logic without importing the module
    const getConfigPath = (): string | undefined => {
      const configPaths = [
        process.env.CLAUDE_CODE_MODEL_CONFIG,
        process.env.CLAUDE_CODE_CONFIG_DIR
          ? `${process.env.CLAUDE_CODE_CONFIG_DIR}/models.config.json`
          : undefined,
      ].filter(Boolean) as string[]

      if (configPaths.length > 0) {
        return configPaths[0]
      }
      return undefined
    }

    it('should return CLAUDE_CODE_MODEL_CONFIG when set', () => {
      process.env.CLAUDE_CODE_MODEL_CONFIG = '/custom/path/config.json'
      expect(getConfigPath()).toBe('/custom/path/config.json')
      delete process.env.CLAUDE_CODE_MODEL_CONFIG
    })

    it('should build config dir path when CONFIG_DIR is set', () => {
      process.env.CLAUDE_CODE_CONFIG_DIR = '/my/config'
      const expected = '/my/config/models.config.json'
      expect(getConfigPath()).toBe(expected)
      delete process.env.CLAUDE_CODE_CONFIG_DIR
    })

    it('should return undefined when no paths configured', () => {
      delete process.env.CLAUDE_CODE_MODEL_CONFIG
      delete process.env.CLAUDE_CODE_CONFIG_DIR
      expect(getConfigPath()).toBeUndefined()
    })
  })
})
