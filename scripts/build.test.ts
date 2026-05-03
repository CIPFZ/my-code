import { describe, expect, test } from 'bun:test'
import { getOutfile, parseBuildOptions } from './build.js'

describe('build script options', () => {
  test('defaults to my-code output names', () => {
    expect(getOutfile(parseBuildOptions([]))).toBe('./my-code')
    expect(getOutfile(parseBuildOptions(['--dev']))).toBe('./my-code-dev')
    expect(getOutfile(parseBuildOptions(['--compile']))).toBe('./dist/my-code')
  })

  test('parses custom app and config names', () => {
    const options = parseBuildOptions([
      '--app-name',
      'other-code',
      '--config-dir-name=.other-code',
      '--models-config-file',
      'other.models.json',
      '--dry-run',
    ])

    expect(options.appName).toBe('other-code')
    expect(options.configDirName).toBe('.other-code')
    expect(options.modelsConfigFile).toBe('other.models.json')
    expect(options.dryRun).toBe(true)
    expect(getOutfile(options)).toBe('./other-code')
  })

  test('parses feature flags without running a build', () => {
    const options = parseBuildOptions([
      '--feature',
      'ULTRAPLAN',
      '--feature=TOKEN_BUDGET',
    ])

    expect(options.features).toContain('VOICE_MODE')
    expect(options.features).toContain('ULTRAPLAN')
    expect(options.features).toContain('TOKEN_BUDGET')
  })
})
