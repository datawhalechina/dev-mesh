---
layout: page
title: MCP Dev Mesh
sidebar: false
aside: false
---

<main class="mesh-home">
  <section class="mesh-hero">
    <div class="mesh-hero__inner">
      <p class="mesh-eyebrow">Local-first context memory</p>
      <h1>MCP Dev Mesh</h1>
      <p class="mesh-hero__lead">
        把 Codex、Claude Code、opencode 的项目经验沉淀到可审查、可同步、可检索的
        <code>.dev-mesh</code> 知识网络中。
      </p>
      <div class="mesh-actions">
        <a class="mesh-button" href="/getting-started">开始使用</a>
        <a class="mesh-button mesh-button--secondary" href="/architecture">查看架构</a>
      </div>
    </div>
  </section>

  <section class="mesh-section mesh-section--warm">
    <div class="mesh-section__inner">
      <p class="mesh-kicker">Project memory that travels with the repo</p>
      <h2>从一次对话，到长期项目上下文</h2>
      <div class="mesh-grid">
        <article class="mesh-panel">
          <h3>本地优先</h3>
          <p>知识先写入项目自己的 .dev-mesh 目录，团队可以审查、同步和迁移。</p>
        </article>
        <article class="mesh-panel">
          <h3>MCP 接入</h3>
          <p>Codex、Claude Code 和 opencode 通过本地 proxy 调用统一工具沉淀上下文。</p>
        </article>
        <article class="mesh-panel">
          <h3>团队 Mesh</h3>
          <p>Hub Server 管理成员、项目、邀请、同步状态和跨项目经验检索。</p>
        </article>
      </div>
    </div>
  </section>

  <section class="mesh-section mesh-section--cool">
    <div class="mesh-section__inner mesh-path">
      <div>
        <p class="mesh-kicker">CLI and MCP workflow</p>
        <h2>最小链路清晰可测</h2>
        <p class="mesh-path__copy">
          先用 CLI 完成 smoke test，再把 MCP proxy 接到 AI 工具。每条知识都可以回到
          项目文件里检查。
        </p>
      </div>
      <ol class="mesh-path__list">
        <li><code>dmx init</code><span>创建项目级知识库</span></li>
        <li><code>dmx proxy</code><span>暴露本地 MCP 工具</span></li>
        <li><code>dmx capture</code><span>沉淀任务和决策</span></li>
        <li><code>dmx search</code><span>回收上下文给下一轮协作</span></li>
      </ol>
    </div>
  </section>
</main>
