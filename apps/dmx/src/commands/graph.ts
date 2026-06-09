import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Command } from 'commander';
import { createDevMeshClientRuntime, type DevMeshClientRuntime } from '@devmesh/client';
import { parseIntOption } from './shared.js';

const NODE_KINDS = ['knowledge', 'para', 'type', 'tag', 'member', 'source'] as const;
const EDGE_KINDS = ['authored_by', 'belongs_to_para', 'has_type', 'parent_para', 'sourced_from', 'tagged_with'] as const;

export function registerGraphCommand(program: Command): void {
  const graph = program.command('graph').description('Explore the local DevMesh knowledge graph');

  registerExploreCommand(graph);
  registerVisualizeCommand(graph, 'visualize');
  registerVisualizeCommand(program, 'visualize');
}

function registerExploreCommand(parent: Command): void {
  parent
    .command('explore')
    .description('Explore related knowledge items, PARA nodes, tags, authors, sources, and types')
    .option('--root <path>', 'project root', process.cwd())
    .option('--query <query>', 'query used to select graph seed nodes')
    .option('--id <id>', 'knowledge item id used as a seed node', collectOption, [])
    .option('--depth <n>', 'relationship depth from seed nodes', parseIntOption, 2)
    .option('--limit <n>', 'maximum number of nodes', parseIntOption, 40)
    .option('--node-kind <kind>', 'node kind filter', collectOption, [])
    .option('--edge-kind <kind>', 'edge kind filter', collectOption, [])
    .action(async (options: GraphExploreOptions) => {
      const runtime = createDevMeshClientRuntime({
        projectRoot: options.root
      });

      console.log(JSON.stringify(await runtime.exploreKnowledgeGraph(createGraphExploreInput(options)), null, 2));
    });
}

function registerVisualizeCommand(parent: Command, name: string): void {
  const command = parent
    .command(name)
    .description('Generate an interactive local DevMesh knowledge graph visualization')
    .option('--root <path>', 'project root', process.cwd())
    .option('--query <query>', 'query used to select graph seed nodes')
    .option('--id <id>', 'knowledge item id used as a seed node', collectOption, [])
    .option('--depth <n>', 'relationship depth from seed nodes', parseIntOption, 2)
    .option('--limit <n>', 'maximum number of nodes', parseIntOption, 80)
    .option('--node-kind <kind>', 'node kind filter', collectOption, [])
    .option('--edge-kind <kind>', 'edge kind filter', collectOption, [])
    .option('--output <path>', 'HTML output path')
    .option('--no-open', 'write the visualization without opening a browser');

  if (parent.name() === 'graph') {
    command.alias('view');
  }

  command.action(async (options: GraphVisualizeOptions) => {
    const runtime = createDevMeshClientRuntime({
      projectRoot: options.root
    });
    const input = createGraphExploreInput(options);
    const graph = await runtime.exploreKnowledgeGraph(input);
    const outputPath = await resolveGraphVisualizationOutputPath(runtime, options.output);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderGraphVisualizationHtml(graph), 'utf8');

    if (options.open) {
      openGraphVisualization(outputPath);
    }

    console.log(`DevMesh knowledge graph visualization: ${outputPath}`);
  });
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function createGraphExploreInput(options: GraphExploreOptions): NonNullable<Parameters<DevMeshClientRuntime['exploreKnowledgeGraph']>[0]> {
  const input: NonNullable<Parameters<DevMeshClientRuntime['exploreKnowledgeGraph']>[0]> = {
    depth: options.depth,
    limit: options.limit
  };

  if (options.query !== undefined) {
    input.query = options.query;
  }

  if (options.id.length > 0) {
    input.ids = options.id;
  }

  if (options.nodeKind.length > 0) {
    input.nodeKinds = options.nodeKind.map(parseNodeKind);
  }

  if (options.edgeKind.length > 0) {
    input.edgeKinds = options.edgeKind.map(parseEdgeKind);
  }

  return input;
}

async function resolveGraphVisualizationOutputPath(runtime: DevMeshClientRuntime, output: string | undefined): Promise<string> {
  if (output !== undefined) {
    return isAbsolute(output) ? output : resolve(runtime.projectRoot, output);
  }

  const store = await runtime.ensureProjectStore();

  return join(store.paths.indexDir, 'graph.html');
}

function parseNodeKind(value: string): (typeof NODE_KINDS)[number] {
  if (NODE_KINDS.includes(value as (typeof NODE_KINDS)[number])) {
    return value as (typeof NODE_KINDS)[number];
  }

  throw new Error(`Expected --node-kind to be one of ${NODE_KINDS.join(', ')}`);
}

function parseEdgeKind(value: string): (typeof EDGE_KINDS)[number] {
  if (EDGE_KINDS.includes(value as (typeof EDGE_KINDS)[number])) {
    return value as (typeof EDGE_KINDS)[number];
  }

  throw new Error(`Expected --edge-kind to be one of ${EDGE_KINDS.join(', ')}`);
}

