import type { Command } from '../../commands.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: 'Login is disabled in my-code',
    isEnabled: () => false,
    load: () => import('./login.js'),
  }) satisfies Command
