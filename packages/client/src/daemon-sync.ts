import { createHash, createHmac } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KnowledgeItem, KnowledgeLayer, KnowledgeVisibility, ParaCategory, QualitySignals } from '@devmesh/core';
import {
  ensureProjectStore,
  JsonlKnowledgeRepository,
  readProjectConfig,
  type DevMeshEvent,
  type ProjectConfig,
  type ProjectStore
} from '@devmesh/local-store';
import type { ErrorResponse, SyncEvent, SyncPullResponse, SyncPushResponse } from '@devmesh/protocol';
import { getGlobalConfigPaths, readJsonFile } from './global-config.js';
import type { JoinedServerRecord } from './join-types.js';

export const DAEMON_SYNC_STATUS_FILENAME = 'status.json';
export const DAEMON_SYNC_REMOTE_EVENTS_DIR = 'remotes';
export const DEFAULT_DAEMON_SYNC_INTERVAL_MS = 30_000;
export const DEFAULT_DAEMON_SYNC_BATCH_SIZE = 100;

export interface DaemonSyncOptions {
  projectRoot?: string;
  globalRoot?: string;
  intervalMs?: number;
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
  schemaVersion: 1;
  projectRoot: string;
  enabled: boolean;
  updatedAt: string;
  remotes: DaemonSyncRemoteStatus[];
  message: string;
}

export interface DaemonSyncRemoteStatus {
  key: string;
  serverUrl: string;
  groupKey: string;
  clientId: string;
  enabled: boolean;
  queuedLocalEvents: number;
  pushedEvents: number;
  pulledEvents: number;
  replayedEvents: number;
  rejectedEvents: number;
  lastPushAt?: string;
  lastPullAt?: string;
  lastError?: string;
}

interface DaemonSyncCursorFile {
  remotes?: Record<string, DaemonSyncRemoteCursor>;
}

interface DaemonSyncRemoteCursor {
  pushedEventIds?: string[];
  pullCursor?: string;
  pushCursor?: string;
}

interface DaemonSyncIdentity {
  joinedServers?: JoinedServerRecord[];
  [key: string]: unknown;
}

type ValidJoinedServerRecord = JoinedServerRecord & {
  accessToken: string;
};

export function startDaemonSyncWorker(options: DaemonSyncOptions = {}): DaemonSyncWorker {
  let stopped = false;
  let running: Promise<DaemonSyncStatus> | undefined;
  const intervalMs = Math.max(1000, options.intervalMs ?? DEFAULT_DAEMON_SYNC_INTERVAL_MS);

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

  void runOnce().catch(options.onError ?? (() => undefined));

  return {
    runOnce,
    stop() {
      stopped = true;
      clearInterval(interval);
    }
  };
}

export async function runDaemonSyncOnce(options: DaemonSyncOptions = {}): Promise<DaemonSyncStatus> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const store = await ensureProjectStore(projectRoot);
  const config = await readProjectConfig(projectRoot);
  const timestamp = now().toISOString();

  if (!config.automation.autoSync) {
    const status: DaemonSyncStatus = {
      schemaVersion: 1,
      projectRoot,
      enabled: false,
      updatedAt: timestamp,
      remotes: [],
      message: 'Project auto_sync is disabled; daemon sync is idle.'
    };

    await writeDaemonSyncStatus(store, status);
    return status;
  }

  const identity = await readJsonFile<DaemonSyncIdentity>(getGlobalConfigPaths(options.globalRoot).identityPath, {});
  const remotes = (identity.joinedServers ?? []).filter(isValidJoinedServerRecord);

  if (remotes.length === 0) {
    const status: DaemonSyncStatus = {
      schemaVersion: 1,
      projectRoot,
      enabled: true,
      updatedAt: timestamp,
      remotes: [],
      message: 'Project auto_sync is enabled, but no joined server identity is available.'
    };

    await writeDaemonSyncStatus(store, status);
    return status;
  }

  const cursors = await readDaemonSyncCursors(store);
  const remoteStatuses: DaemonSyncRemoteStatus[] = [];

  for (const remote of remotes) {
    const key = createRemoteKey(remote);
    const cursor = ensureRemoteCursor(cursors, key);

    try {
      remoteStatuses.push(await syncRemote(store, config, remote, cursor, options));
    } catch (error) {
      remoteStatuses.push(createRemoteErrorStatus(remote, error));
    }
  }

  await writeDaemonSyncCursors(store, cursors);

  const errors = remoteStatuses.filter((remote) => remote.lastError !== undefined).length;
  const status: DaemonSyncStatus = {
    schemaVersion: 1,
    projectRoot,
    enabled: true,
    updatedAt: timestamp,
    remotes: remoteStatuses,
    message:
      errors === 0
        ? `Daemon sync checked ${remoteStatuses.length} remote(s).`
        : `Daemon sync checked ${remoteStatuses.length} remote(s) with ${errors} error(s).`
  };

  await writeDaemonSyncStatus(store, status);
  return status;
}

