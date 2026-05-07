import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const root = process.cwd()

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(join(root, dir))
  const files: string[] = []
  for (const entry of entries) {
    const relative = join(dir, entry)
    const absolute = join(root, relative)
    const stats = statSync(absolute)
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(relative))
    } else if (/\.[jt]sx?$/.test(entry)) {
      files.push(relative)
    }
  }
  return files
}

describe('auth removal', () => {
  it('does not keep login or logout command modules', () => {
    expect(existsSync(join(root, 'src/commandsprovider configuration'))).toBe(false)
    expect(existsSync(join(root, 'src/commandsprovider configuration'))).toBe(false)
    expect(existsSync(join(root, 'src/components/ConsoleOAuthFlow.tsx'))).toBe(
      false,
    )
  })

  it('does not register auth or setup-token commands in main', () => {
    const main = read('src/main.tsx')

    expect(main).not.toContain(`program.command('auth')`)
    expect(main).not.toContain(`program.command('setup-token')`)
    expect(main).not.toContain(`program.command('login')`)
    expect(main).not.toContain(`program.command('logout')`)
  })

  it('does not keep setup-token handler in util handlers', () => {
    const utilHandlers = read('src/cli/handlers/util.tsx')

    expect(utilHandlers).not.toContain('setupTokenHandler')
    expect(utilHandlers).not.toContain('ConsoleOAuthFlow')
  })

  it('does not expose custom api configuration through /model', () => {
    const modelCommand = read('src/commands/model/model.tsx')

    expect(modelCommand).not.toContain('saveCustomApiConfigAndFetchModels')
    expect(modelCommand).not.toContain("args === 'custom'")
    expect(modelCommand).not.toContain('Custom API Configuration')
  })

  it('does not keep credential changes auth handlers or imports', () => {
    const authHandler = read('src/cli/handlers/auth.ts')
    const upgrade = read('src/commands/upgrade/upgrade.tsx')
    const extraUsage = read('src/commands/extra-usage/extra-usage.tsx')

    expect(authHandler).not.toContain('authLogin')
    expect(authHandler).not.toContain('authLogout')
    expect(authHandler).not.toContain('performLogout')
    expect(authHandler).not.toContain('../../commandsprovider configurationprovider configuration.js')
    expect(upgrade).not.toContain('..provider configurationprovider configuration.js')
    expect(extraUsage).not.toContain('..provider configurationprovider configuration.js')
  })

  it('does not keep visible Free Code branding in the startup UI', () => {
    const cliEntrypoint = read('src/entrypoints/cli.tsx')
    const logo = read('src/components/LogoV2/LogoV2.tsx')
    const welcome = read('src/components/LogoV2/WelcomeV2.tsx')
    const condensed = read('src/components/LogoV2/CondensedLogo.tsx')
    const main = read('src/main.tsx')

    expect(logo).not.toContain('Free Code')
    expect(welcome).not.toContain('Free Code')
    expect(condensed).not.toContain('Free Code')
    expect(main).toContain(`program.name('my-code')`)
    expect(main).toContain('MyCode - starts an interactive session')
    expect(main).toContain('MACRO.VERSION} (MyCode)')
    expect(cliEntrypoint).toContain('MACRO.VERSION} (MyCode)')
  })

  it('does not keep removed slash auth command references in source', () => {
    const slashLogin = '/log' + 'in'
    const slashLogout = '/log' + 'out'
    const setupToken = 'setup' + '-token'
    const offending = listSourceFiles('src')
      .filter(path => !path.endsWith('commands.auth-removal.test.ts'))
      .filter(path => {
        const content = read(path)
        return (
          content.includes(slashLogin) ||
          content.includes(slashLogout) ||
          content.includes(setupToken)
        )
      })

    expect(offending).toEqual([])
  })
})
