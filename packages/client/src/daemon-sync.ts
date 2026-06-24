import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  applyBranchCrdtChanges,
  applyProjectCrdtChanges,
  ensureProjectStore,
  readBranchCrdtSyncState,
  readProjectCrdtChangesSince,
  readProjectCrdtSyncState,
  readProjectProjectionStatus,
  readProjectConfig,
  rebuildProjectProjectionsFromCrdt,
  type ProjectConfig,
  type ProjectProjectionFileStatus,
  type ProjectProjectionStatus,
  type ProjectProjectionStatusState,
  type ProjectStore
} from '@devmesh/local-store';
import type {
  CrdtSyncChange,
  CrdtSyncExchangeRequest,
  CrdtSyncExchangeResponse,
  ErrorResponse
} from '@devmesh/protocol';
import { getGlobalConfigPaths, readJsonFile } from './global-config.js';
import type { JoinedServerRecord } from './join-types.js';

export const DAEMON_SYNC_STATUS_FILENAME = 'sync.json';
export const DAEMON_SYNC_PEERS_FILENAME = 'peers.json';
export const DAEMON_SYNC_HEADS_FILENAME = 'heads.json';
export const PROJECT_AUTOMERGE_FILENAME = 'project.automerge';
export const DEFAULT_DAEMON_SYNC_INTERVAL_MS = 30_000;
export const DEFAULT_DAEMON_SYNC_DEBOUNCE_MS = 500;
export const DEFAULT_DAEMON_SYNC_BATCH_SIZE = 100;
export const DAEMON_SYNC_STATUS_SCHEMA_VERSION = 2;

export interface DaemonSyncOptions {
  projectRoot?: string;
  globalRoot?: string;
  intervalMs?: number;
  debounceMs?: number;
  batchSize?: number;
  now?: () => Date;
  fetch?: typeof fetch;
  onError?: (error: unknown) => void;
}

export interface DaemonSyncWorker {
  runOnce(): Promise<DaemonSyncStatus>;
  stop(): void;
}

export interface DaemonSyncStatus {
  schemaVersion: 2;
  projectRoot: string;
  enabled: boolean;
  updatedAt: string;
  crdt: DaemonCrdtStatus;
  projection: DaemonProjectionMaintenanceStatus;
  remotes: DaemonSyncRemoteStatus[];
  message: string;
}

export interface DaemonCrdtStatus {
  checkedAt: string;
  path: string;
  initialized: boolean;
  currentHeads: string[];
  currentHeadCount: number;
  projectionSourceHeads: string[];
  projectionSourceHeadCount: number;
  materialized: boolean;
  projectionState: ProjectProjectionStatusState | 'error';
}

export interface DaemonProjectionFileSummary {
  total: number;
  ready: number;
  missing: number;
  corrupt: number;
  schemaMismatch: number;
}

export interface DaemonProjectionMaintenanceStatus {
  checkedAt: string;
  state: ProjectProjectionStatusState | 'error';
  rebuilt: boolean;
  materialized: boolean;
  message: string;
  metadataPath?: string;
  crdtPath?: string;
  currentHeads?: string[];
  sourceHeads?: string[];
  currentHeadCount: number;
  sourceHeadCount: number;
  projectionFiles?: ProjectProjectionFileStatus[];
  fileSummary?: DaemonProjectionFileSummary;
  previousState?: ProjectProjectionStatusState;
  rebuiltAt?: string;
  documentCount?: number;
  graphNodeCount?: number;
  graphEdgeCount?: number;
  qualityCount?: number;
  qualityAlgorithmVersion?: number;
  qualityPath?: string;
  lastError?: string;
}

export interface DaemonSyncRemoteStatus {
  key: string;
  serverUrl: string;
  branch: string;
  clientId: string;
  branchRole: DaemonSyncBranchRole;
  readOnly: boolean;
  cachePath: string;
  cacheInitialized: boolean;
  cacheHeadCount: number;
  cacheChangeCount: number;
  enabled: boolean;
  queuedLocalChanges: number;
  pushedChanges: number;
  pulledChanges: number;
  appliedChanges: number;
  rejectedChanges: number;
  localHeads: string[];
  remoteHeads: string[];
  exchangeComplete: boolean;
  lastExchangeAt?: string;
  lastError?: string;
}

interface DaemonSyncPeerFile {
  schemaVersion?: number;
  remotes?: Record<string, DaemonSyncPeerState>;
}

interface DaemonSyncPeerState {
  remoteHeads?: string[];
  lastExchangeHeads?: string[];
  lastExchangeAt?: string;
}

export interface DaemonSyncHeadsStatus {
  schemaVersion: 2;
  updatedAt: string;
  localHeads: string[];
  projectionSourceHeads: string[];
  materialized: boolean;
  remotes: Record<string, DaemonSyncRemoteHeadsStatus>;
}