function openGraphVisualization(outputPath: string): void {
  const url = pathToFileURL(outputPath).toString();
  const opener = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

  const child = spawn(opener, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });

  child.on('error', () => undefined);
  child.unref();
}

function renderGraphVisualizationHtml(graph: GraphExploreResult): string {
  const payload = JSON.stringify(graph).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DevMesh Knowledge Graph</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f4;
      --panel: #ffffff;
      --ink: #202124;
      --muted: #6b706a;
      --line: #dadbd5;
      --knowledge: #2f6f9f;
      --para: #8a6f24;
      --type: #52714d;
      --tag: #9a4f63;
      --member: #6d5f93;
      --source: #5a7076;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    .app {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      min-height: 100vh;
    }

    .graph {
      position: relative;
      min-height: 100vh;
      overflow: hidden;
      border-right: 1px solid var(--line);
    }

    .toolbar {
      position: absolute;
      z-index: 2;
      top: 16px;
      left: 16px;
      right: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      pointer-events: none;
    }

    .title {
      pointer-events: auto;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
    }

    h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 650;
    }

    .subtitle {
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
    }

    .stats {
      pointer-events: auto;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .stat {
      min-width: 82px;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
    }

    .stat strong {
      display: block;
      font-size: 16px;
      line-height: 1.1;
    }

    .stat span {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
    }

    svg {
      display: block;
      width: 100%;
      height: 100vh;
      cursor: grab;
    }

    svg:active {
      cursor: grabbing;
    }

    .edge {
      stroke: #aeb2aa;
      stroke-width: 1.3;
      opacity: 0.8;
    }

    .node circle {
      stroke: #ffffff;
      stroke-width: 2;
    }

    .node text {
      fill: var(--ink);
      font-size: 12px;
      paint-order: stroke;
      stroke: rgba(247, 247, 244, 0.82);
      stroke-width: 4px;
      stroke-linejoin: round;
      pointer-events: none;
    }

    .node.selected circle {
      stroke: #111111;
      stroke-width: 3;
    }

    .sidebar {
      min-height: 100vh;
      background: var(--panel);
      padding: 18px;
      overflow: auto;
    }

    .sidebar h2 {
      margin: 0 0 12px;
      font-size: 15px;
    }

    .meta {
      display: grid;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .legend {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 18px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .swatch {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--color);
    }

    pre {
      white-space: pre-wrap;
      word-break: break-word;
      margin: 16px 0 0;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfbf9;
      color: #3d403b;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    @media (max-width: 840px) {
      .app {
        grid-template-columns: 1fr;
      }

      .graph {
        min-height: 70vh;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }

      svg {
        height: 70vh;
      }

      .toolbar {
        position: static;
        padding: 12px;
        align-items: stretch;
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <main class="app">
    <section class="graph" aria-label="Knowledge graph visualization">
      <div class="toolbar">
        <div class="title">
          <h1>DevMesh Knowledge Graph</h1>
          <div class="subtitle">Generated ${escapeHtml(graph.generatedAt)}</div>
        </div>
        <div class="stats">
          <div class="stat"><strong>${graph.nodes.length}</strong><span>Nodes</span></div>
          <div class="stat"><strong>${graph.edges.length}</strong><span>Edges</span></div>
          <div class="stat"><strong>${graph.seedNodeIds.length}</strong><span>Seeds</span></div>
        </div>
      </div>
      <svg id="graph" role="img" aria-label="Interactive DevMesh knowledge graph"></svg>
    </section>
    <aside class="sidebar">
      <h2 id="detail-title">Node details</h2>
      <div class="meta" id="detail-meta">No node selected.</div>
      <div class="legend">
        ${NODE_KINDS.map((kind) => `<div class="legend-item"><span class="swatch" style="--color: var(--${kind})"></span>${kind}</div>`).join('')}
      </div>
      <pre id="detail-json">{}</pre>
    </aside>
  </main>
  <script>
    const graph = ${payload};
    const colors = {
      knowledge: '#2f6f9f',
      para: '#8a6f24',
      type: '#52714d',
      tag: '#9a4f63',
      member: '#6d5f93',
      source: '#5a7076'
    };
    const svg = document.getElementById('graph');
    const detailTitle = document.getElementById('detail-title');
    const detailMeta = document.getElementById('detail-meta');
    const detailJson = document.getElementById('detail-json');
    const width = () => svg.clientWidth || 900;
    const height = () => svg.clientHeight || 700;
    const state = {
      nodes: graph.nodes.map((node, index) => ({
        ...node,
        x: width() / 2 + Math.cos((index / Math.max(graph.nodes.length, 1)) * Math.PI * 2) * Math.min(width(), height()) * 0.28,
        y: height() / 2 + Math.sin((index / Math.max(graph.nodes.length, 1)) * Math.PI * 2) * Math.min(width(), height()) * 0.28,
        vx: 0,
        vy: 0
      })),
      selected: undefined
    };
    const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
    const edges = graph.edges
      .map((edge) => ({ ...edge, fromNode: nodesById.get(edge.from), toNode: nodesById.get(edge.to) }))
      .filter((edge) => edge.fromNode && edge.toNode);
    const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    svg.append(edgeLayer, nodeLayer);

    function render() {
      edgeLayer.replaceChildren(...edges.map(renderEdge));
      nodeLayer.replaceChildren(...state.nodes.map(renderNode));
    }

    function renderEdge(edge) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'edge');
      line.setAttribute('x1', edge.fromNode.x);
      line.setAttribute('y1', edge.fromNode.y);
      line.setAttribute('x2', edge.toNode.x);
      line.setAttribute('y2', edge.toNode.y);
      line.setAttribute('data-kind', edge.kind);
      return line;
    }

    function renderNode(node) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const radius = node.kind === 'knowledge' ? 13 : 9;

      group.setAttribute('class', \`node\${state.selected === node.id ? ' selected' : ''}\`);
      group.setAttribute('transform', \`translate(\${node.x}, \${node.y})\`);
      group.style.cursor = 'pointer';
      circle.setAttribute('r', radius);
      circle.setAttribute('fill', colors[node.kind] || '#777777');
      label.setAttribute('x', radius + 6);
      label.setAttribute('y', '4');
      label.textContent = shorten(node.label, 34);
      group.append(circle, label);
      group.addEventListener('click', () => selectNode(node.id));
      group.addEventListener('pointerdown', (event) => dragNode(event, node));
      return group;
    }

    function tick() {
      const centerX = width() / 2;
      const centerY = height() / 2;

      for (const node of state.nodes) {
        node.vx += (centerX - node.x) * 0.0008;
        node.vy += (centerY - node.y) * 0.0008;
      }

      for (let i = 0; i < state.nodes.length; i += 1) {
        for (let j = i + 1; j < state.nodes.length; j += 1) {
          const a = state.nodes[i];
          const b = state.nodes[j];
          const dx = b.x - a.x || 0.01;
          const dy = b.y - a.y || 0.01;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const force = Math.min(900 / (distance * distance), 2.8);
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      for (const edge of edges) {
        const dx = edge.toNode.x - edge.fromNode.x;
        const dy = edge.toNode.y - edge.fromNode.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const pull = (distance - 150) * 0.004 * Math.max(edge.weight, 1);
        const fx = (dx / distance) * pull;
        const fy = (dy / distance) * pull;
        edge.fromNode.vx += fx;
        edge.fromNode.vy += fy;
        edge.toNode.vx -= fx;
        edge.toNode.vy -= fy;
      }

      for (const node of state.nodes) {
        node.vx *= 0.84;
        node.vy *= 0.84;
        node.x = clamp(node.x + node.vx, 28, width() - 120);
        node.y = clamp(node.y + node.vy, 28, height() - 28);
      }

      render();
      requestAnimationFrame(tick);
    }

    function selectNode(id) {
      const node = nodesById.get(id);

      if (!node) {
        return;
      }

      state.selected = id;
      detailTitle.textContent = node.label;
      detailMeta.innerHTML = [
        \`<strong>Kind</strong> \${escapeMarkup(node.kind)}\`,
        \`<strong>ID</strong> \${escapeMarkup(node.id)}\`,
        \`<strong>Degree</strong> \${edges.filter((edge) => edge.from === id || edge.to === id).length}\`
      ].join('<br>');
      detailJson.textContent = JSON.stringify(node.metadata || {}, null, 2);
      render();
    }

    function dragNode(event, node) {
      event.preventDefault();
      svg.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const nodeX = node.x;
      const nodeY = node.y;

      function move(moveEvent) {
        node.x = nodeX + moveEvent.clientX - startX;
        node.y = nodeY + moveEvent.clientY - startY;
        node.vx = 0;
        node.vy = 0;
        render();
      }

      function up(upEvent) {
        svg.releasePointerCapture(upEvent.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      }

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    function shorten(value, max) {
      return value.length > max ? \`\${value.slice(0, max - 1)}...\` : value;
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function escapeMarkup(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    window.addEventListener('resize', render);
    if (state.nodes.length > 0) {
      selectNode(state.nodes[0].id);
    }
    tick();
  </script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

type GraphExploreResult = Awaited<ReturnType<DevMeshClientRuntime['exploreKnowledgeGraph']>>;

interface GraphExploreOptions {
  root: string;
  query?: string;
  id: string[];
  depth: number;
  limit: number;
  nodeKind: string[];
  edgeKind: string[];
}

interface GraphVisualizeOptions extends GraphExploreOptions {
  output?: string;
  open: boolean;
}
