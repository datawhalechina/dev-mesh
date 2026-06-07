import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
  title: 'MCP Dev Mesh',
  tagline: '面向 AI 协作开发的本地优先上下文网络',
  favicon: 'img/logo.svg',
  url: process.env.SITE_URL ?? 'https://mcp-dev-mesh.dev',
  baseUrl: process.env.SITE_BASE_URL ?? '/',
  organizationName: 'mcp-dev-mesh',
  projectName: 'mcp-context-mesh',
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  i18n: {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/mcp-dev-mesh/mcp-context-mesh/tree/main/apps/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: 'img/context-mesh-hero.png',
    navbar: {
      title: 'MCP Dev Mesh',
      logo: {
        alt: 'MCP Dev Mesh logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: '文档',
        },
        {
          to: '/docs/getting-started',
          label: '快速开始',
          position: 'left',
        },
        {
          href: 'https://github.com/mcp-dev-mesh/mcp-context-mesh',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '使用',
          items: [
            {
              label: '快速开始',
              to: '/docs/getting-started',
            },
            {
              label: '自动沉淀',
              to: '/docs/knowledge-capture',
            },
            {
              label: '部署',
              to: '/docs/deployment',
            },
          ],
        },
        {
          title: '设计',
          items: [
            {
              label: '架构',
              to: '/docs/architecture',
            },
            {
              label: '路线图',
              to: '/docs/roadmap',
            },
            {
              label: 'CLI 参考',
              to: '/docs/reference/cli',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} MCP Dev Mesh.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
