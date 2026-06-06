import { readFile } from 'node:fs/promises';
import { getGlobalConfigPaths, readJsonFile } from './global-config.js';
import type { DevMeshDoctorCheck, DoctorContext, GlobalIdentity } from './doctor-types.js';

export async function checkSync(context: DoctorContext): Promise<DevMeshDoctorCheck[]> {
  const paths = getGlobalConfigPaths(context.globalRoot);
  const identity = await readJsonFile<GlobalIdentity>(paths.identityPath, {});
  const joinedServers = identity.joinedServers ?? [];
  const autoSync = context.projectConfig?.automation.autoSync ?? false;
  const checks: DevMeshDoctorCheck[] = [];

  if (joinedServers.length > 0) {
    checks.push({
      id: 'sync.identity',
      category: 'sync',
      status: 'ok',
      message: `${joinedServers.length} joined server record(s) are available for sync.`
    });
  } else if (autoSync) {
    checks.push({
      id: 'sync.identity',
      category: 'sync',
      status: 'warn',
      message: 'Project auto_sync is enabled but no joined server identity was found.',
      fixHint: 'Run dmx join <server> --group <groupKey> --name <displayName>, or set automation.auto_sync = false.'
    });
  } else {
    checks.push({
      id: 'sync.identity',
      category: 'sync',
      status: 'ok',
      message: 'No joined server identity is configured; local-only mode will not upload knowledge.'
    });
  }

  checks.push(await checkGlobalConfigTokenLeak(paths.configPath));

  return checks;
}

async function checkGlobalConfigTokenLeak(configPath: string): Promise<DevMeshDoctorCheck> {
  try {
    const content = await readFile(configPath, 'utf8');

    if (/access[_-]?token\s*=|mesh_[A-Za-z0-9_-]+/.test(content)) {
      return {
        id: 'sync.global-config-token',
        category: 'sync',
        status: 'error',
        message: 'Global config appears to contain an access token.',
        fixHint: 'Move access tokens to identity.json and remove them from config.toml before sharing the file.'
      };
    }

    return {
      id: 'sync.global-config-token',
      category: 'sync',
      status: 'ok',
      message: 'Global config does not contain access tokens.'
    };
  } catch {
    return {
      id: 'sync.global-config-token',
      category: 'sync',
      status: 'ok',
      message: 'Global config is not initialized yet; no sync credentials are configured.'
    };
  }
}
