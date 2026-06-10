import { spawn } from 'node:child_process';
import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEV_MESH_DIR, ensureProjectStore } from '@devmesh/local-store';
import { DEV_MESH_VERSION } from '@devmesh/shared';
import type {
  MeshCaptureKnowledgeInput,
  MeshCaptureTaskInput,
  MeshExploreKnowledgeGraphInput,
  MeshGetStatusInput,
  MeshLinkKnowledgeInput,
  MeshScanProjectKnowledgeInput,
  MeshRateKnowledgeInput,
  MeshResolveTermInput,
  MeshSearchContextInput,
  MeshSearchMemberExperienceInput,
  MeshToolHandlers
} from '@devmesh/mcp-contracts';
import {
  createLocalMeshMcpServerWithHandlers,
  createLocalMeshToolHandlers
} from './local-mcp-server.js';
import { createLocalMcpProxy } from './local-proxy.js';
import { createDevMeshClientRuntime } from './runtime.js';
import {
  DEFAULT_DAEMON_SYNC_INTERVAL_MS,
  startDaemonSyncWorker
} from './daemon-sync.js';

export const DEV_MESH_DAEMON_INTERNAL_ENV = 'DEV_MESH_DAEMON_INTERNAL';
export const DAEMON_PID_FILENAME = 'daemon.pid';
export const DAEMON_STATE_FILENAME = 'daemon.json';
export const DEFAULT_DAEMON_IDLE_MS = 30 * 60 * 1000;
export const DEFAULT_DAEMON_STARTUP_WAIT_MS = 3000;

export interface LocalMcpDaemonCommand {
  command: string;
  args: string[];
}

export interface LocalMcpDaemonOptions {
  projectRoot?: string;
  memberName?: string;
  command?: LocalMcpDaemonCommand;
  env?: NodeJS.ProcessEnv;
  globalRoot?: string;
  startupWaitMs?: number;
  idleMs?: number;
  syncIntervalMs?: number;
}

export interface LocalMcpDaemonState {
  pid: number;
  projectRoot: string;
  mcpUrl: string;
  healthUrl: string;
  syncStatusPath: string;
  startedAt: string;
  version: string;
}

export interface LocalMcpDaemonStatus {
  running: boolean;
  projectRoot: string;
  pidPath: string;
  statePath: string;
  state?: LocalMcpDaemonState;
  message: string;
}

type DaemonToolName =
  | 'mesh_search_context'
  | 'mesh_get_status'
  | 'mesh_capture_knowledge'
  | 'mesh_capture_task'
  | 'mesh_rate_knowledge'
  | 'mesh_link_knowledge'
  | 'mesh_search_member_experience'
  | 'mesh_resolve_term'
  | 'mesh_scan_project_knowledge'
  | 'mesh_explore_knowledge_graph';

const DAEMON_VERSION = DEV_MESH_VERSION;

export async function serveLocalMcpStdio(options: LocalMcpDaemonOptions = {}): Promise<void> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const runtime = createDevMeshClientRuntime(createRuntimeOptions(projectRoot, options.memberName));
  const localHandlers = createLocalMeshToolHandlers(runtime);
  const daemonOptions = compactDaemonOptions({
    ...options,
    projectRoot
  });

  void ensureLocalMcpDaemon(daemonOptions).catch((error) => {
    process.stderr.write(`DevMesh daemon startup skipped: ${serializeError(error)}\n`);
  });

  const server = createLocalMeshMcpServerWithHandlers(createDaemonAwareHandlers(localHandlers, daemonOptions));
  await server.connect(new StdioServerTransport());
}

