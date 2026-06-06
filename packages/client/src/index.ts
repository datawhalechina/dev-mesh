import { mkdir, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { createAgentContextService, type AgentContextService, type BuildContextPackInput } from '@mcp-dev-mesh/agent';
import { createDevMeshCore, type CaptureKnowledgeInput, type DevMeshCore } from '@mcp-dev-mesh/core';
import { ensureProjectStore, JsonlKnowledgeRepository, type ProjectStore } from '@mcp-dev-mesh/local-store';

export interface DevMeshClientOptions {
  projectRoot?: string;
  memberName?: string;
}

export interface GlobalInitResult {
  globalRoot: string;
  configPath: string;
  identityPath: string;
}

export interface DevMeshClientRuntime {
  projectRoot: string;
  core: DevMeshCore;
  agent: AgentContextService;
  ensureProjectStore(): Promise<ProjectStore>;
  captureKnowledge(input: CaptureKnowledgeInput): Promise<unknown>;
  searchContext(input: BuildContextPackInput): Promise<unknown>;
  status(): Promise<Record<string, unknown>>;
}

export function createDevMeshClientRuntime(options: DevMeshClientOptions = {}): DevMeshClientRuntime {
  const projectRoot = options.projectRoot ?? process.cwd();
  const repository = new JsonlKnowledgeRepository(projectRoot);
  const core = createDevMeshCore({
    projectRoot,
    repository
  });
  const agent = createAgentContextService({ core });

  return {
    projectRoot,
    core,
    agent,
    ensureProjectStore: () => ensureProjectStore(projectRoot, storeOptions(options.memberName)),
    captureKnowledge: (input) => core.captureKnowledge(withDefaultMember(input, options.memberName)),
    searchContext: (input) => agent.buildContextPack(input),
    async status() {
      const store = await ensureProjectStore(projectRoot, storeOptions(options.memberName));
      const items = await core.listKnowledge({ includeSuperseded: true });

      return {
        mode: 'local-only',
        projectRoot,
        storeRoot: store.storeRoot,
        knowledgeItems: items.length,
        autoInit: true,
        autoReference: true,
        autoCapture: true,
        autoSync: false
      };
    }
  };
}

export async function initGlobalConfig(displayName = 'local'): Promise<GlobalInitResult> {
  const globalRoot = join(homedir(), '.dev-mesh');
  const configPath = join(globalRoot, 'config.toml');
  const identityPath = join(globalRoot, 'identity.json');

  await mkdir(globalRoot, { recursive: true });
  await writeFile(
    configPath,
    [
      'schema_version = 1',
      `display_name = "${escapeToml(displayName)}"`,
      'local_proxy_url = "http://127.0.0.1:8722/mcp"',
      '',
      '[automation]',
      'auto_init = true',
      'auto_reference = true',
      'auto_capture = true',
      'auto_sync = false',
      ''
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    identityPath,
    `${JSON.stringify(
      {
        displayName,
        hostname: hostname(),
        createdAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return {
    globalRoot,
    configPath,
    identityPath
  };
}

function withDefaultMember(input: CaptureKnowledgeInput, memberName?: string): CaptureKnowledgeInput {
  if (input.createdBy || !memberName) {
    return input;
  }

  return {
    ...input,
    createdBy: {
      displayName: memberName
    }
  };
}

function storeOptions(memberName?: string): { displayName?: string } {
  if (memberName === undefined) {
    return {};
  }

  return {
    displayName: memberName
  };
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