export interface DaemonSyncRemoteHeadsStatus {
  serverUrl: string;
  branch: string;
  clientId: string;
  branchRole: DaemonSyncBranchRole;
  readOnly: boolean;
  cachePath: string;
  cacheInitialized: boolean;
  cacheHeadCount: number;
  cacheChangeCount: number;
  remoteHeads: string[];
  lastExchangeHeads: string[];
  queuedLocalChanges: number;
  exchangeComplete: boolean;
  lastExchangeAt?: string;
  lastError?: string;
}

interface DaemonSyncIdentity {
  joinedServers?: JoinedServerRecord[];
  [key: string]: unknown;
}

type ValidJoinedServerRecord = JoinedServerRecord & {
  accessToken: string;
};

export type DaemonSyncBranchRole = 'active' | 'base';

interface DaemonSyncRemoteTarget {
  remote: ValidJoinedServerRecord;
  branchRole: DaemonSyncBranchRole;
  readOnly: boolean;
}

export function startDaemonSyncWorker(options: DaemonSyncOptions = {}): DaemonSyncWorker {
  let stopped = false;
  let running: Promise<DaemonSyncStatus> | undefined;
  const intervalMs = Math.max(1000, options.intervalMs ?? DEFAULT_DAEMON_SYNC_INTERVAL_MS);
  const debounceMs = Math.max(25, options.debounceMs ?? DEFAULT_DAEMON_SYNC_DEBOUNCE_MS);
  let watcher: FSWatcher | undefined;
  let debounceTimer: NodeJS.Timeout | undefined;

  const runOnce = async (): Promise<DaemonSyncStatus> => {
    if (running !== undefined) {
      return running;
    }

    running = runDaemonSyncOnce(options).finally(() => {
      running = undefined;
    });

    return running;
  };

  const interval = setInterval(() => {
    if (stopped) {
      return;
    }

    void runOnce().catch(options.onError ?? (() => undefined));
  }, intervalMs);
  const scheduleRun = () => {
    if (stopped) {
      return;
    }

    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void runOnce().catch(options.onError ?? (() => undefined));
    }, debounceMs);
  };

  void runOnce().catch(options.onError ?? (() => undefined));
  void watchProjectCrdtFile(options.projectRoot ?? process.cwd(), scheduleRun).then(
    (createdWatcher) => {
      if (stopped) {
        createdWatcher.close();
        return;
      }

      watcher = createdWatcher;
    },
    options.onError ?? (() => undefined)
  );

  return {
    runOnce,
    stop() {
      stopped = true;
      clearInterval(interval);
      watcher?.close();

      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
    }
  };
}

async function watchProjectCrdtFile(projectRoot: string, onChange: () => void): Promise<FSWatcher> {
  const store = await ensureProjectStore(projectRoot);

  return watch(store.paths.crdtDir, { persistent: false }, (_eventType, filename) => {
    if (filename === null || filename.toString() === PROJECT_AUTOMERGE_FILENAME) {
      onChange();
    }
  });
}

export async function runDaemonSyncOnce(options: DaemonSyncOptions = {}): Promise<DaemonSyncStatus> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const store = await ensureProjectStore(projectRoot);
  const config = await readProjectConfig(projectRoot);
  const timestamp = now().toISOString();
  let projection = await maintainProjectProjections(projectRoot, timestamp);

  if (!config.automation.autoSync) {
    const status: DaemonSyncStatus = {
      schemaVersion: DAEMON_SYNC_STATUS_SCHEMA_VERSION,
      projectRoot,
      enabled: false,
      updatedAt: timestamp,
      crdt: formatDaemonCrdtStatus(projection),
      projection,
      remotes: [],
      message: 'Project auto_sync is disabled; daemon sync is idle.'
    };

    await writeDaemonSyncStatus(store, status);
    await writeDaemonSyncHeads(store, status);
    return status;
  }

  const identity = await readJsonFile<DaemonSyncIdentity>(getGlobalConfigPaths(options.globalRoot).identityPath, {});
  const remoteTargets = selectRemotesForProjectBranches(
    (identity.joinedServers ?? []).filter(isValidJoinedServerRecord),
    config
  );

  if (remoteTargets.length === 0) {
    const status: DaemonSyncStatus = {
      schemaVersion: DAEMON_SYNC_STATUS_SCHEMA_VERSION,
      projectRoot,
      enabled: true,
      updatedAt: timestamp,
      crdt: formatDaemonCrdtStatus(projection),
      projection,
      remotes: [],
      message: 'Project auto_sync is enabled, but no joined server identity matches the active knowledge branch.'
    };

    await writeDaemonSyncStatus(store, status);
    await writeDaemonSyncHeads(store, status);
    return status;
  }

  const peers = await readDaemonSyncPeers(store);
  const remoteStatuses: DaemonSyncRemoteStatus[] = [];

  for (const target of remoteTargets) {
    const key = createRemoteTargetKey(target);
    const peer = ensureRemotePeer(peers, key);

    try {
      remoteStatuses.push(await syncRemote(store, config, target, peer, options));
    } catch (error) {
      remoteStatuses.push(createRemoteErrorStatus(target, error));
    }
  }

  await writeDaemonSyncPeers(store, peers);
  projection = await maintainProjectProjections(projectRoot, timestamp);

  const errors = remoteStatuses.filter((remote) => remote.lastError !== undefined).length;
  const status: DaemonSyncStatus = {
    schemaVersion: DAEMON_SYNC_STATUS_SCHEMA_VERSION,
    projectRoot,
    enabled: true,
    updatedAt: timestamp,
    crdt: formatDaemonCrdtStatus(projection),
    projection,
    remotes: remoteStatuses,
    message:
      errors === 0
        ? `Daemon sync checked ${remoteStatuses.length} remote(s).`
        : `Daemon sync checked ${remoteStatuses.length} remote(s) with ${errors} error(s).`
  };

  await writeDaemonSyncStatus(store, status);
  await writeDaemonSyncHeads(store, status);
  return status;
}