export async function runLocalMcpDaemon(options: LocalMcpDaemonOptions = {}): Promise<LocalMcpDaemonState | undefined> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const claim = await claimDaemonPid(projectRoot);

  if (claim !== 'claimed') {
    return claim;
  }

  const proxy = await createLocalMcpProxy(createRuntimeOptions(projectRoot, options.memberName));
  const baseUrl = await proxy.listen({
    host: '127.0.0.1',
    port: 0
  });
  const paths = daemonPaths(projectRoot);
  const syncOptions = {
    projectRoot,
    intervalMs: options.syncIntervalMs ?? DEFAULT_DAEMON_SYNC_INTERVAL_MS,
    onError(error: unknown) {
      process.stderr.write(`DevMesh daemon sync skipped: ${serializeError(error)}\n`);
    }
  };

  if (options.globalRoot !== undefined) {
    Object.assign(syncOptions, {
      globalRoot: options.globalRoot
    });
  }

  const syncWorker = startDaemonSyncWorker(syncOptions);
  const state: LocalMcpDaemonState = {
    pid: process.pid,
    projectRoot,
    mcpUrl: `${baseUrl}/mcp`,
    healthUrl: `${baseUrl}/healthz`,
    syncStatusPath: paths.syncStatusPath,
    startedAt: new Date().toISOString(),
    version: DAEMON_VERSION
  };
  let lastActivityAt = Date.now();
  let settled = false;

  proxy.server?.on('request', () => {
    lastActivityAt = Date.now();
  });

  await writeFile(paths.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  await new Promise<void>((resolvePromise) => {
    const shutdown = () => {
      if (settled) {
        return;
      }

      settled = true;
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      clearInterval(idleTimer);
      syncWorker.stop();
      proxy
        .close()
        .then(() => releaseDaemonFiles(projectRoot))
        .then(resolvePromise, resolvePromise);
    };
    const idleMs = options.idleMs ?? DEFAULT_DAEMON_IDLE_MS;
    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivityAt >= idleMs) {
        shutdown();
      }
    }, Math.min(Math.max(idleMs, 1000), 60_000));

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });

  return state;
}

export async function ensureLocalMcpDaemon(
  options: LocalMcpDaemonOptions = {}
): Promise<LocalMcpDaemonState | undefined> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const active = await readActiveLocalMcpDaemon(projectRoot);

  if (active !== undefined) {
    return active;
  }

  const command = options.command ?? createCurrentDaemonCommand(projectRoot, options.memberName);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    [DEV_MESH_DAEMON_INTERNAL_ENV]: '1'
  };

  spawn(command.command, command.args, {
    cwd: projectRoot,
    detached: true,
    env,
    stdio: 'ignore',
    windowsHide: true
  }).unref();

  return waitForActiveLocalMcpDaemon(projectRoot, options.startupWaitMs ?? DEFAULT_DAEMON_STARTUP_WAIT_MS);
}

export async function inspectLocalMcpDaemon(projectRoot = process.cwd()): Promise<LocalMcpDaemonStatus> {
  const paths = daemonPaths(projectRoot);
  const state = await readActiveLocalMcpDaemon(projectRoot);

  if (state !== undefined) {
    return {
      running: true,
      projectRoot,
      pidPath: paths.pidPath,
      statePath: paths.statePath,
      state,
      message: `DevMesh daemon is running at ${state.mcpUrl}.`
    };
  }

  return {
    running: false,
    projectRoot,
    pidPath: paths.pidPath,
    statePath: paths.statePath,
    message: 'DevMesh daemon is not running for this project.'
  };
}

export async function readLocalMcpDaemonState(projectRoot = process.cwd()): Promise<LocalMcpDaemonState | undefined> {
  try {
    return JSON.parse(await readFile(daemonPaths(projectRoot).statePath, 'utf8')) as LocalMcpDaemonState;
  } catch {
    return undefined;
  }
}