export async function readDaemonSyncStatus(projectRoot = process.cwd()): Promise<DaemonSyncStatus | undefined> {
  const store = await ensureProjectStore(projectRoot);

  try {
    return JSON.parse(await readFile(getDaemonSyncStatusPath(store), 'utf8')) as DaemonSyncStatus;
  } catch {
    return undefined;
  }
}

function isValidJoinedServerRecord(record: JoinedServerRecord): record is ValidJoinedServerRecord {
  return Boolean(
    typeof record.serverUrl === 'string' &&
      record.serverUrl.trim() &&
      typeof record.groupKey === 'string' &&
      record.groupKey.trim() &&
      typeof record.clientId === 'string' &&
      record.clientId.trim() &&
      typeof record.accessToken === 'string' &&
      record.accessToken.trim()
  );
}

async function syncRemote(
  store: ProjectStore,
  config: ProjectConfig,
  remote: ValidJoinedServerRecord,
  cursor: DaemonSyncRemoteCursor,
  options: DaemonSyncOptions
): Promise<DaemonSyncRemoteStatus> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_DAEMON_SYNC_BATCH_SIZE);
  const localEvents = await readProjectEvents(store.paths.eventsDir);
  const pushedIds = new Set(cursor.pushedEventIds ?? []);
  const pendingEvents = localEvents.filter((event) => !pushedIds.has(event.id)).slice(0, batchSize);
  let pushedEvents = 0;
  let pulledEvents = 0;
  let replayedEvents = 0;
  let rejectedEvents = 0;
  let lastPushAt: string | undefined;
  let lastPullAt: string | undefined;
  const repository = new JsonlKnowledgeRepository(store.projectRoot);

  if (pendingEvents.length > 0) {
    const push = await pushRemoteEvents(remote, pendingEvents, config, repository, options);
    const rejectedIds = new Set(push.rejected.map((event) => event.id));
    const acceptedOrDuplicateIds = pendingEvents.map((event) => event.id).filter((id) => !rejectedIds.has(id));

    cursor.pushedEventIds = mergeUniqueStrings(cursor.pushedEventIds ?? [], acceptedOrDuplicateIds);
    cursor.pushCursor = push.cursor;
    pushedEvents = push.accepted;
    rejectedEvents = push.rejected.length;
    lastPushAt = (options.now ?? (() => new Date()))().toISOString();
  }

  const pull = await pullRemoteEvents(remote, cursor.pullCursor, options);

  if (pull.events.length > 0) {
    await appendPulledRemoteEvents(store, remote, pull.events);
    replayedEvents = await replayPulledRemoteEvents(repository, pull.events);
  }

  cursor.pullCursor = pull.cursor;
  pulledEvents = pull.events.length;
  lastPullAt = (options.now ?? (() => new Date()))().toISOString();

  const pushedAfterRun = new Set(cursor.pushedEventIds ?? []);
  const queuedLocalEvents = localEvents.filter((event) => !pushedAfterRun.has(event.id)).length;
  const status: DaemonSyncRemoteStatus = {
    key: createRemoteKey(remote),
    serverUrl: remote.serverUrl,
    groupKey: remote.groupKey,
    clientId: remote.clientId,
    enabled: config.automation.autoSync,
    queuedLocalEvents,
    pushedEvents,
    pulledEvents,
    replayedEvents,
    rejectedEvents
  };

  if (lastPushAt !== undefined) {
    status.lastPushAt = lastPushAt;
  }

  if (lastPullAt !== undefined) {
    status.lastPullAt = lastPullAt;
  }

  return status;
}