export async function readDaemonSyncStatus(projectRoot = process.cwd()): Promise<DaemonSyncStatus | undefined> {
  const store = await ensureProjectStore(projectRoot);

  try {
    return normalizeDaemonSyncStatus(
      JSON.parse(await readFile(getDaemonSyncStatusPath(store), 'utf8')) as unknown,
      projectRoot
    );
  } catch {
    return undefined;
  }
}

export async function readDaemonSyncHeads(projectRoot = process.cwd()): Promise<DaemonSyncHeadsStatus | undefined> {
  const store = await ensureProjectStore(projectRoot);

  try {
    return normalizeDaemonSyncHeads(JSON.parse(await readFile(getDaemonSyncHeadsPath(store), 'utf8')) as unknown);
  } catch {
    return undefined;
  }
}

function isValidJoinedServerRecord(record: JoinedServerRecord): record is ValidJoinedServerRecord {
  return Boolean(
    typeof record.serverUrl === 'string' &&
      record.serverUrl.trim() &&
      typeof record.branch === 'string' &&
      record.branch.trim() &&
      typeof record.clientId === 'string' &&
      record.clientId.trim() &&
      typeof record.accessToken === 'string' &&
      record.accessToken.trim()
  );
}

function selectRemotesForProjectBranches(
  remotes: ValidJoinedServerRecord[],
  config: ProjectConfig
): DaemonSyncRemoteTarget[] {
  const targets: DaemonSyncRemoteTarget[] = [];
  const selectedRemoteKeys = new Set<string>();
  const activeGroupKeys = createSyncGroupKeys(config.knowledgeBranch.active);
  const baseGroupKeys =
    config.knowledgeBranch.base === undefined ? new Set<string>() : createSyncGroupKeys(config.knowledgeBranch.base);

  for (const remote of remotes) {
    if (activeGroupKeys.has(remote.branch)) {
      const target: DaemonSyncRemoteTarget = {
        remote,
        branchRole: 'active',
        readOnly: false
      };
      targets.push(target);
      selectedRemoteKeys.add(createRemoteKey(remote));
    }
  }

  for (const remote of remotes) {
    if (!baseGroupKeys.has(remote.branch)) {
      continue;
    }

    const target: DaemonSyncRemoteTarget = {
      remote,
      branchRole: 'base',
      readOnly: true
    };
    const key = createRemoteKey(remote);

    if (!selectedRemoteKeys.has(key)) {
      targets.push(target);
      selectedRemoteKeys.add(key);
    }
  }

  return targets;
}

function createSyncGroupKeys(activeBranch: string): Set<string> {
  const branchs = new Set<string>();
  branchs.add(activeBranch);

  if (activeBranch === 'main') {
    branchs.add('default');
  }

  return branchs;
}

async function maintainProjectProjections(
  projectRoot: string,
  checkedAt: string
): Promise<DaemonProjectionMaintenanceStatus> {
  try {
    const before = await readProjectProjectionStatus(projectRoot);

    if (shouldRebuildProjectProjections(before.state)) {
      await rebuildProjectProjectionsFromCrdt(projectRoot);
      const after = await readProjectProjectionStatus(projectRoot);

      return formatProjectionMaintenanceStatus(after, checkedAt, true, before.state);
    }

    return formatProjectionMaintenanceStatus(before, checkedAt, false);
  } catch (error) {
    const lastError = serializeError(error);

    return {
      checkedAt,
      state: 'error',
      rebuilt: false,
      materialized: false,
      message: `Projection maintenance failed: ${lastError}`,
      currentHeadCount: 0,
      sourceHeadCount: 0,
      lastError
    };
  }
}

function shouldRebuildProjectProjections(state: ProjectProjectionStatusState): boolean {
  return state === 'missing' || state === 'dirty' || state === 'schema_mismatch' || state === 'corrupt';
}