function createDaemonAwareHandlers(localHandlers: MeshToolHandlers, options: LocalMcpDaemonOptions): MeshToolHandlers {
  return {
    async getStatus(input) {
      const status = await callDaemonOrLocal('mesh_get_status', input, () => localHandlers.getStatus(input), options);
      const daemon = await inspectLocalMcpDaemon(options.projectRoot ?? process.cwd());

      return formatStdioProxyToolOutput('mesh_get_status', withProxyRuntimeStatus(status, daemon));
    },
    async searchContext(input) {
      return formatStdioProxyToolOutput(
        'mesh_search_context',
        await callDaemonOrLocal('mesh_search_context', input, () => localHandlers.searchContext(input), options)
      );
    },
    async captureKnowledge(input) {
      return formatStdioProxyToolOutput(
        'mesh_capture_knowledge',
        await callDaemonOrLocal('mesh_capture_knowledge', input, () => localHandlers.captureKnowledge(input), options)
      );
    },
    async captureTask(input) {
      return formatStdioProxyToolOutput(
        'mesh_capture_task',
        await callDaemonOrLocal('mesh_capture_task', input, () => localHandlers.captureTask(input), options)
      );
    },
    async rateKnowledge(input) {
      return formatStdioProxyToolOutput(
        'mesh_rate_knowledge',
        await callDaemonOrLocal('mesh_rate_knowledge', input, () => localHandlers.rateKnowledge(input), options)
      );
    },
    async linkKnowledge(input) {
      return formatStdioProxyToolOutput(
        'mesh_link_knowledge',
        await callDaemonOrLocal('mesh_link_knowledge', input, () => localHandlers.linkKnowledge(input), options)
      );
    },
    async scanProjectKnowledge(input) {
      return formatStdioProxyToolOutput(
        'mesh_scan_project_knowledge',
        await callDaemonOrLocal(
          'mesh_scan_project_knowledge',
          input,
          () => localHandlers.scanProjectKnowledge(input),
          options
        )
      );
    },
    async exploreKnowledgeGraph(input) {
      return formatStdioProxyToolOutput(
        'mesh_explore_knowledge_graph',
        await callDaemonOrLocal(
          'mesh_explore_knowledge_graph',
          input,
          () => localHandlers.exploreKnowledgeGraph(input),
          options
        )
      );
    },
    async searchMemberExperience(input) {
      return formatStdioProxyToolOutput(
        'mesh_search_member_experience',
        await callDaemonOrLocal(
          'mesh_search_member_experience',
          input,
          () => localHandlers.searchMemberExperience(input),
          options
        )
      );
    },
    async resolveTerm(input) {
      return formatStdioProxyToolOutput(
        'mesh_resolve_term',
        await callDaemonOrLocal('mesh_resolve_term', input, () => localHandlers.resolveTerm(input), options)
      );
    }
  };
}

async function callDaemonOrLocal(
  toolName: DaemonToolName,
  input:
    | MeshSearchContextInput
    | MeshGetStatusInput
    | MeshCaptureKnowledgeInput
    | MeshCaptureTaskInput
    | MeshExploreKnowledgeGraphInput
    | MeshLinkKnowledgeInput
    | MeshScanProjectKnowledgeInput
    | MeshRateKnowledgeInput
    | MeshSearchMemberExperienceInput
    | MeshResolveTermInput,
  fallback: () => Promise<unknown>,
  options: LocalMcpDaemonOptions
): Promise<unknown> {
  try {
    const daemon = await ensureLocalMcpDaemon(options);

    if (daemon !== undefined) {
      return await callDaemonTool(daemon.mcpUrl, toolName, input);
    }
  } catch {
    // Fall through to the local in-process implementation.
  }

  return fallback();
}

function withProxyRuntimeStatus(status: unknown, daemon: LocalMcpDaemonStatus): unknown {
  const mcp = {
    entrypoint: 'stdio-proxy',
    daemon: formatDaemonRuntimeStatus(daemon)
  };

  if (isRecord(status)) {
    return {
      ...status,
      mcp
    };
  }

  return {
    result: status,
    mcp
  };
}

