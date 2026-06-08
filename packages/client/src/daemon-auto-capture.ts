import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureProvider, RawEvent } from '@mcp-dev-mesh/extension-api';
import { appendProjectEvent, ensureProjectStore, readProjectConfig, type ProjectStore } from '@mcp-dev-mesh/local-store';
import { createFileSystemCaptureProvider, createGitCaptureProvider } from '@mcp-dev-mesh/providers';

export const DAEMON_AUTO_CAPTURE_STATUS_FILENAME = 'status.json';
export const DEFAULT_DAEMON_AUTO_CAPTURE_INTERVAL_MS = 15_000;

export interface DaemonAutoCaptureOptions {
  projectRoot?: string;
  intervalMs?: number;
  now?: () => Date;
  providers?: CaptureProvider[];
  onError?: (error: unknown) => void;
}

export interface DaemonAutoCaptureWorker {
  runOnce(): Promise<DaemonAutoCaptureStatus>;
  stop(): void;
}

export interface DaemonAutoCaptureStatus {
  schemaVersion: 1;
  projectRoot: string;
  enabled: boolean;
  updatedAt: string;
  providers: DaemonAutoCaptureProviderStatus[];
  collectedEvents: number;
  capturedEvents: number;
  skippedEvents: number;
  message: string;
}

export interface DaemonAutoCaptureProviderStatus {
  id: string;
  detected: boolean;
  collectedEvents: number;
  capturedEvents: number;
  skippedEvents: number;
  lastError?: string;
}

interface DaemonAutoCaptureCursorFile {
  providers?: Record<string, DaemonAutoCaptureProviderCursor>;
}

interface DaemonAutoCaptureProviderCursor {
  since?: string;
  lastSignature?: string;
}

