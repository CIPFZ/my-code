import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'logout',
  description: 'Logout is disabled in my-code',
  isEnabled: () => false,
  load: () => import('./logout.js'),
} satisfies Command