function formatDaemonRuntimeStatus(status: LocalMcpDaemonStatus): Record<string, unknown> {
  const daemon: Record<string, unknown> = {
    running: status.running,
    projectRoot: status.projectRoot,
    message: status.message
  };

  if (status.state !== undefined) {
    Object.assign(daemon, {
      pid: status.state.pid,
      version: status.state.version,
      mcpUrl: status.state.mcpUrl,
      healthUrl: status.state.healthUrl,
      startedAt: status.state.startedAt,
      syncStatusPath: status.state.syncStatusPath
    });
  }

  return daemon;
}

function formatStdioProxyToolOutput(toolName: DaemonToolName, value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  switch (toolName) {
    case 'mesh_get_status':
      return formatStatus(value);
    case 'mesh_search_context':
    case 'mesh_search_member_experience':
      return formatContextPack(value);
    case 'mesh_capture_knowledge':
      return formatKnowledgeMutation('Captured knowledge', value);
    case 'mesh_capture_task':
      return formatKnowledgeMutation('Captured task', value);
    case 'mesh_rate_knowledge':
      return formatKnowledgeMutation('Rated knowledge', value);
    case 'mesh_link_knowledge':
      return formatKnowledgeLink(value);
    case 'mesh_resolve_term':
      return formatKnowledgeList('Resolved terms', value);
    case 'mesh_scan_project_knowledge':
      return formatProjectScan(value);
    case 'mesh_explore_knowledge_graph':
      return formatKnowledgeGraph(value);
  }

  return formatGeneric(value);
}

function formatStatus(value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const lines = ['DevMesh status'];
  pushField(lines, 'service', value.service);
  pushField(lines, 'version', value.version);
  pushField(lines, 'mode', value.mode);
  pushField(lines, 'projectRoot', value.projectRoot);
  pushField(lines, 'storeRoot', value.storeRoot);
  pushField(lines, 'repository', value.repository);
  pushField(lines, 'schemaVersion', value.schemaVersion);
  pushField(lines, 'knowledgeItems', value.knowledgeItems);
  pushBoolean(lines, 'autoInit', value.autoInit);
  pushBoolean(lines, 'autoReference', value.autoReference);
  pushBoolean(lines, 'autoSync', value.autoSync);

  if (isRecord(value.mcp)) {
    lines.push(`mcp: ${formatRecordInline(value.mcp, ['entrypoint'])}`);

    if (isRecord(value.mcp.daemon)) {
      lines.push(`daemon: ${formatRecordInline(value.mcp.daemon, ['running', 'pid', 'version', 'mcpUrl'])}`);
    }
  }

  return lines.join('\n');
}

function formatContextPack(value: unknown): string {
  if (!isRecord(value)) {
    return formatKnowledgeList('Context results', value);
  }

  const items = toRecordArray(value.items);
  const lines = ['DevMesh context results'];
  pushField(lines, 'query', value.query);
  pushField(lines, 'generatedAt', value.generatedAt);
  lines.push(`items: ${items.length}`);

  if (items.length === 0) {
    lines.push('No matching knowledge found.');
    return lines.join('\n');
  }

  for (const [index, item] of items.slice(0, 8).entries()) {
    lines.push(formatKnowledgeListItem(index + 1, item));
  }

  if (items.length > 8) {
    lines.push(`... ${items.length - 8} more items omitted.`);
  }

  return lines.join('\n');
}

function formatKnowledgeMutation(title: string, value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const lines = [title];
  pushField(lines, 'id', value.id);
  pushField(lines, 'title', value.title);
  pushField(lines, 'type', value.type);
  pushField(lines, 'layer', value.layer);
  pushField(lines, 'status', value.taskStatus ?? value.status);
  pushField(lines, 'entryKey', value.entryKey);
  pushField(lines, 'summary', scalarToString(value.summary));

  if (isRecord(value.quality)) {
    lines.push(`quality: ${formatRecordInline(value.quality, ['qualityScore', 'confidence', 'rating'])}`);
  }

  if (isRecord(value.event)) {
    lines.push(`event: ${formatRecordInline(value.event, ['kind', 'createdAt'])}`);
  }

  if (isRecord(value.ratingEvent)) {
    lines.push(`ratingEvent: ${formatRecordInline(value.ratingEvent, ['rating', 'createdAt'])}`);
  }

  return lines.join('\n');
}

