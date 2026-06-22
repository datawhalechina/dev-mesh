import type { AsideItem, FooterData } from '@theojs/lumen'

export const asideData: AsideItem = [
  {
    promo: '已发布 CLI',
    link: '/getting-started',
    info1: 'npm install -g devmesh@alpha',
    info2: 'Node.js >= 22',
    icon: 'heroicons:command-line',
  },
  {
    name: '快速开始',
    link: '/getting-started',
    hide1: '安装 CLI 并注册 MCP host。',
    icon: 'heroicons:rocket-launch',
  },
  {
    name: 'CLI 参考',
    link: '/reference/cli',
    hide1: '全部命令、参数与示例。',
    icon: 'heroicons:terminal',
  },
  {
    name: 'MCP 工具',
    link: '/reference/mcp',
    hide1: '读取、沉淀、更新、评分与图谱关联。',
    icon: 'heroicons:cpu-chip',
  },
  {
    name: 'HTTP API',
    link: '/reference/http',
    hide1: '团队同步、管理与 MCP 端点。',
    icon: 'heroicons:server-stack',
  },
]

export const footerData: FooterData = {
  group: [
    {
      title: '文档',
      links: [
        { name: '项目概览', link: '/intro' },
        { name: '快速开始', link: '/getting-started' },
        { name: '架构', link: '/architecture' },
        { name: '部署', link: '/deployment' },
      ],
    },
    {
      title: '接口',
      links: [
        { name: 'CLI 参考', link: '/reference/cli' },
        { name: 'MCP 工具', link: '/reference/mcp' },
        { name: 'HTTP API', link: '/reference/http' },
        { name: '环境变量', link: '/reference/env' },
      ],
    },
    {
      title: '项目',
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
    text: '面向 AI 编程助手的本地优先项目知识库。',
  },
}