async function pushRemoteEvents(
  remote: ValidJoinedServerRecord,
  events: DevMeshEvent[],
  config: ProjectConfig,
  repository: JsonlKnowledgeRepository,
  options: DaemonSyncOptions
): Promise<SyncPushResponse> {
  const syncEvents = await Promise.all(events.map((event) => toSyncEvent(remote, event, config, repository, options)));

  return fetchJson<SyncPushResponse>(
    `${normalizeServerUrl(remote.serverUrl)}/api/v1/sync/push`,
    {
      method: 'POST',
      headers: createRemoteHeaders(remote),
      body: JSON.stringify({
        clientId: remote.clientId,
        events: syncEvents
      })
    },
    options
  );
}

async function pullRemoteEvents(
  remote: ValidJoinedServerRecord,
  cursor: string | undefined,
  options: DaemonSyncOptions
): Promise<SyncPullResponse> {
  const url = new URL(`${normalizeServerUrl(remote.serverUrl)}/api/v1/sync/pull`);

  if (cursor !== undefined) {
    url.searchParams.set('cursor', cursor);
  }

  return fetchJson<SyncPullResponse>(
    url.toString(),
    {
      headers: createRemoteHeaders(remote)
    },
    options
  );
}

async function toSyncEvent(
  remote: JoinedServerRecord,
  event: DevMeshEvent,
  config: ProjectConfig,
  repository: JsonlKnowledgeRepository,
  options: DaemonSyncOptions
): Promise<SyncEvent> {
  const payload: Record<string, unknown> = {
    ...event.payload,
    projectKey: event.projectKey
  };
  const knowledgeId = readPayloadString(event.payload, 'knowledgeId');
  const item = knowledgeId === undefined ? undefined : await repository.get(knowledgeId);

  if (item !== undefined) {
    payload.knowledge = createSyncKnowledgeSnapshot(item, config);
  }

  const syncEvent: SyncEvent = {
    id: event.id,
    kind: event.kind,
    payload,
    createdAt: event.createdAt
  };

  if (remote.syncSigningSecret !== undefined) {
    syncEvent.signature = signSyncEvent(remote, syncEvent, options);
  }

  return syncEvent;
}

function createSyncKnowledgeSnapshot(item: KnowledgeItem, config: ProjectConfig): KnowledgeItem {
  const snapshot = JSON.parse(JSON.stringify(item)) as KnowledgeItem;

  if (snapshot.layer === 'raw' && !config.privacy.uploadRawTranscripts) {
    delete snapshot.content;
  }

  if (!config.privacy.uploadLargeSourceBlocks && snapshot.content !== undefined && snapshot.content.length > 4000) {
    delete snapshot.content;
  }

  return snapshot;
}

function signSyncEvent(remote: JoinedServerRecord, event: SyncEvent, options: DaemonSyncOptions): NonNullable<SyncEvent['signature']> {
  if (remote.syncSigningSecret === undefined) {
    throw new Error('Cannot sign sync event without a sync signing secret.');
  }

  const signedAt = (options.now ?? (() => new Date()))().toISOString();
  const signature = {
    algorithm: 'hmac-sha256' as const,
    value: '',
    signedAt,
    keyId: remote.clientId
  };
  const value = createHmac('sha256', remote.syncSigningSecret)
    .update(
      stableStringify({
        clientId: remote.clientId,
        groupKey: remote.groupKey,
        event: {
          id: event.id,
          kind: event.kind,
          createdAt: event.createdAt ?? null,
          payload: event.payload
        },
        signature: {
          algorithm: signature.algorithm,
          keyId: signature.keyId,
          signedAt: signature.signedAt
        }
      })
    )
    .digest('hex');

  return {
    ...signature,
    value
  };
}