function formatKnowledgeLink(value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const edge = isRecord(value.edge) ? value.edge : value;
  const lines = ['Linked knowledge'];
  pushField(lines, 'kind', edge.kind);
  pushField(lines, 'fromId', edge.fromId);
  pushField(lines, 'toId', edge.toId);
  pushField(lines, 'reason', edge.reason);

  if (isRecord(value.event)) {
    lines.push(`event: ${formatRecordInline(value.event, ['kind', 'createdAt'])}`);
  }

  if (typeof value.instruction === 'string') {
    lines.push(`instruction: ${truncate(value.instruction)}`);
  }

  return lines.join('\n');
}

function formatKnowledgeList(title: string, value: unknown): string {
  const items = Array.isArray(value) ? toRecordArray(value) : toRecordArray(isRecord(value) ? value.items : undefined);
  const lines = [title, `items: ${items.length}`];

  if (items.length === 0) {
    lines.push('No items returned.');
    return lines.join('\n');
  }

  for (const [index, item] of items.slice(0, 8).entries()) {
    lines.push(formatKnowledgeListItem(index + 1, item));
  }

  if (items.length > 8) {
    lines.push(`... ${items.length - 8} more items omitted.`);
  }

  return lines.join('\n');
}

function formatProjectScan(value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const findings = toRecordArray(value.findings);
  const lines = ['Project knowledge scan'];
  pushField(lines, 'projectRoot', value.projectRoot);
  pushField(lines, 'limit', value.limit);
  lines.push(`findings: ${findings.length}`);

  if (isRecord(value.highlights)) {
    lines.push(`highlights: ${formatRecordInline(value.highlights, ['changedFiles', 'fileCount', 'todoFiles'])}`);
  }

  for (const [index, finding] of findings.slice(0, 8).entries()) {
    lines.push(formatKnowledgeListItem(index + 1, finding));
  }

  if (findings.length > 8) {
    lines.push(`... ${findings.length - 8} more findings omitted.`);
  }

  if (typeof value.instruction === 'string') {
    lines.push(`instruction: ${truncate(value.instruction)}`);
  }

  return lines.join('\n');
}

function formatKnowledgeGraph(value: unknown): string {
  if (!isRecord(value)) {
    return formatGeneric(value);
  }

  const nodes = toRecordArray(value.nodes);
  const edges = toRecordArray(value.edges);
  const lines = ['Knowledge graph', `nodes: ${nodes.length}`, `edges: ${edges.length}`];

  for (const [index, node] of nodes.slice(0, 8).entries()) {
    const label = scalarToString(node.label ?? node.title ?? node.id) ?? 'untitled';
    const id = scalarToString(node.id) ?? 'unknown';
    const kind = scalarToString(node.kind) ?? 'unknown';
    lines.push(`${index + 1}. node id=${id} | kind=${kind} | ${truncate(label, 120)}`);
  }

  for (const [index, edge] of edges.slice(0, 8).entries()) {
    const kind = scalarToString(edge.kind) ?? 'unknown';
    const from = scalarToString(edge.from) ?? scalarToString(edge.fromId) ?? 'unknown';
    const to = scalarToString(edge.to) ?? scalarToString(edge.toId) ?? 'unknown';
    lines.push(`${index + 1}. edge kind=${kind} | from=${from} | to=${to}`);
  }

  if (nodes.length > 8 || edges.length > 8) {
    lines.push('Additional graph nodes or edges omitted.');
  }

  return lines.join('\n');
}

