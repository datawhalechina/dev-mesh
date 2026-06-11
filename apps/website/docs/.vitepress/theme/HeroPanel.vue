<template>
  <div class="mesh-hero-panel">
    <div class="mesh-hero-panel__header">
      <span class="mesh-hero-panel__eyebrow">Published CLI</span>
      <h2>安装一次，把项目记忆留在仓库里。</h2>
      <p>先接入 MCP host，再让 AI 客户端按需沉淀长期有效的项目知识。</p>
    </div>

    <div class="mesh-hero-panel__terminal" aria-label="DevMesh quick start">
      <span>$ npm install -g devmesh@alpha</span>
      <span>$ dmx init</span>
      <span>$ dmx doctor</span>
    </div>

    <div class="mesh-hero-panel__grid">
      <div class="mesh-hero-panel__fact">
        <span>MCP host</span>
        <strong>Codex / Claude Code / opencode</strong>
      </div>
      <div class="mesh-hero-panel__fact">
        <span>运行方式</span>
        <strong>stdio MCP launcher + 项目 daemon</strong>
      </div>
      <div class="mesh-hero-panel__fact">
        <span>存储位置</span>
        <strong>.dev-mesh in your repo</strong>
      </div>
      <div class="mesh-hero-panel__fact">
        <span>团队共享</span>
        <strong>需要时再接入 Hub Server</strong>
      </div>
    </div>

    <div class="mesh-hero-panel__footer">
      <a href="/getting-started">安装流程</a>
      <a href="/reference/mcp">MCP 工具</a>
      <a href="/reference/http">HTTP API</a>
    </div>
  </div>
</template>
