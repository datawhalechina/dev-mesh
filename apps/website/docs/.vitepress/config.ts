import { defineConfig } from 'vitepress';

const siteUrl = 'https://devmesh.xyun.dev';
const siteName = 'DevMesh';
const siteTitle = 'DevMesh - 本地优先的 AI 项目知识库';
const siteDescription =
  'DevMesh 是面向 Codex、Claude Code 和 opencode 的本地优先项目知识库，用 dmx CLI 和 MCP 工具沉淀、检索、同步团队开发上下文。';
const ogImage = `${siteUrl}/img/og-image.png`;

function toCanonicalUrl(relativePath: string): string {
  const pagePath = relativePath
    .replace(/\\/g, '/')
    .replace(/(^|\/)index\.md$/, '$1')
    .replace(/\.md$/, '')
    .replace(/\/$/, '');

  return pagePath ? `${siteUrl}/${pagePath}` : `${siteUrl}/`;
}

export default defineConfig({
  lang: 'zh-CN',
  title: siteName,
  description: siteDescription,
  base: '/',
  cleanUrls: true,
  sitemap: {
    hostname: siteUrl,
  },
  head: [
    ['link', { rel: 'icon', href: '/img/logo.svg', type: 'image/svg+xml' }],
    ['meta', { name: 'theme-color', content: '#fbfbf9' }],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'DevMesh, dmx, MCP, Codex, Claude Code, opencode, AI coding, knowledge base, local-first, context memory',
      },
    ],
    ['meta', { name: 'author', content: 'DevMesh' }],
    ['meta', { name: 'robots', content: 'index,follow' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: siteName }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:image:type', content: 'image/png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: ogImage }],
  ],
  transformHead({ pageData }) {
    const canonicalUrl = toCanonicalUrl(pageData.relativePath);
    const pageTitle = pageData.title && pageData.title !== siteName ? `${pageData.title} | ${siteName}` : siteTitle;
    const pageDescription = pageData.description || siteDescription;

    return [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
      ['meta', { property: 'og:title', content: pageTitle }],
      ['meta', { property: 'og:description', content: pageDescription }],
      ['meta', { name: 'twitter:title', content: pageTitle }],
      ['meta', { name: 'twitter:description', content: pageDescription }],
    ];
  },
  themeConfig: {
    logo: '/img/logo.svg',
    siteTitle: siteName,
    nav: [
      { text: '文档', link: '/intro' },
      { text: '快速开始', link: '/getting-started' },
      { text: 'GitHub', link: 'https://github.com/xy200303/dev-mesh' },
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
          { text: 'MCP 工具', link: '/reference/mcp' },
          { text: 'HTTP API', link: '/reference/http' },
          { text: '环境变量', link: '/reference/env' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/xy200303/dev-mesh' },
    ],
    search: {
      provider: 'local',
    },
  },
});