function formatKnowledgeListItem(index: number, item: Record<string, unknown>): string {
  const title = scalarToString(item.title ?? item.label ?? item.name) ?? 'untitled';
  const details = [
    item.type === undefined ? undefined : `type=${scalarToString(item.type)}`,
    item.layer === undefined ? undefined : `layer=${scalarToString(item.layer)}`,
    item.kind === undefined ? undefined : `kind=${scalarToString(item.kind)}`,
    formatPara(item.para),
    formatQuality(item.quality)
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);
  const summary = scalarToString(item.summary ?? item.content ?? item.text);
  const lines = [`${index}. id=${scalarToString(item.id) ?? 'unknown'} | ${truncate(title, 120)}`];

  if (details.length > 0) {
    lines.push(`   ${details.join(' | ')}`);
  }

  if (summary !== undefined) {
    lines.push(`   summary: ${truncate(summary)}`);
  }

  return lines.join('\n');
}

function formatGeneric(value: unknown): string {
  if (value === undefined) {
    return 'No result.';
  }

  if (value === null || typeof value !== 'object') {
    return scalarToString(value) ?? 'No result.';
  }

  if (Array.isArray(value)) {
    return formatKnowledgeList('Result list', value);
  }

  const lines = ['Result'];

  for (const [key, entryValue] of Object.entries(value).slice(0, 12)) {
    lines.push(`${key}: ${summarizeValue(entryValue)}`);
  }

  return lines.join('\n');
}

function pushField(lines: string[], label: string, value: unknown): void {
  const text = scalarToString(value);

  if (text !== undefined) {
    lines.push(`${label}: ${truncate(text)}`);
  }
}

function pushBoolean(lines: string[], label: string, value: unknown): void {
  if (typeof value === 'boolean') {
    lines.push(`${label}: ${value ? 'true' : 'false'}`);
  }
}

function formatPara(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const category = scalarToString(value.category);
  const key = scalarToString(value.key);

  if (category === undefined && key === undefined) {
    return undefined;
  }

  return `para=${[category, key].filter(Boolean).join('/')}`;
}

function formatQuality(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return formatRecordInline(value, ['qualityScore', 'confidence', 'rating']);
}

function formatRecordInline(value: Record<string, unknown>, keys: string[]): string {
  const parts = keys
    .map((key) => {
      const entryValue = value[key];

      if (Array.isArray(entryValue)) {
        return `${key}=${entryValue.length}`;
      }

      const text = scalarToString(entryValue);
      return text === undefined ? undefined : `${key}=${truncate(text, 80)}`;
    })
    .filter((part): part is string => part !== undefined);

  return parts.length === 0 ? 'none' : parts.join(', ');
}

