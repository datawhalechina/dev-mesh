---
layout: page
title: DevMesh
sidebar: false
aside: false
---

<main class="mesh-home">
  <section class="mesh-hero">
    <div class="mesh-hero__inner">
      <p class="mesh-kicker">DevMesh</p>
      <h1>本地优先的项目知识库</h1>
      <p class="mesh-hero__lead">
        用一个 CLI 把 Codex、Claude Code 和 opencode 接到同一个项目记忆里。知识默认写入
        <code>.dev-mesh</code>，需要团队共享时再接入 Hub Server。
      </p>
      <div class="mesh-install" aria-label="DevMesh install command">
        <span>$</span>
        <code>npm install -g devmesh@alpha</code>
      </div>
      <div class="mesh-command-row" aria-label="Common DevMesh commands">
        <code>dmx init</code>
        <code>dmx status</code>
        <code>dmx doctor</code>
      </div>
      <div class="mesh-actions">
        <a class="mesh-button" href="/getting-started">快速开始</a>
        <a class="mesh-button mesh-button--secondary" href="/reference/cli">全部命令</a>
        <a class="mesh-button mesh-button--secondary" href="/reference/mcp">MCP 工具</a>
        <a class="mesh-button mesh-button--outline" href="/reference/http">HTTP API</a>
      </div>
    </div>
  </section>

  <section class="mesh-section" aria-labelledby="mesh-command-map">
    <div class="mesh-section__inner">
      <div class="mesh-section-heading">
        <p>CLI</p>
        <h2 id="mesh-command-map">命令入口</h2>
      </div>
      <div class="mesh-card-grid">
        <article class="mesh-card">
          <h3>初始化和运行</h3>
          <div class="mesh-code-list">
            <code>dmx init</code>
            <code>dmx join</code>
            <code>dmx status</code>
            <code>dmx doctor</code>
            <code>dmx serve --mcp</code>
            <code>dmx proxy</code>
          </div>
        </article>
        <article class="mesh-card">
          <h3>知识条目</h3>
          <div class="mesh-code-list">
            <code>dmx capture</code>
            <code>dmx search</code>
            <code>dmx knowledge get</code>
            <code>dmx knowledge list</code>
            <code>dmx knowledge update</code>
            <code>dmx knowledge delete</code>
            <code>dmx rate</code>
          </div>
        </article>
        <article class="mesh-card">
          <h3>审查和图谱</h3>
          <div class="mesh-code-list">
            <code>dmx inbox</code>
            <code>dmx index rebuild</code>
            <code>dmx graph explore</code>
            <code>dmx graph edge list</code>
            <code>dmx graph edge add</code>
            <code>dmx graph visualize</code>
            <code>dmx visualize</code>
          </div>
        </article>
      </div>
    </div>
  </section>

  <section class="mesh-section mesh-section--muted" aria-labelledby="mesh-interface-map">
    <div class="mesh-section__inner">
      <div class="mesh-section-heading">
        <p>Interfaces</p>
        <h2 id="mesh-interface-map">工具和接口</h2>
      </div>
      <div class="mesh-interface-grid">
        <article class="mesh-card">
          <h3>MCP tools</h3>
          <p>给 AI 客户端使用的工具层，包含状态、检索、增删改、评分、图谱和项目扫描。</p>
          <a href="/reference/mcp">查看 14 个 MCP tools</a>
        </article>
        <article class="mesh-card">
          <h3>Hub HTTP API</h3>
          <p>给团队同步和管理界面使用的 HTTP API，包含 join、push、pull、projects、admin 和 streamable HTTP MCP。</p>
          <a href="/reference/http">查看全部 HTTP endpoints</a>
        </article>
        <article class="mesh-card">
          <h3>本地存储</h3>
          <p>项目知识、事件、索引、图谱边和可视化产物保存在项目内，便于审查和版本化策略控制。</p>
          <a href="/knowledge-capture">查看沉淀流程</a>
        </article>
      </div>
    </div>
  </section>
</main>
