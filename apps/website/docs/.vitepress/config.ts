import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'MCP Dev Mesh',
  description: '面向 AI 协作开发的本地优先上下文网络',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', href: '/img/logo.svg', type: 'image/svg+xml' }],
    ['meta', { property: 'og:image', content: '/img/context-mesh-hero.png' }],
  ],
  themeConfig: {
    logo: '/img/logo.svg',
    siteTitle: 'MCP Dev Mesh',
    nav: [
      { text: '文档', link: '/intro' },
      { text: '快速开始', link: '/getting-started' },
      { text: 'GitHub', link: 'https://github.com/mcp-dev-mesh/mcp-context-mesh' },
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '项目概览', link: '/intro' },
          { text: '快速开始', link: '/getting-started' },
          { text: '自动沉淀', link: '/knowledge-capture' },
          { text: '架构', link: '/architecture' },
          { text: '部署', link: '/deployment' },
          { text: '路线图', link: '/roadmap' },
        ],
      },
      {
        text: '参考',
        items: [
          { text: 'CLI 参考', link: '/reference/cli' },
          { text: '环境变量', link: '/reference/env' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mcp-dev-mesh/mcp-context-mesh' },
    ],
    footer: {
      message: 'Local-first context memory for AI-assisted engineering teams.',
      copyright: `Copyright © ${new Date().getFullYear()} MCP Dev Mesh`,
    },
    search: {
      provider: 'local',
    },
  },
});