function summarizeValue(value: unknown): string {
  const scalar = scalarToString(value);

  if (scalar !== undefined) {
    return truncate(scalar);
  }

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }

  if (isRecord(value)) {
    return formatRecordInline(value, Object.keys(value).slice(0, 4));
  }

  return 'unknown';
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function truncate(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function callDaemonTool(mcpUrl: string, toolName: DaemonToolName, input: Record<string, unknown>): Promise<unknown> {
  const client = new Client({
    name: 'devmesh-stdio-proxy',
    version: DAEMON_VERSION
  });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));

  try {
    await client.connect(transport as never);
    const result = await client.callTool({
      name: toolName,
      arguments: input
    });

    return parseTextToolResult(result);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function claimDaemonPid(projectRoot: string): Promise<'claimed' | LocalMcpDaemonState | undefined> {
  const active = await readActiveLocalMcpDaemon(projectRoot);

  if (active !== undefined) {
    return active;
  }

  await ensureProjectStore(projectRoot);

  const paths = daemonPaths(projectRoot);

  try {
    const handle = await open(paths.pidPath, 'wx');
    await handle.writeFile(`${process.pid}\n`, 'utf8');
    await handle.close();
    return 'claimed';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  const pending = await waitForActiveLocalMcpDaemon(projectRoot, 1000);

  if (pending !== undefined) {
    return pending;
  }

  const existingPid = await readDaemonPid(projectRoot);

  if (existingPid !== undefined && processExists(existingPid)) {
    return undefined;
  }

  await rm(paths.pidPath, { force: true });

  const handle = await open(paths.pidPath, 'wx');
  await handle.writeFile(`${process.pid}\n`, 'utf8');
  await handle.close();
  return 'claimed';
}

async function readActiveLocalMcpDaemon(projectRoot: string): Promise<LocalMcpDaemonState | undefined> {
  const state = await readLocalMcpDaemonState(projectRoot);

  if (state === undefined || state.projectRoot !== projectRoot || !processExists(state.pid)) {
    return undefined;
  }

  return (await healthzOk(state.healthUrl)) ? state : undefined;
}

async function waitForActiveLocalMcpDaemon(
  projectRoot: string,
  waitMs: number
): Promise<LocalMcpDaemonState | undefined> {
  const startedAt = Date.now();
  let active = await readActiveLocalMcpDaemon(projectRoot);

  while (active === undefined && Date.now() - startedAt < waitMs) {
    await sleep(100);
    active = await readActiveLocalMcpDaemon(projectRoot);
  }

  return active;
}

async function healthzOk(healthUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 500);

  try {
    const response = await fetch(healthUrl, {
      signal: controller.signal
    });
    const body = (await response.json()) as { status?: unknown; service?: unknown };

    return response.ok && body.status === 'ok' && body.service === 'devmesh-local-proxy';
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function readDaemonPid(projectRoot: string): Promise<number | undefined> {
  try {
    const value = Number.parseInt(await readFile(daemonPaths(projectRoot).pidPath, 'utf8'), 10);

    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function releaseDaemonFiles(projectRoot: string): Promise<void> {
  const pid = await readDaemonPid(projectRoot);

  if (pid !== process.pid) {
    return;
  }

  const paths = daemonPaths(projectRoot);
  await rm(paths.pidPath, { force: true });
  await rm(paths.statePath, { force: true });
}

function daemonPaths(projectRoot: string): { root: string; pidPath: string; statePath: string; syncStatusPath: string } {
  const root = join(projectRoot, DEV_MESH_DIR);

  return {
    root,
    pidPath: join(root, DAEMON_PID_FILENAME),
    statePath: join(root, DAEMON_STATE_FILENAME),
    syncStatusPath: join(root, 'sync', 'status.json')
  };
}

function createCurrentDaemonCommand(projectRoot: string, memberName?: string): LocalMcpDaemonCommand {
  const entry = process.argv[1];

  if (entry !== undefined) {
    return {
      command: process.execPath,
      args: [entry, ...process.argv.slice(2)]
    };
  }

  return {
    command: 'dmx',
    args: ['serve', '--mcp', '--root', projectRoot, '--name', memberName ?? 'local']
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseTextToolResult(result: unknown): unknown {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text;

  if (text === undefined) {
    throw new Error('Daemon tool call did not return a text result.');
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function compactDaemonOptions(options: LocalMcpDaemonOptions): LocalMcpDaemonOptions {
  const next: LocalMcpDaemonOptions = {};

  if (options.projectRoot !== undefined) {
    next.projectRoot = options.projectRoot;
  }

  if (options.memberName !== undefined) {
    next.memberName = options.memberName;
  }

  if (options.command !== undefined) {
    next.command = options.command;
  }

  if (options.env !== undefined) {
    next.env = options.env;
  }

  if (options.globalRoot !== undefined) {
    next.globalRoot = options.globalRoot;
  }

  if (options.startupWaitMs !== undefined) {
    next.startupWaitMs = options.startupWaitMs;
  }

  if (options.idleMs !== undefined) {
    next.idleMs = options.idleMs;
  }

  if (options.syncIntervalMs !== undefined) {
    next.syncIntervalMs = options.syncIntervalMs;
  }

  return next;
}

function createRuntimeOptions(projectRoot: string, memberName?: string): { projectRoot: string; memberName?: string } {
  const options: { projectRoot: string; memberName?: string } = {
    projectRoot
  };

  if (memberName !== undefined) {
    options.memberName = memberName;
  }

  return options;
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
