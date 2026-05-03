import { chmodSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { basename, dirname } from 'path'

export type BuildOptions = {
  compile: boolean
  dev: boolean
  dryRun: boolean
  appName: string
  configDirName: string
  modelsConfigFile: string
  defaultModelsConfigJson?: string
  features: string[]
}

const DEFAULT_APP_NAME = 'my-code'
const DEFAULT_CONFIG_DIR_NAME = '.my-code'
const DEFAULT_MODELS_CONFIG_FILE = 'models.config.json'

const pkg = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
  name: string
  version: string
}

const fullExperimentalFeatures = [
  'AGENT_MEMORY_SNAPSHOT',
  'AGENT_TRIGGERS',
  'AGENT_TRIGGERS_REMOTE',
  'AWAY_SUMMARY',
  'BASH_CLASSIFIER',
  'BRIDGE_MODE',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'CACHED_MICROCOMPACT',
  'CCR_AUTO_CONNECT',
  'CCR_MIRROR',
  'CCR_REMOTE_SETUP',
  'COMPACTION_REMINDERS',
  'CONNECTOR_TEXT',
  'EXTRACT_MEMORIES',
  'HISTORY_PICKER',
  'HOOK_PROMPTS',
  'KAIROS_BRIEF',
  'KAIROS_CHANNELS',
  'LODESTONE',
  'MCP_RICH_OUTPUT',
  'MESSAGE_ACTIONS',
  'NATIVE_CLIPBOARD_IMAGE',
  'NEW_INIT',
  'POWERSHELL_AUTO_MODE',
  'PROMPT_CACHE_BREAK_DETECTION',
  'QUICK_SEARCH',
  'SHOT_STATS',
  'TEAMMEM',
  'TOKEN_BUDGET',
  'TREE_SITTER_BASH',
  'TREE_SITTER_BASH_SHADOW',
  'ULTRAPLAN',
  'ULTRATHINK',
  'UNATTENDED_RETRY',
  'VERIFICATION_AGENT',
  'VOICE_MODE',
] as const