async function readProjectEvents(eventsDir: string): Promise<DevMeshEvent[]> {
  let files: string[];

  try {
    files = await readdir(eventsDir);
  } catch {
    return [];
  }

  const events: DevMeshEvent[] = [];

  for (const file of files.filter((entry) => entry.endsWith('.jsonl')).sort()) {
    const content = await readFile(join(eventsDir, file), 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const event = parseProjectEventLine(line);

      if (event !== undefined) {
        events.push(event);
      }
    }
  }

  return events.sort((left, right) => `${left.createdAt}:${left.id}`.localeCompare(`${right.createdAt}:${right.id}`));
}

function parseProjectEventLine(line: string): DevMeshEvent | undefined {
  const trimmed = line.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    const value = JSON.parse(trimmed) as Partial<DevMeshEvent>;

    if (
      typeof value.id === 'string' &&
      typeof value.kind === 'string' &&
      typeof value.projectKey === 'string' &&
      typeof value.createdAt === 'string' &&
      isPlainRecord(value.payload)
    ) {
      return {
        id: value.id,
        kind: value.kind,
        projectKey: value.projectKey,
        createdAt: value.createdAt,
        payload: value.payload
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function appendPulledRemoteEvents(store: ProjectStore, remote: JoinedServerRecord, events: SyncEvent[]): Promise<void> {
  const directory = join(store.paths.syncDir, DAEMON_SYNC_REMOTE_EVENTS_DIR);
  await mkdir(directory, { recursive: true });

  const path = join(directory, `${createRemoteHash(remote)}.jsonl`);
  const lines = events
    .map((event) =>
      JSON.stringify({
        ...event,
        remote: {
          serverUrl: remote.serverUrl,
          groupKey: remote.groupKey,
          clientId: remote.clientId
        },
        receivedAt: new Date().toISOString()
      })
    )
    .join('\n');

  if (lines) {
    await appendFile(path, `${lines}\n`, 'utf8');
  }
}

async function replayPulledRemoteEvents(repository: JsonlKnowledgeRepository, events: SyncEvent[]): Promise<number> {
  let replayed = 0;

  for (const event of events) {
    if (event.kind === 'knowledge.deleted') {
      replayed += await replayKnowledgeTombstone(repository, event);
      continue;
    }

    const item = readKnowledgeSnapshot(event);

    if (item === undefined) {
      continue;
    }

    await repository.upsert(item);
    replayed += 1;
  }

  return replayed;
}

async function replayKnowledgeTombstone(repository: JsonlKnowledgeRepository, event: SyncEvent): Promise<number> {
  const knowledgeId = readPayloadString(event.payload, 'knowledgeId');

  if (knowledgeId === undefined) {
    return 0;
  }

  const existing = await repository.get(knowledgeId);

  if (existing === undefined) {
    return 0;
  }

  await repository.upsert({
    ...existing,
    status: 'tombstone',
    updatedAt: readPayloadString(event.payload, 'deletedAt') ?? event.createdAt ?? new Date().toISOString()
  });

  return 1;
}

function readKnowledgeSnapshot(event: SyncEvent): KnowledgeItem | undefined {
  const value = event.payload.knowledge;

  if (!isKnowledgeItem(value)) {
    return undefined;
  }

  return value;
}

async function readDaemonSyncCursors(store: ProjectStore): Promise<DaemonSyncCursorFile> {
  try {
    const parsed = JSON.parse(await readFile(getDaemonSyncCursorPath(store), 'utf8')) as DaemonSyncCursorFile;

    return {
      remotes: isPlainRecord(parsed.remotes) ? normalizeRemoteCursors(parsed.remotes) : {}
    };
  } catch {
    return {
      remotes: {}
    };
  }
}

async function writeDaemonSyncCursors(store: ProjectStore, cursors: DaemonSyncCursorFile): Promise<void> {
  await mkdir(store.paths.syncDir, { recursive: true });
  await writeFile(getDaemonSyncCursorPath(store), `${JSON.stringify(cursors, null, 2)}\n`, 'utf8');
}

async function writeDaemonSyncStatus(store: ProjectStore, status: DaemonSyncStatus): Promise<void> {
  await mkdir(store.paths.syncDir, { recursive: true });
  await writeFile(getDaemonSyncStatusPath(store), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function getDaemonSyncCursorPath(store: ProjectStore): string {
  return join(store.paths.syncDir, 'cursors.json');
}

function getDaemonSyncStatusPath(store: ProjectStore): string {
  return join(store.paths.syncDir, DAEMON_SYNC_STATUS_FILENAME);
}

function ensureRemoteCursor(cursors: DaemonSyncCursorFile, key: string): DaemonSyncRemoteCursor {
  cursors.remotes ??= {};
  cursors.remotes[key] ??= {};

  return cursors.remotes[key];
}

function normalizeRemoteCursors(remotes: Record<string, unknown>): Record<string, DaemonSyncRemoteCursor> {
  const output: Record<string, DaemonSyncRemoteCursor> = {};

  for (const [key, value] of Object.entries(remotes)) {
    if (!isPlainRecord(value)) {
      continue;
    }

    const cursor: DaemonSyncRemoteCursor = {};

    if (Array.isArray(value.pushedEventIds)) {
      cursor.pushedEventIds = value.pushedEventIds.filter((id): id is string => typeof id === 'string');
    }

    if (typeof value.pullCursor === 'string') {
      cursor.pullCursor = value.pullCursor;
    }

    if (typeof value.pushCursor === 'string') {
      cursor.pushCursor = value.pushCursor;
    }

    output[key] = cursor;
  }

  return output;
}

function createRemoteErrorStatus(remote: JoinedServerRecord, error: unknown): DaemonSyncRemoteStatus {
  return {
    key: createRemoteKey(remote),
    serverUrl: remote.serverUrl,
    groupKey: remote.groupKey,
    clientId: remote.clientId,
    enabled: true,
    queuedLocalEvents: 0,
    pushedEvents: 0,
    pulledEvents: 0,
    replayedEvents: 0,
    rejectedEvents: 0,
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
  return `${remote.serverUrl}|${remote.groupKey}|${remote.clientId}`;
}

function createRemoteHash(remote: JoinedServerRecord): string {
  return createHash('sha256').update(createRemoteKey(remote)).digest('hex').slice(0, 24);
}

function mergeUniqueStrings(existing: string[], next: string[]): string[] {
  const seen = new Set(existing);
  const merged = [...existing];

  for (const value of next) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }

  return merged;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];

  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isKnowledgeItem(value: unknown): value is KnowledgeItem {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    isKnowledgeLayer(value.layer) &&
    typeof value.entryKey === 'string' &&
    typeof value.type === 'string' &&
    typeof value.title === 'string' &&
    typeof value.summary === 'string' &&
    isPlainRecord(value.para) &&
    isParaCategory(value.para.category) &&
    typeof value.para.key === 'string' &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    isPlainRecord(value.source) &&
    typeof value.source.kind === 'string' &&
    isPlainRecord(value.createdBy) &&
    typeof value.createdBy.displayName === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    isKnowledgeVisibility(value.visibility) &&
    (value.status === 'active' || value.status === 'superseded' || value.status === 'tombstone') &&
    isQualitySignals(value.quality) &&
    (value.content === undefined || typeof value.content === 'string')
  );
}

function isKnowledgeLayer(value: unknown): value is KnowledgeLayer {
  return value === 'raw' || value === 'extract' || value === 'canonical';
}

function isParaCategory(value: unknown): value is ParaCategory {
  return value === 'projects' || value === 'areas' || value === 'resources' || value === 'archives';
}

function isKnowledgeVisibility(value: unknown): value is KnowledgeVisibility {
  return value === 'private' || value === 'project' || value === 'team' || value === 'org';
}

function isQualitySignals(value: unknown): value is QualitySignals {
  if (!isPlainRecord(value)) {
    return false;
  }

  return [
    value.confidence,
    value.weight,
    value.rating,
    value.adoptionScore,
    value.sourceTrust,
    value.evidence,
    value.freshness,
    value.qualityScore
  ].every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
