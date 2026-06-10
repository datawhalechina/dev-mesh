import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'DevMesh',
  description: '面向 AI 协作开发的本地优先上下文网络',
  base: '/',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', href: '/img/logo.svg', type: 'image/svg+xml' }],
  ],
  themeConfig: {
    logo: '/img/logo.svg',
    siteTitle: 'DevMesh',
    nav: [
      { text: '文档', link: '/intro' },
      { text: '快速开始', link: '/getting-started' },
      { text: 'GitHub', link: 'https://github.com/xy200303/DevMesh' },
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
      { icon: 'github', link: 'https://github.com/xy200303/DevMesh' },
    ],
    footer: {
      message: 'Local-first context memory for AI-assisted engineering teams.',
      copyright: `Copyright © ${new Date().getFullYear()} DevMesh`,
    },
    search: {
      provider: 'local',
    },
  },
});
