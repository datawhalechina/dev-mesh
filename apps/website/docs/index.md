---
layout: page
title: DevMesh
sidebar: false
aside: false
---

<main class="mesh-home">
  <section class="mesh-hero">
    <div class="mesh-hero__inner">
      <p class="mesh-super">本地优先</p>
      <h1>DevMesh</h1>
      <p class="mesh-hero__lead">
        安装 <code>devmesh</code> CLI 后，用 <code>dmx init</code> 接入 Codex、Claude Code 或 opencode。
        项目决策、任务进展和命令经验会保存到 <code>.dev-mesh</code>，再通过 CLI 和 MCP 回到开发流程里。
      </p>
      <div class="mesh-actions">
        <a class="mesh-button" href="/getting-started">快速开始</a>
        <a class="mesh-button mesh-button--secondary" href="/reference/cli">CLI 参考</a>
        <a class="mesh-button mesh-button--outline" href="/deployment">部署</a>
      </div>
    </div>
  </section>

  <section class="mesh-strip" aria-label="Project layers">
    <div class="mesh-strip__inner">
      <div>
        <span>项目知识库</span>
        <strong>.dev-mesh</strong>
      </div>
      <div>
        <span>本地入口</span>
        <strong>dmx serve</strong>
      </div>
      <div>
        <span>团队同步</span>
        <strong>Hub Server</strong>
      </div>
    </div>
  </section>

  <section class="mesh-section">
    <div class="mesh-section__inner mesh-feature-grid">
      <article class="mesh-feature">
        <h2>易于落地</h2>
        <p>通过 <code>npm install -g devmesh@alpha</code> 安装，用 <code>dmx init</code> 配置 AI 客户端，不需要先部署中心服务。</p>
      </article>
      <article class="mesh-feature">
        <h2>可审查</h2>
        <p>知识、事件和待处理队列都落在项目目录里，可以搜索、检查、接受或拒绝。</p>
      </article>
      <article class="mesh-feature">
        <h2>可同步</h2>
        <p>团队场景再加入 Hub Server，管理成员、邀请、同步状态和跨项目经验检索。</p>
      </article>
    </div>
  </section>
</main>