function formatProjectionMaintenanceStatus(
  status: ProjectProjectionStatus,
  checkedAt: string,
  rebuilt: boolean,
  previousState?: ProjectProjectionStatusState
): DaemonProjectionMaintenanceStatus {
  const output: DaemonProjectionMaintenanceStatus = {
    checkedAt,
    state: status.state,
    rebuilt,
    materialized: status.state === 'ready',
    message: status.message,
    metadataPath: status.metadataPath,
    crdtPath: status.crdtPath,
    currentHeads: status.currentHeads,
    sourceHeads: status.sourceHeads,
    currentHeadCount: status.currentHeads.length,
    sourceHeadCount: status.sourceHeads.length
  };

  if (status.projectionFiles !== undefined) {
    output.projectionFiles = status.projectionFiles;
    output.fileSummary = summarizeProjectionFiles(status.projectionFiles);
  }

  if (previousState !== undefined) {
    output.previousState = previousState;
  }

  if (status.rebuiltAt !== undefined) {
    output.rebuiltAt = status.rebuiltAt;
  }

  if (status.documentCount !== undefined) {
    output.documentCount = status.documentCount;
  }

  if (status.graphNodeCount !== undefined) {
    output.graphNodeCount = status.graphNodeCount;
  }

  if (status.graphEdgeCount !== undefined) {
    output.graphEdgeCount = status.graphEdgeCount;
  }

  if (status.qualityCount !== undefined) {
    output.qualityCount = status.qualityCount;
  }

  if (status.qualityAlgorithmVersion !== undefined) {
    output.qualityAlgorithmVersion = status.qualityAlgorithmVersion;
  }

  if (status.qualityPath !== undefined) {
    output.qualityPath = status.qualityPath;
  }

  return output;
}

function formatDaemonCrdtStatus(projection: DaemonProjectionMaintenanceStatus): DaemonCrdtStatus {
  const currentHeads = projection.currentHeads ?? [];
  const sourceHeads = projection.sourceHeads ?? [];

  return {
    checkedAt: projection.checkedAt,
    path: projection.crdtPath ?? '',
    initialized: projection.state !== 'missing_crdt' && projection.crdtPath !== undefined,
    currentHeads,
    currentHeadCount: currentHeads.length,
    projectionSourceHeads: sourceHeads,
    projectionSourceHeadCount: sourceHeads.length,
    materialized: projection.materialized,
    projectionState: projection.state
  };
}

function normalizeDaemonSyncStatus(value: unknown, projectRoot: string): DaemonSyncStatus | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  const projection = normalizeProjectionMaintenanceStatus(value.projection);
  const remotes = Array.isArray(value.remotes)
    ? value.remotes.map(normalizeDaemonSyncRemoteStatus).filter((remote): remote is DaemonSyncRemoteStatus => remote !== undefined)
    : [];
  const output: DaemonSyncStatus = {
    schemaVersion: DAEMON_SYNC_STATUS_SCHEMA_VERSION,
    projectRoot: readString(value.projectRoot) ?? projectRoot,
    enabled: value.enabled === true,
    updatedAt: readString(value.updatedAt) ?? new Date(0).toISOString(),
    crdt: normalizeDaemonCrdtStatus(value.crdt, projection),
    projection,
    remotes,
    message: readString(value.message) ?? 'Daemon sync status was normalized from an older status file.'
  };

  return output;
}

function normalizeDaemonCrdtStatus(value: unknown, projection: DaemonProjectionMaintenanceStatus): DaemonCrdtStatus {
  if (isPlainRecord(value)) {
    const currentHeads = readStringArray(value.currentHeads) ?? projection.currentHeads ?? [];
    const projectionSourceHeads =
      readStringArray(value.projectionSourceHeads) ?? readStringArray(value.sourceHeads) ?? projection.sourceHeads ?? [];

    return {
      checkedAt: readString(value.checkedAt) ?? projection.checkedAt,
      path: readString(value.path) ?? projection.crdtPath ?? '',
      initialized: value.initialized === true,
      currentHeads,
      currentHeadCount: readNumber(value.currentHeadCount) ?? currentHeads.length,
      projectionSourceHeads,
      projectionSourceHeadCount: readNumber(value.projectionSourceHeadCount) ?? projectionSourceHeads.length,
      materialized: value.materialized === true || projection.materialized,
      projectionState: isProjectionState(value.projectionState) ? value.projectionState : projection.state
    };
  }

  return formatDaemonCrdtStatus(projection);
}

function normalizeDaemonSyncHeads(value: unknown): DaemonSyncHeadsStatus | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  return {
    schemaVersion: 2,
    updatedAt: readString(value.updatedAt) ?? new Date(0).toISOString(),
    localHeads: readStringArray(value.localHeads) ?? [],
    projectionSourceHeads: readStringArray(value.projectionSourceHeads) ?? readStringArray(value.sourceHeads) ?? [],
    materialized: value.materialized === true,
    remotes: isPlainRecord(value.remotes) ? normalizeDaemonSyncRemoteHeads(value.remotes) : {}
  };
}