export function startDaemonAutoCaptureWorker(options: DaemonAutoCaptureOptions = {}): DaemonAutoCaptureWorker {
  let stopped = false;
  let running: Promise<DaemonAutoCaptureStatus> | undefined;
  const intervalMs = Math.max(1000, options.intervalMs ?? DEFAULT_DAEMON_AUTO_CAPTURE_INTERVAL_MS);

  const runOnce = async (): Promise<DaemonAutoCaptureStatus> => {
    if (running !== undefined) {
      return running;
    }

    running = runDaemonAutoCaptureOnce(options).finally(() => {
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

export async function runDaemonAutoCaptureOnce(
  options: DaemonAutoCaptureOptions = {}
): Promise<DaemonAutoCaptureStatus> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const store = await ensureProjectStore(projectRoot);
  const config = await readProjectConfig(projectRoot);

  if (!config.automation.autoCapture) {
    const status: DaemonAutoCaptureStatus = {
      schemaVersion: 1,
      projectRoot,
      enabled: false,
      updatedAt: startedAt,
      providers: [],
      collectedEvents: 0,
      capturedEvents: 0,
      skippedEvents: 0,
      message: 'Project auto_capture is disabled; daemon auto capture is idle.'
    };

    await writeDaemonAutoCaptureStatus(store, status);
    return status;
  }

  const cursors = await readDaemonAutoCaptureCursors(store);
  const providers = options.providers ?? createDefaultAutoCaptureProviders();
  const providerStatuses: DaemonAutoCaptureProviderStatus[] = [];

  for (const provider of providers.sort(compareProviders)) {
    providerStatuses.push(await runProviderAutoCapture(provider, projectRoot, startedAt, cursors, options));
  }

  await writeDaemonAutoCaptureCursors(store, cursors);

  const totals = providerStatuses.reduce(
    (total, provider) => ({
      collectedEvents: total.collectedEvents + provider.collectedEvents,
      capturedEvents: total.capturedEvents + provider.capturedEvents,
      skippedEvents: total.skippedEvents + provider.skippedEvents
    }),
    {
      collectedEvents: 0,
      capturedEvents: 0,
      skippedEvents: 0
    }
  );
  const errors = providerStatuses.filter((provider) => provider.lastError !== undefined).length;
  const status: DaemonAutoCaptureStatus = {
    schemaVersion: 1,
    projectRoot,
    enabled: true,
    updatedAt: startedAt,
    providers: providerStatuses,
    ...totals,
    message:
      errors === 0
        ? `Daemon auto capture checked ${providerStatuses.length} provider(s).`
        : `Daemon auto capture checked ${providerStatuses.length} provider(s) with ${errors} error(s).`
  };

  await writeDaemonAutoCaptureStatus(store, status);
  return status;
}

export async function readDaemonAutoCaptureStatus(
  projectRoot = process.cwd()
): Promise<DaemonAutoCaptureStatus | undefined> {
  const store = await ensureProjectStore(projectRoot);

  try {
    return JSON.parse(await readFile(getDaemonAutoCaptureStatusPath(store), 'utf8')) as DaemonAutoCaptureStatus;
  } catch {
    return undefined;
  }
}

function createDefaultAutoCaptureProviders(): CaptureProvider[] {
  return [
    createGitCaptureProvider(),
    createFileSystemCaptureProvider({
      maxFiles: 120
    })
  ];
}

async function runProviderAutoCapture(
  provider: CaptureProvider,
  projectRoot: string,
  startedAt: string,
  cursors: DaemonAutoCaptureCursorFile,
  options: DaemonAutoCaptureOptions
): Promise<DaemonAutoCaptureProviderStatus> {
  const cursor = ensureProviderCursor(cursors, provider.id);
  const status: DaemonAutoCaptureProviderStatus = {
    id: provider.id,
    detected: false,
    collectedEvents: 0,
    capturedEvents: 0,
    skippedEvents: 0
  };

  try {
    status.detected = await provider.detect(projectRoot);

    if (!status.detected) {
      return status;
    }

    const context = cursor.since === undefined ? { projectRoot } : { projectRoot, since: cursor.since };

    for await (const event of provider.collect(context)) {
      status.collectedEvents += 1;

      if (!isMeaningfulAutoCaptureEvent(event)) {
        status.skippedEvents += 1;
        continue;
      }

      const signature = createAutoCaptureEventSignature(event);

      if (signature === cursor.lastSignature) {
        status.skippedEvents += 1;
        continue;
      }

      await appendProjectEvent(projectRoot, 'raw.captured', {
        rawEvent: event,
        processing: {
          mode: 'mcp-host',
          instruction:
            'Summarize durable project knowledge with the active coding assistant, then call mesh_capture_knowledge or mesh_capture_task.'
        }
      });
      cursor.lastSignature = signature;
      status.capturedEvents += 1;
    }

    cursor.since = startedAt;
  } catch (error) {
    status.lastError = serializeError(error);
    options.onError?.(error);
  }

  return status;
}

function isMeaningfulAutoCaptureEvent(event: RawEvent): boolean {
  const payload = readRecord(event.payload);

  if (event.kind === 'git.snapshot') {
    return readRecordList(payload.changedFiles).length > 0 || Object.keys(readRecord(payload.testResult)).length > 0;
  }

  if (event.kind === 'filesystem.snapshot') {
    return readRecordList(payload.files).length > 0;
  }

  return true;
}

function createAutoCaptureEventSignature(event: RawEvent): string {
  return createHash('sha256')
    .update(
      stableStringify({
        kind: event.kind,
        summary: event.summary,
        payload: normalizeSignaturePayload(event.payload)
      })
    )
    .digest('hex');
}

function normalizeSignaturePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (payload === undefined) {
    return undefined;
  }

  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (key === 'since') {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

async function readDaemonAutoCaptureCursors(store: ProjectStore): Promise<DaemonAutoCaptureCursorFile> {
  try {
    const parsed = JSON.parse(await readFile(getDaemonAutoCaptureCursorPath(store), 'utf8')) as DaemonAutoCaptureCursorFile;

    return {
      providers: isPlainRecord(parsed.providers) ? normalizeProviderCursors(parsed.providers) : {}
    };
  } catch {
    return {
      providers: {}
    };
  }
}

async function writeDaemonAutoCaptureCursors(
  store: ProjectStore,
  cursors: DaemonAutoCaptureCursorFile
): Promise<void> {
  await mkdir(getDaemonAutoCaptureDir(store), { recursive: true });
  await writeFile(getDaemonAutoCaptureCursorPath(store), `${JSON.stringify(cursors, null, 2)}\n`, 'utf8');
}

async function writeDaemonAutoCaptureStatus(store: ProjectStore, status: DaemonAutoCaptureStatus): Promise<void> {
  await mkdir(getDaemonAutoCaptureDir(store), { recursive: true });
  await writeFile(getDaemonAutoCaptureStatusPath(store), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function ensureProviderCursor(cursors: DaemonAutoCaptureCursorFile, providerId: string): DaemonAutoCaptureProviderCursor {
  cursors.providers ??= {};
  cursors.providers[providerId] ??= {};

  return cursors.providers[providerId];
}

function normalizeProviderCursors(providers: Record<string, unknown>): Record<string, DaemonAutoCaptureProviderCursor> {
  const output: Record<string, DaemonAutoCaptureProviderCursor> = {};

  for (const [providerId, value] of Object.entries(providers)) {
    if (!isPlainRecord(value)) {
      continue;
    }

    const cursor: DaemonAutoCaptureProviderCursor = {};

    if (typeof value.since === 'string') {
      cursor.since = value.since;
    }

    if (typeof value.lastSignature === 'string') {
      cursor.lastSignature = value.lastSignature;
    }

    output[providerId] = cursor;
  }

  return output;
}

function getDaemonAutoCaptureDir(store: ProjectStore): string {
  return join(store.storeRoot, 'capture');
}

function getDaemonAutoCaptureCursorPath(store: ProjectStore): string {
  return join(getDaemonAutoCaptureDir(store), 'cursors.json');
}

function getDaemonAutoCaptureStatusPath(store: ProjectStore): string {
  return join(getDaemonAutoCaptureDir(store), DAEMON_AUTO_CAPTURE_STATUS_FILENAME);
}

function compareProviders(left: CaptureProvider, right: CaptureProvider): number {
  return (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return {};
  }

  return value;
}

function readRecordList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readRecord).filter((item) => Object.keys(item).length > 0);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
