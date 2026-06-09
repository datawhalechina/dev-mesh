import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Command } from 'commander';
import { createDevMeshClientRuntime, type DevMeshClientRuntime } from '@devmesh/client';
import { parseIntOption } from './shared.js';

const NODE_KINDS = ['knowledge', 'para', 'type', 'tag', 'member', 'source'] as const;
const EDGE_KINDS = ['authored_by', 'belongs_to_para', 'has_type', 'parent_para', 'sourced_from', 'tagged_with'] as const;
const nodeRequire = createRequire(import.meta.url);

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
      const cytoscapeBundle = await readCytoscapeBundle();

      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, renderGraphVisualizationHtml(graph, cytoscapeBundle), 'utf8');

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

async function readCytoscapeBundle(): Promise<string> {
  const bundlePath = nodeRequire.resolve('cytoscape/dist/cytoscape.min.js');

  return readFile(bundlePath, 'utf8');
}

function renderGraphVisualizationHtml(graph: GraphExploreResult, cytoscapeBundle: string): string {
  const payload = JSON.stringify(graph).replaceAll('<', '\\u003c');
  const cytoscapeScript = escapeInlineScript(cytoscapeBundle);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="devmesh-graph-library" content="Cytoscape.js">
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

    #graph {
      display: block;
      width: 100%;
      height: 100vh;
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

      #graph {
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
      <div id="graph" role="img" aria-label="Interactive DevMesh knowledge graph"></div>
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
${cytoscapeScript}
  </script>
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
    const graphContainer = document.getElementById('graph');
    const detailTitle = document.getElementById('detail-title');
    const detailMeta = document.getElementById('detail-meta');
    const detailJson = document.getElementById('detail-json');
    const seedNodeIds = new Set(graph.seedNodeIds);
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const elements = [
      ...graph.nodes.map((node) => ({
        data: {
          id: node.id,
          label: node.label,
          shortLabel: shorten(node.label, 34),
          kind: node.kind,
          metadata: node.metadata,
          color: colors[node.kind] || '#777777'
        },
        classes: seedNodeIds.has(node.id) ? 'seed' : ''
      })),
      ...graph.edges
        .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
        .map((edge) => ({
          data: {
            id: edge.id,
            source: edge.from,
            target: edge.to,
            kind: edge.kind,
            weight: edge.weight,
            evidence: edge.evidence
          }
        }))
    ];
    const cy = cytoscape({
      container: graphContainer,
      elements,
      minZoom: 0.18,
      maxZoom: 2.6,
      wheelSensitivity: 0.18,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'border-color': '#ffffff',
            'border-width': 2,
            'color': '#202124',
            'font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
            'font-size': 12,
            'height': 20,
            'label': 'data(shortLabel)',
            'text-halign': 'right',
            'text-margin-x': 8,
            'text-outline-color': '#f7f7f4',
            'text-outline-width': 3,
            'text-valign': 'center',
            'width': 20
          }
        },
        {
          selector: 'node[kind = "knowledge"]',
          style: {
            'height': 28,
            'width': 28
          }
        },
        {
          selector: 'node.seed',
          style: {
            'border-color': '#111111',
            'border-width': 3
          }
        },
        {
          selector: 'node.selected',
          style: {
            'border-color': '#111111',
            'border-width': 4,
            'height': 34,
            'width': 34
          }
        },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'line-color': '#aeb2aa',
            'opacity': 0.78,
            'target-arrow-shape': 'none',
            'width': 'mapData(weight, 1, 8, 1.2, 4)'
          }
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#202124',
            'opacity': 1
          }
        }
      ],
      layout: {
        name: graph.nodes.length <= 1 ? 'grid' : 'cose',
        animate: false,
        componentSpacing: 90,
        edgeElasticity: 95,
        fit: true,
        idealEdgeLength: 112,
        nodeOverlap: 18,
        nodeRepulsion: 7200,
        padding: 52,
        randomize: true
      }
    });

    function selectNode(id) {
      const node = cy.getElementById(id);

      if (node.empty()) {
        return;
      }

      cy.elements().removeClass('selected');
      node.addClass('selected');
      detailTitle.textContent = node.data('label');
      detailMeta.innerHTML = [
        \`<strong>Kind</strong> \${escapeMarkup(node.data('kind'))}\`,
        \`<strong>ID</strong> \${escapeMarkup(node.id())}\`,
        \`<strong>Degree</strong> \${node.connectedEdges().length}\`
      ].join('<br>');
      detailJson.textContent = JSON.stringify(node.data('metadata') || {}, null, 2);
    }

    function shorten(value, max) {
      const text = String(value || '');
      return text.length > max ? \`\${text.slice(0, max - 1)}...\` : text;
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

    cy.on('tap', 'node', (event) => selectNode(event.target.id()));
    cy.ready(() => {
      if (graph.nodes.length > 0) {
        selectNode(graph.nodes[0].id);
      }

      cy.fit(undefined, 42);
    });
    window.addEventListener('resize', () => cy.fit(undefined, 42));
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

function escapeInlineScript(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script');
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