function normalizeDaemonSyncRemoteHeads(remotes: Record<string, unknown>): Record<string, DaemonSyncRemoteHeadsStatus> {
  const output: Record<string, DaemonSyncRemoteHeadsStatus> = {};

  for (const [key, value] of Object.entries(remotes)) {
    if (!isPlainRecord(value)) {
      continue;
    }

    const remote: DaemonSyncRemoteHeadsStatus = {
      serverUrl: readString(value.serverUrl) ?? '',
      branch: readString(value.branch) ?? '',
      clientId: readString(value.clientId) ?? '',
      branchRole: isDaemonSyncBranchRole(value.branchRole) ? value.branchRole : 'active',
      readOnly: value.readOnly === true,
      cachePath: readString(value.cachePath) ?? '',
      cacheInitialized: value.cacheInitialized === true,
      cacheHeadCount: readNumber(value.cacheHeadCount) ?? 0,
      cacheChangeCount: readNumber(value.cacheChangeCount) ?? 0,
      remoteHeads: readStringArray(value.remoteHeads) ?? [],
      lastExchangeHeads: readStringArray(value.lastExchangeHeads) ?? [],
      queuedLocalChanges: readNumber(value.queuedLocalChanges) ?? 0,
      exchangeComplete: value.exchangeComplete === true
    };
    const lastExchangeAt = readString(value.lastExchangeAt);
    const lastError = readString(value.lastError);

    if (lastExchangeAt !== undefined) {
      remote.lastExchangeAt = lastExchangeAt;
    }

    if (lastError !== undefined) {
      remote.lastError = lastError;
    }

    output[key] = remote;
  }

  return output;
}

function normalizeProjectionMaintenanceStatus(value: unknown): DaemonProjectionMaintenanceStatus {
  if (!isPlainRecord(value)) {
    return {
      checkedAt: new Date(0).toISOString(),
      state: 'error',
      rebuilt: false,
      materialized: false,
      message: 'Daemon sync status did not contain projection maintenance details.',
      currentHeadCount: 0,
      sourceHeadCount: 0
    };
  }

  const state = isProjectionState(value.state) ? value.state : 'error';
  const currentHeads = readStringArray(value.currentHeads) ?? [];
  const sourceHeads = readStringArray(value.sourceHeads) ?? [];
  const projectionFiles = Array.isArray(value.projectionFiles)
    ? value.projectionFiles.filter(isProjectionFileStatus)
    : undefined;
  const output: DaemonProjectionMaintenanceStatus = {
    checkedAt: readString(value.checkedAt) ?? new Date(0).toISOString(),
    state,
    rebuilt: value.rebuilt === true,
    materialized: value.materialized === true || state === 'ready',
    message: readString(value.message) ?? 'Projection maintenance status was normalized from an older status file.',
    currentHeads,
    sourceHeads,
    currentHeadCount: readNumber(value.currentHeadCount) ?? currentHeads.length,
    sourceHeadCount: readNumber(value.sourceHeadCount) ?? sourceHeads.length
  };

  const metadataPath = readString(value.metadataPath);
  if (metadataPath !== undefined) {
    output.metadataPath = metadataPath;
  }

  const crdtPath = readString(value.crdtPath);
  if (crdtPath !== undefined) {
    output.crdtPath = crdtPath;
  }

  if (isProjectProjectionState(value.previousState)) {
    output.previousState = value.previousState;
  }

  const rebuiltAt = readString(value.rebuiltAt);
  if (rebuiltAt !== undefined) {
    output.rebuiltAt = rebuiltAt;
  }

  const documentCount = readNumber(value.documentCount);
  if (documentCount !== undefined) {
    output.documentCount = documentCount;
  }

  const graphNodeCount = readNumber(value.graphNodeCount);
  if (graphNodeCount !== undefined) {
    output.graphNodeCount = graphNodeCount;
  }

  const graphEdgeCount = readNumber(value.graphEdgeCount);
  if (graphEdgeCount !== undefined) {
    output.graphEdgeCount = graphEdgeCount;
  }

  const qualityCount = readNumber(value.qualityCount);
  if (qualityCount !== undefined) {
    output.qualityCount = qualityCount;
  }

  const qualityAlgorithmVersion = readNumber(value.qualityAlgorithmVersion);
  if (qualityAlgorithmVersion !== undefined) {
    output.qualityAlgorithmVersion = qualityAlgorithmVersion;
  }

  const qualityPath = readString(value.qualityPath);
  if (qualityPath !== undefined) {
    output.qualityPath = qualityPath;
  }

  const lastError = readString(value.lastError);
  if (lastError !== undefined) {
    output.lastError = lastError;
  }

  if (projectionFiles !== undefined) {
    output.projectionFiles = projectionFiles;
    output.fileSummary = summarizeProjectionFiles(projectionFiles);
  } else if (isPlainRecord(value.fileSummary)) {
    output.fileSummary = normalizeFileSummary(value.fileSummary);
  }

  return output;
}

function summarizeProjectionFiles(files: ProjectProjectionFileStatus[]): DaemonProjectionFileSummary {
  return {
    total: files.length,
    ready: files.filter((file) => file.state === 'ready').length,
    missing: files.filter((file) => file.state === 'missing').length,
    corrupt: files.filter((file) => file.state === 'corrupt').length,
    schemaMismatch: files.filter((file) => file.state === 'schema_mismatch').length
  };
}

