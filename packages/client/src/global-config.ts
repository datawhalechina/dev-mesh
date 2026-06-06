import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_LOCAL_PROXY_URL = 'http://127.0.0.1:8722/mcp';

export interface GlobalConfigPaths {
  globalRoot: string;
  configPath: string;
  identityPath: string;
}

export function resolveGlobalRoot(globalRoot?: string): string {
  return globalRoot ?? process.env.DEV_MESH_HOME ?? join(homedir(), '.dev-mesh');
}

export function getGlobalConfigPaths(globalRoot?: string): GlobalConfigPaths {
  const resolvedRoot = resolveGlobalRoot(globalRoot);

  return {
    globalRoot: resolvedRoot,
    configPath: join(resolvedRoot, 'config.toml'),
    identityPath: join(resolvedRoot, 'identity.json')
  };
}

export async function readJsonFile<T extends Record<string, unknown>>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(path: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
