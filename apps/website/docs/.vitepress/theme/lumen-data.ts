import type { AsideItem, FooterData } from '@theojs/lumen'

export const asideData: AsideItem = [
  {
    promo: 'Published CLI',
    link: '/getting-started',
    info1: 'npm install -g devmesh@alpha',
    info2: 'Node.js >= 22',
    icon: 'heroicons:command-line',
  },
  {
    name: 'Quick Start',
    link: '/getting-started',
    hide1: 'Install the CLI and register MCP hosts.',
    icon: 'heroicons:rocket-launch',
  },
  {
    name: 'CLI Reference',
    link: '/reference/cli',
    hide1: 'All commands, flags, and examples.',
    icon: 'heroicons:terminal',
  },
  {
    name: 'MCP Tools',
    link: '/reference/mcp',
    hide1: 'Read, capture, update, rate, and link knowledge.',
    icon: 'heroicons:cpu-chip',
  },
  {
    name: 'HTTP API',
    link: '/reference/http',
    hide1: 'Team sync, admin, and MCP endpoints.',
    icon: 'heroicons:server-stack',
  },
]

export const footerData: FooterData = {
  group: [
    {
      title: 'Documentation',
      links: [
        { name: 'Intro', link: '/intro' },
        { name: 'Getting Started', link: '/getting-started' },
        { name: 'Architecture', link: '/architecture' },
        { name: 'Deployment', link: '/deployment' },
      ],
    },
    {
      title: 'Interfaces',
      links: [
        { name: 'CLI Reference', link: '/reference/cli' },
        { name: 'MCP Tools', link: '/reference/mcp' },
        { name: 'HTTP API', link: '/reference/http' },
        { name: 'Environment', link: '/reference/env' },
      ],
    },
    {
      title: 'Project',
      links: [
        { name: 'GitHub', link: 'https://github.com/xy200303/dev-mesh' },
        { name: 'npm', link: 'https://www.npmjs.com/package/devmesh' },
        { name: 'Issues', link: 'https://github.com/xy200303/dev-mesh/issues' },
      ],
    },
  ],
  author: {
    startYear: 2026,
    name: 'DevMesh',
    link: 'https://devmesh.xyun.dev/',
    text: 'Local-first project memory for AI coding agents.',
  },
}