function normalizeFileSummary(value: Record<string, unknown>): DaemonProjectionFileSummary {
  return {
    total: readNumber(value.total) ?? 0,
    ready: readNumber(value.ready) ?? 0,
    missing: readNumber(value.missing) ?? 0,
    corrupt: readNumber(value.corrupt) ?? 0,
    schemaMismatch: readNumber(value.schemaMismatch) ?? 0
  };
}

function isProjectionState(value: unknown): value is ProjectProjectionStatusState | 'error' {
  return (
    value === 'missing_crdt' ||
    value === 'missing' ||
    value === 'schema_mismatch' ||
    value === 'corrupt' ||
    value === 'dirty' ||
    value === 'ready' ||
    value === 'error'
  );
}

function isProjectProjectionState(value: unknown): value is ProjectProjectionStatusState {
  return (
    value === 'missing_crdt' ||
    value === 'missing' ||
    value === 'schema_mismatch' ||
    value === 'corrupt' ||
    value === 'dirty' ||
    value === 'ready'
  );
}

function isProjectionFileStatus(value: unknown): value is ProjectProjectionFileStatus {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.path === 'string' &&
    typeof value.role === 'string' &&
    (value.state === 'missing' ||
      value.state === 'corrupt' ||
      value.state === 'schema_mismatch' ||
      value.state === 'ready')
  );
}

function isDaemonSyncRemoteStatus(value: unknown): value is DaemonSyncRemoteStatus {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.key === 'string' &&
    typeof value.serverUrl === 'string' &&
    typeof value.branch === 'string' &&
    typeof value.clientId === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.queuedLocalChanges === 'number' &&
    typeof value.pushedChanges === 'number' &&
    typeof value.pulledChanges === 'number' &&
    typeof value.appliedChanges === 'number' &&
    typeof value.rejectedChanges === 'number' &&
    readStringArray(value.localHeads) !== undefined &&
    readStringArray(value.remoteHeads) !== undefined &&
    typeof value.exchangeComplete === 'boolean'
  );
}

function normalizeDaemonSyncRemoteStatus(value: unknown): DaemonSyncRemoteStatus | undefined {
  if (!isDaemonSyncRemoteStatus(value)) {
    return undefined;
  }

  return {
    ...value,
    branchRole: isDaemonSyncBranchRole(value.branchRole) ? value.branchRole : 'active',
    readOnly: value.readOnly === true,
    cachePath: readString(value.cachePath) ?? '',
    cacheInitialized: value.cacheInitialized === true,
    cacheHeadCount: readNumber(value.cacheHeadCount) ?? 0,
    cacheChangeCount: readNumber(value.cacheChangeCount) ?? 0
  };
}

function isDaemonSyncBranchRole(value: unknown): value is DaemonSyncBranchRole {
  return value === 'active' || value === 'base';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
}

async function syncRemote(
  store: ProjectStore,
  config: ProjectConfig,
  target: DaemonSyncRemoteTarget,
  peer: DaemonSyncPeerState,
  options: DaemonSyncOptions
): Promise<DaemonSyncRemoteStatus> {
  const maxChanges = Math.max(1, options.batchSize ?? DEFAULT_DAEMON_SYNC_BATCH_SIZE);
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const knownRemoteHeads = peer.remoteHeads ?? [];
  const branchCacheBefore = target.readOnly
    ? await readBranchCrdtSyncState(store.projectRoot, target.remote.branch, {
        projectKey: config.projectKey
      })
    : undefined;
  const localChanges =
    branchCacheBefore === undefined
      ? await readProjectCrdtChangesSince(store.projectRoot, knownRemoteHeads, {
          projectKey: config.projectKey
        })
      : {
          heads: branchCacheBefore.heads,
          changes: [] as Uint8Array[]
        };
  const exchange = await exchangeRemoteCrdtChanges(
    target.remote,
    createCrdtExchangeRequest(target.remote, config, localChanges.heads, localChanges.changes, maxChanges),
    options
  );
  let appliedChanges = 0;

  if (target.readOnly && exchange.changes.length > 0) {
    const applied = await applyBranchCrdtChanges(
      store.projectRoot,
      target.remote.branch,
      decodeCrdtSyncChanges(exchange.changes),
      {
        projectKey: config.projectKey
      }
    );

    appliedChanges = applied.applied;
  } else if (exchange.changes.length > 0) {
    const applied = await applyProjectCrdtChanges(store.projectRoot, decodeCrdtSyncChanges(exchange.changes), {
      projectKey: config.projectKey
    });

    appliedChanges = applied.applied;

    if (appliedChanges > 0) {
      await rebuildProjectProjectionsFromCrdt(store.projectRoot, {
        projectKey: config.projectKey
      });
    }
  }

  const latestLocal = target.readOnly
    ? await readBranchCrdtSyncState(store.projectRoot, target.remote.branch, {
        projectKey: config.projectKey
      })
    : await readProjectCrdtSyncState(store.projectRoot, {
        projectKey: config.projectKey
      });
  const responseWasComplete = exchange.changes.length < maxChanges;

  if (responseWasComplete) {
    peer.remoteHeads = [...exchange.heads];
  }

  peer.lastExchangeHeads = [...latestLocal.heads];
  peer.lastExchangeAt = timestamp;

  const queuedLocalChanges = (
    target.readOnly
      ? { changes: [] }
      : await readProjectCrdtChangesSince(store.projectRoot, peer.remoteHeads ?? knownRemoteHeads, {
          projectKey: config.projectKey
        })
  ).changes.length;
  const pushedChanges = exchange.acceptedChanges.length;
  const pulledChanges = exchange.changes.length;
  const rejectedChanges = exchange.rejected.length;

  const status: DaemonSyncRemoteStatus = {
    key: createRemoteTargetKey(target),
    serverUrl: target.remote.serverUrl,
    branch: target.remote.branch,
    clientId: target.remote.clientId,
    branchRole: target.branchRole,
    readOnly: target.readOnly,
    cachePath: latestLocal.path,
    cacheInitialized: latestLocal.initialized,
    cacheHeadCount: latestLocal.heads.length,
    cacheChangeCount: latestLocal.changeCount,
    enabled: config.automation.autoSync,
    queuedLocalChanges,
    pushedChanges,
    pulledChanges,
    appliedChanges,
    rejectedChanges,
    localHeads: latestLocal.heads,
    remoteHeads: peer.remoteHeads ?? knownRemoteHeads,
    exchangeComplete: responseWasComplete,
    lastExchangeAt: timestamp
  };

  return status;
}

