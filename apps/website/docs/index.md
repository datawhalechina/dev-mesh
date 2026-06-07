---
layout: page
title: MCP Dev Mesh
sidebar: false
aside: false
---

<main class="mesh-home">
  <section class="mesh-hero">
    <div class="mesh-hero__inner">
      <p class="mesh-eyebrow">Project context layer</p>
      <h1>MCP Dev Mesh</h1>
      <p class="mesh-hero__lead">
        给项目放一个可检索、可审查的上下文层。决策、任务进展、术语和命令经验落在
        <code>.dev-mesh</code>，再通过 MCP 被本地工具调用。
      </p>
      <div class="mesh-actions">
        <a class="mesh-button" href="/getting-started">开始使用</a>
        <a class="mesh-button mesh-button--secondary" href="/reference/cli">CLI 参考</a>
      </div>
    </div>
  </section>

  <section class="mesh-section mesh-section--warm">
    <div class="mesh-section__inner">
      <p class="mesh-kicker">What goes into the repo</p>
      <h2>记录工程事实，不写概念口号</h2>
      <div class="mesh-grid">
        <article class="mesh-panel">
          <h3>决策记录</h3>
          <p>服务端配置、存储策略、接口边界这些“为什么这样做”，落成可检索条目。</p>
        </article>
        <article class="mesh-panel">
          <h3>任务进展</h3>
          <p>完成了什么、还缺什么、下次从哪里继续，按项目写入本地事件和知识文件。</p>
        </article>
        <article class="mesh-panel">
          <h3>命令经验</h3>
          <p>能复用的启动、部署、排障命令留在仓库旁边，下一轮不用重新翻历史。</p>
        </article>
      </div>
    </div>
  </section>

  <section class="mesh-section mesh-section--cool">
    <div class="mesh-section__inner mesh-path">
      <div>
        <p class="mesh-kicker">Local workflow</p>
        <h2>先本地可用，再团队同步</h2>
        <p class="mesh-path__copy">
          <code>dmx</code> 先把知识库建在项目目录里。需要团队协作时，再接入 Hub Server 做成员、
          邀请、同步状态和跨项目检索。
        </p>
      </div>
      <ol class="mesh-path__list">
        <li><code>dmx init</code><span>初始化项目级 .dev-mesh</span></li>
        <li><code>dmx capture</code><span>写入决策、任务和经验</span></li>
        <li><code>dmx search</code><span>从本地知识库取回上下文</span></li>
        <li><code>dmx join</code><span>接入团队 Hub Server</span></li>
      </ol>
    </div>
  </section>
</main>
