import { readFile } from 'node:fs/promises';
import { getGlobalConfigPaths, readJsonFile } from './global-config.js';
import { readDaemonSyncStatus } from './daemon-sync.js';
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
      fixHint: 'Run dmx join <server> --group <groupKey> --name <displayName> to enable remote sync.'
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
  checks.push(await checkDaemonSyncStatus(context));

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

async function checkDaemonSyncStatus(context: DoctorContext): Promise<DevMeshDoctorCheck> {
  const status = await readDaemonSyncStatus(context.projectRoot);

  if (status === undefined) {
    return {
      id: 'sync.daemon',
      category: 'sync',
      status: 'ok',
      message: 'Daemon sync has not run yet; dmx serve --mcp will start it on demand.'
    };
  }

  const remoteCount = status.remotes.length;
  const queued = status.remotes.reduce((sum, remote) => sum + Math.max(0, remote.queuedLocalChanges), 0);
  const baseRemotes = status.remotes.filter((remote) => remote.branchRole === 'base');
  const baseHeadCount = baseRemotes.reduce((sum, remote) => sum + remote.cacheHeadCount, 0);
  const errors = status.remotes.filter((remote) => remote.lastError !== undefined);

  if (errors.length > 0) {
    return {
      id: 'sync.daemon',
      category: 'sync',
      status: 'warn',
      message: `Daemon sync checked ${remoteCount} remote(s), queued ${queued} local CRDT change(s), and reported ${errors.length} error(s).`,
      fixHint: 'Check .dev-mesh/state/sync.json for the latest remote sync error.'
    };
  }

  if (!status.enabled) {
    return {
      id: 'sync.daemon',
      category: 'sync',
      status: 'ok',
      message: status.message
    };
  }

  return {
    id: 'sync.daemon',
    category: 'sync',
    status: 'ok',
    message:
      baseRemotes.length === 0
        ? `Daemon sync checked ${remoteCount} remote(s) and has ${queued} queued local CRDT change(s).`
        : `Daemon sync checked ${remoteCount} remote(s), has ${queued} queued local CRDT change(s), and tracks ${baseRemotes.length} read-only base branch cache(s) with ${baseHeadCount} head(s).`
  };
}