function createCrdtExchangeRequest(
  remote: ValidJoinedServerRecord,
  config: ProjectConfig,
  heads: string[],
  changes: Uint8Array[],
  maxChanges: number
): CrdtSyncExchangeRequest {
  return {
    clientId: remote.clientId,
    projectKey: config.projectKey,
    document: {
      kind: 'project',
      branch: remote.branch,
      projectKey: config.projectKey,
      schemaVersion: 2
    },
    heads: [...heads],
    changes: changes.map((change) => toCrdtSyncChange(change, heads)),
    maxChanges
  };
}

function toCrdtSyncChange(change: Uint8Array, heads: string[]): CrdtSyncChange {
  return {
    id: createCrdtChangeId(change),
    engine: 'automerge',
    encoding: 'base64',
    bytes: Buffer.from(change).toString('base64'),
    headsBefore: [],
    headsAfter: [...heads]
  };
}

async function exchangeRemoteCrdtChanges(
  remote: ValidJoinedServerRecord,
  request: CrdtSyncExchangeRequest,
  options: DaemonSyncOptions
): Promise<CrdtSyncExchangeResponse> {
  return fetchJson<CrdtSyncExchangeResponse>(
    `${normalizeServerUrl(remote.serverUrl)}/api/v2/sync/exchange`,
    {
      method: 'POST',
      headers: createRemoteHeaders(remote),
      body: JSON.stringify(request)
    },
    options
  );
}

function decodeCrdtSyncChanges(changes: CrdtSyncChange[]): Uint8Array[] {
  return changes.map((change, index) => {
    if (change.engine !== 'automerge' || change.encoding !== 'base64') {
      throw new Error(`Unsupported CRDT change ${index}.`);
    }

    if (change.bytes.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(change.bytes)) {
      throw new Error(`Invalid CRDT change encoding at index ${index}.`);
    }

    const decoded = Buffer.from(change.bytes, 'base64');

    if (decoded.byteLength === 0) {
      throw new Error(`Empty CRDT change at index ${index}.`);
    }

    return new Uint8Array(decoded);
  });
}

function createCrdtChangeId(change: Uint8Array): string {
  return `am_${createHash('sha256').update(change).digest('hex').slice(0, 32)}`;
}

async function readDaemonSyncPeers(store: ProjectStore): Promise<DaemonSyncPeerFile> {
  try {
    const parsed = JSON.parse(await readFile(getDaemonSyncPeerPath(store), 'utf8')) as DaemonSyncPeerFile;

    return {
      schemaVersion: 2,
      remotes: isPlainRecord(parsed.remotes) ? normalizeRemotePeers(parsed.remotes) : {}
    };
  } catch {
    return {
      schemaVersion: 2,
      remotes: {}
    };
  }
}