function runCommand(cmd: string[]): string | null {
  const proc = Bun.spawnSync({
    cmd,
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (proc.exitCode !== 0) {
    return null
  }

  return new TextDecoder().decode(proc.stdout).trim() || null
}

function getDevVersion(baseVersion: string): string {
  const timestamp = new Date().toISOString()
  const date = timestamp.slice(0, 10).replaceAll('-', '')
  const time = timestamp.slice(11, 19).replaceAll(':', '')
  const sha = runCommand(['git', 'rev-parse', '--short=8', 'HEAD']) ?? 'unknown'
  return `${baseVersion}-dev.${date}.t${time}.sha${sha}`
}

function getVersionChangelog(): string {
  return (
    runCommand(['git', 'log', '--format=%h %s', '-20']) ??
    'Local development build'
  )
}

function readOptionValue(args: string[], index: number, prefix: string): string | undefined {
  const arg = args[index]
  if (!arg) return undefined
  if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1)
  if (arg === prefix) return args[index + 1]
  return undefined
}

export function parseBuildOptions(args: string[]): BuildOptions {
  const featureSet = new Set(['VOICE_MODE'])
  const options: BuildOptions = {
    compile: args.includes('--compile'),
    dev: args.includes('--dev'),
    dryRun: args.includes('--dry-run'),
    appName: DEFAULT_APP_NAME,
    configDirName: DEFAULT_CONFIG_DIR_NAME,
    modelsConfigFile: DEFAULT_MODELS_CONFIG_FILE,
    features: [],
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    const featureSetValue = readOptionValue(args, i, '--feature-set')
    if (featureSetValue !== undefined) {
      if (featureSetValue === 'dev-full') {
        for (const feature of fullExperimentalFeatures) featureSet.add(feature)
      }
      if (arg === '--feature-set') i += 1
      continue
    }

    const featureValue = readOptionValue(args, i, '--feature')
    if (featureValue !== undefined) {
      featureSet.add(featureValue)
      if (arg === '--feature') i += 1
      continue
    }

    const appName = readOptionValue(args, i, '--app-name')
    if (appName !== undefined) {
      options.appName = appName
      if (arg === '--app-name') i += 1
      continue
    }

    const configDirName = readOptionValue(args, i, '--config-dir-name')
    if (configDirName !== undefined) {
      options.configDirName = configDirName
      if (arg === '--config-dir-name') i += 1
      continue
    }

    const defaultModelsConfig = readOptionValue(args, i, '--default-model-config')
    if (defaultModelsConfig !== undefined) {
      options.defaultModelsConfigJson = readFileSync(defaultModelsConfig, 'utf8')
      options.modelsConfigFile = basename(defaultModelsConfig)
      if (arg === '--default-model-config') i += 1
      continue
    }

    const modelsConfigFile = readOptionValue(args, i, '--models-config-file')
    if (modelsConfigFile !== undefined) {
      options.modelsConfigFile = modelsConfigFile
      if (arg === '--models-config-file') i += 1
    }
  }

  options.features = [...featureSet]
  return options
}

export function getOutfile(options: Pick<BuildOptions, 'compile' | 'dev' | 'appName'>): string {
  if (options.compile) {
    return options.dev ? `./dist/${options.appName}-dev` : `./dist/${options.appName}`
  }
  return options.dev ? `./${options.appName}-dev` : `./${options.appName}`
}

if (import.meta.main) {
  const options = parseBuildOptions(process.argv.slice(2))
  const outfile = getOutfile(options)
  const buildTime = new Date().toISOString()
  const version = options.dev ? getDevVersion(pkg.version) : pkg.version

  const outDir = dirname(outfile)
  if (outDir !== '.') {
    mkdirSync(outDir, { recursive: true })
  }

  const externals = [
    '@ant/*',
    'audio-capture-napi',
    'image-processor-napi',
    'modifiers-napi',
    'url-handler-napi',
  ]

  const defines = {
    'process.env.USER_TYPE': JSON.stringify('external'),
    'process.env.CLAUDE_CODE_FORCE_FULL_LOGO': JSON.stringify('true'),
    ...(options.dev
      ? { 'process.env.NODE_ENV': JSON.stringify('development') }
      : {}),
    ...(options.dev
      ? {
          'process.env.CLAUDE_CODE_EXPERIMENTAL_BUILD': JSON.stringify('true'),
        }
      : {}),
    'process.env.CLAUDE_CODE_VERIFY_PLAN': JSON.stringify('false'),
    'process.env.CCR_FORCE_BUNDLE': JSON.stringify('true'),
    'process.env.MY_CODE_APP_NAME': JSON.stringify(options.appName),
    'process.env.MY_CODE_CONFIG_DIR_NAME': JSON.stringify(options.configDirName),
    'process.env.MY_CODE_MODELS_CONFIG_FILE': JSON.stringify(
      options.modelsConfigFile,
    ),
    ...(options.defaultModelsConfigJson
      ? {
          'process.env.MY_CODE_DEFAULT_MODELS_CONFIG_JSON': JSON.stringify(
            options.defaultModelsConfigJson,
          ),
        }
      : {}),
    'MACRO.VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(buildTime),
    'MACRO.PACKAGE_URL': JSON.stringify(pkg.name),
    'MACRO.NATIVE_PACKAGE_URL': 'undefined',
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify('github'),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(
      'This reconstructed source snapshot does not include Anthropic internal issue routing.',
    ),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(
      options.dev
        ? getVersionChangelog()
        : 'https://github.com/paoloanzn/claude-code',
    ),
  } as const

  const cmd = [
    'bun',
    'build',
    './src/entrypoints/cli.tsx',
    '--compile',
    '--target',
    'bun',
    '--format',
    'esm',
    '--outfile',
    outfile,
    '--minify',
    '--bytecode',
    '--packages',
    'bundle',
    '--conditions',
    'bun',
  ]

  for (const external of externals) {
    cmd.push('--external', external)
  }

  for (const feature of options.features) {
    cmd.push(`--feature=${feature}`)
  }

  for (const [key, value] of Object.entries(defines)) {
    cmd.push('--define', `${key}=${value}`)
  }

  if (options.dryRun) {
    console.log(
      JSON.stringify({ outfile, features: options.features, defines, cmd }, null, 2),
    )
    process.exit(0)
  }

  const proc = Bun.spawnSync({
    cmd,
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
  })

  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode ?? 1)
  }

  if (existsSync(outfile)) {
    chmodSync(outfile, 0o755)
  }

  console.log(`Built ${outfile}`)
}
