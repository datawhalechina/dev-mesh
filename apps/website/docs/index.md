---
layout: home
title: DevMesh
titleTemplate: false
description: DevMesh 是面向 AI 编程助手的本地优先项目知识库，用 dmx CLI、MCP tools 和可选 Hub Server 沉淀团队开发上下文。
sidebar: false
aside: false
hero:
  name: DevMesh
  text: 本地优先的 AI 项目知识库
  tagline: 用一个 CLI 把 Codex、Claude Code 和 opencode 接到同一个项目记忆里。知识默认写入 .dev-mesh，需要团队共享时再接入 Hub Server。
  Notice:
    title: 使用已发布的 npm CLI 接入 DevMesh
    desc: 不需要先 clone 仓库。安装、初始化 MCP host，再让 AI 客户端按需沉淀项目知识。
    link: /getting-started
    dateText: 发布通道
    date: alpha
  actions:
    - theme: brand
      text: 快速开始
      link: /getting-started
    - theme: alt
      text: CLI 参考
      link: /reference/cli
    - theme: alt
      text: GitHub
      link: https://github.com/xy200303/dev-mesh
features:
  - title: 本地优先
    details: 默认把知识、图谱和检索索引放在项目目录里，不依赖远端服务起步。
  - title: MCP 原生
    details: 直接面向 Codex、Claude Code、opencode 暴露工具，不额外造一套旁路交互。
  - title: 知识跟随仓库
    details: 可共享的知识条目进入 .dev-mesh，新成员 clone 后就能加载同一份项目上下文。
  - title: 团队同步可选
    details: 需要共享时再接入 Hub Server，把本地工作流和团队协作拆开处理。
---

<script setup lang="ts">
const workflowCards = [
  {
    name: '安装 CLI',
    desc: '从 npm 安装已发布的 DevMesh CLI，拿到全局 <code>dmx</code> 命令。',
    icon: 'heroicons:arrow-down-tray',
  },
  {
    name: '接入 MCP host',
    desc: '运行 <code>dmx init</code>，扫描 Codex、Claude Code、opencode 并写入 stdio launcher。',
    icon: 'heroicons:wrench-screwdriver',
  },
  {
    name: '开发并沉淀',
    desc: 'AI 客户端按需调用 MCP tools，把决策、约定、任务和图谱关系写入项目目录。',
    icon: 'heroicons:sparkles',
  },
];

const docLinks = [
  {
    name: '快速开始',
    desc: '安装 npm CLI、初始化 MCP host、验证本地沉淀链路。',
    link: '/getting-started',
    linkText: '查看文档',
    icon: 'heroicons:rocket-launch',
  },
  {
    name: 'CLI 参考',
    desc: '查看全部命令、参数、示例和 TUI / JSON 输出约定。',
    link: '/reference/cli',
    linkText: '查看命令',
    icon: 'heroicons:command-line',
  },
  {
    name: 'MCP 工具',
    desc: '查看 14 个 MCP tools、用途、输入字段和 assistant-led capture 约定。',
    link: '/reference/mcp',
    linkText: '查看工具',
    icon: 'heroicons:cpu-chip',
  },
  {
    name: 'HTTP API',
    desc: '查看 Hub join、push、pull、projects、admin 和 <code>/mcp</code> 接口。',
    link: '/reference/http',
    linkText: '查看接口',
    icon: 'heroicons:server-stack',
  },
  {
    name: '环境变量',
    desc: '查看 daemon、Hub、auth、storage 与部署相关配置项。',
    link: '/reference/env',
    linkText: '查看配置',
    icon: 'heroicons:cog-6-tooth',
  },
  {
    name: '部署指南',
    desc: '面向 Hub Server、Web Admin、Docker 和发布准备的部署文档。',
    link: '/deployment',
    linkText: '查看部署',
    icon: 'heroicons:cloud-arrow-up',
  },
];

const interfaceCards = [
  {
    name: 'MCP tools',
    desc: '给 AI 客户端读取、沉淀、更新、评分和图谱关联项目知识。',
    link: '/reference/mcp',
    icon: 'heroicons:circle-stack',
  },
  {
    name: 'Hub HTTP API',
    desc: '给团队同步、成员管理、项目 ACL、审计和 streamable HTTP MCP 使用。',
    link: '/reference/http',
    icon: 'heroicons:server',
  },
  {
    name: '本地 .dev-mesh',
    desc: '把知识条目、图谱边、可视化产物和运行态拆分存放，便于审查与版本化控制。',
    link: '/knowledge-capture',
    icon: 'heroicons:folder-open',
  },
  {
    name: '知识图谱',
    desc: '用探索和可视化入口查看 knowledge、PARA、tag、source 与语义边关系。',
    link: '/knowledge-capture',
    icon: 'heroicons:share',
  },
];

const commandGroups = [
  {
    title: '初始化与运行',
    href: '/reference/cli',
    desc: '安装之后最先接触的一组命令。',
    items: ['dmx --version', 'dmx --help', 'dmx init', 'dmx join', 'dmx status', 'dmx doctor', 'dmx serve --mcp', 'dmx proxy'],
  },
  {
    title: '知识写入与检索',
    href: '/reference/cli',
    desc: '面向知识条目的增删查改和评分。',
    items: [
      'dmx capture',
      'dmx search',
      'dmx knowledge get',
      'dmx knowledge list',
      'dmx knowledge update',
      'dmx knowledge delete',
      'dmx rate',
    ],
  },
  {
    title: '审查、索引与图谱',
    href: '/reference/cli',
    desc: '面向 inbox、索引维护和图谱探索的命令。',
    items: [
      'dmx inbox',
      'dmx index rebuild',
      'dmx graph explore',
      'dmx graph edge list',
      'dmx graph edge add',
      'dmx graph visualize',
      'dmx visualize',
    ],
  },
];
</script>

<div class="mesh-home-doc">
  <section class="mesh-page-section">
    <p class="mesh-section-label">Install</p>
    <h2>安装已发布的 CLI</h2>
    <p class="mesh-section-copy">
      官网默认展示发布版使用方式，不要求先 clone 仓库，也不暴露本地开发路径。
    </p>
    <div class="mesh-copy-row">
      <CopyText label="npm install -g devmesh@alpha" text="npm install -g devmesh@alpha" bold />
    </div>
    <p class="mesh-inline-note">建议使用 Node.js 22 或更高版本，然后继续运行 <code>dmx init</code>。</p>
  </section>

  <section class="mesh-page-section">
    <p class="mesh-section-label">Flow</p>
    <h2>从安装到沉淀</h2>
    <Card :items="workflowCards" :grid="3" />
  </section>

  <section class="mesh-page-section">
    <p class="mesh-section-label">Reference</p>
    <h2>文档入口</h2>
    <Links :items="docLinks" :grid="3" />
  </section>

  <section class="mesh-page-section">
    <p class="mesh-section-label">Surfaces</p>
    <h2>工具和接口</h2>
    <Card :items="interfaceCards" :grid="4" />
  </section>

  <section class="mesh-page-section">
    <p class="mesh-section-label">Commands</p>
    <h2>命令索引</h2>
    <div class="mesh-command-grid">
      <article v-for="group in commandGroups" :key="group.title" class="mesh-command-group">
        <div class="mesh-command-group__header">
          <h3><a :href="group.href">{{ group.title }}</a></h3>
          <p>{{ group.desc }}</p>
        </div>
        <div class="mesh-pill-cloud">
          <Pill v-for="item in group.items" :key="item" :name="item" :link="group.href" />
        </div>
      </article>
    </div>
  </section>
</div>