async function writeDaemonSyncPeers(store: ProjectStore, peers: DaemonSyncPeerFile): Promise<void> {
  const normalized: DaemonSyncPeerFile = {
    schemaVersion: 2,
    remotes: normalizeRemotePeers(peers.remotes ?? {})
  };

  await mkdir(getDaemonSyncPeerDir(store), { recursive: true });
  await writeFile(getDaemonSyncPeerPath(store), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}

async function writeDaemonSyncHeads(store: ProjectStore, status: DaemonSyncStatus): Promise<void> {
  const heads: DaemonSyncHeadsStatus = {
    schemaVersion: 2,
    updatedAt: status.updatedAt,
    localHeads: [...status.crdt.currentHeads],
    projectionSourceHeads: [...status.crdt.projectionSourceHeads],
    materialized: status.crdt.materialized,
    remotes: Object.fromEntries(
      status.remotes.map((remote) => {
        const remoteState: DaemonSyncRemoteHeadsStatus = {
          serverUrl: remote.serverUrl,
          branch: remote.branch,
          clientId: remote.clientId,
          branchRole: remote.branchRole,
          readOnly: remote.readOnly,
          cachePath: remote.cachePath,
          cacheInitialized: remote.cacheInitialized,
          cacheHeadCount: remote.cacheHeadCount,
          cacheChangeCount: remote.cacheChangeCount,
          remoteHeads: [...remote.remoteHeads],
          lastExchangeHeads: [...remote.localHeads],
          queuedLocalChanges: remote.queuedLocalChanges,
          exchangeComplete: remote.exchangeComplete
        };

        if (remote.lastExchangeAt !== undefined) {
          remoteState.lastExchangeAt = remote.lastExchangeAt;
        }

        if (remote.lastError !== undefined) {
          remoteState.lastError = remote.lastError;
        }

        return [remote.key, remoteState];
      })
    )
  };

  await mkdir(getDaemonSyncPeerDir(store), { recursive: true });
  await writeFile(getDaemonSyncHeadsPath(store), `${JSON.stringify(heads, null, 2)}\n`, 'utf8');
}

async function writeDaemonSyncStatus(store: ProjectStore, status: DaemonSyncStatus): Promise<void> {
  await mkdir(store.paths.stateDir, { recursive: true });
  await writeFile(getDaemonSyncStatusPath(store), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function getDaemonSyncPeerDir(store: ProjectStore): string {
  return store.paths.crdtSyncDir;
}

function getDaemonSyncPeerPath(store: ProjectStore): string {
  return join(getDaemonSyncPeerDir(store), DAEMON_SYNC_PEERS_FILENAME);
}

function getDaemonSyncHeadsPath(store: ProjectStore): string {
  return join(getDaemonSyncPeerDir(store), DAEMON_SYNC_HEADS_FILENAME);
}

function getDaemonSyncStatusPath(store: ProjectStore): string {
  return join(store.paths.stateDir, DAEMON_SYNC_STATUS_FILENAME);
}

function ensureRemotePeer(peers: DaemonSyncPeerFile, key: string): DaemonSyncPeerState {
  peers.schemaVersion = 2;
  peers.remotes ??= {};
  peers.remotes[key] ??= {};

  return peers.remotes[key];
}

function normalizeRemotePeers(remotes: Record<string, unknown>): Record<string, DaemonSyncPeerState> {
  const output: Record<string, DaemonSyncPeerState> = {};

  for (const [key, value] of Object.entries(remotes)) {
    if (!isPlainRecord(value)) {
      continue;
    }

    const peer: DaemonSyncPeerState = {};

    if (Array.isArray(value.remoteHeads)) {
      peer.remoteHeads = value.remoteHeads.filter((head): head is string => typeof head === 'string');
    }

    if (Array.isArray(value.lastExchangeHeads)) {
      peer.lastExchangeHeads = value.lastExchangeHeads.filter((head): head is string => typeof head === 'string');
    }

    if (typeof value.lastExchangeAt === 'string') {
      peer.lastExchangeAt = value.lastExchangeAt;
    }

    output[key] = peer;
  }

  return output;
}

function createRemoteErrorStatus(target: DaemonSyncRemoteTarget, error: unknown): DaemonSyncRemoteStatus {
  return {
    key: createRemoteTargetKey(target),
    serverUrl: target.remote.serverUrl,
    branch: target.remote.branch,
    clientId: target.remote.clientId,
    branchRole: target.branchRole,
    readOnly: target.readOnly,
    cachePath: '',
    cacheInitialized: false,
    cacheHeadCount: 0,
    cacheChangeCount: 0,
    enabled: true,
    queuedLocalChanges: 0,
    pushedChanges: 0,
    pulledChanges: 0,
    appliedChanges: 0,
    rejectedChanges: 0,
    localHeads: [],
    remoteHeads: [],
    exchangeComplete: false,
    lastError: serializeError(error)
  };
}

async function fetchJson<T>(url: string, init: RequestInit, options: DaemonSyncOptions): Promise<T> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(url, init);
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T | ErrorResponse) : ({} as T | ErrorResponse);

  if (!response.ok) {
    const error = (payload as ErrorResponse).error;
    throw new Error(error ? `${error.code}: ${error.message}` : `Request failed with ${response.status}`);
  }

  return payload as T;
}

function createRemoteHeaders(remote: ValidJoinedServerRecord): Record<string, string> {
  return {
    authorization: `Bearer ${remote.accessToken}`,
    'content-type': 'application/json'
  };
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/$/, '');
}

function createRemoteKey(remote: JoinedServerRecord): string {
  return `${remote.serverUrl}|${remote.branch}|${remote.clientId}`;
}

function createRemoteTargetKey(target: DaemonSyncRemoteTarget): string {
  const remoteKey = createRemoteKey(target.remote);

  return target.branchRole === 'active' ? remoteKey : `${remoteKey}|${target.branchRole}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
