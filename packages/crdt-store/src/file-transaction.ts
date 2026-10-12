import { randomUUID } from 'node:crypto';
import { mkdir, open, realpath, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const requireNodeBuiltin = createRequire(import.meta.url);
const pendingTransactions = new Map<string, Promise<void>>();
const LOCK_TIMEOUT_MS = 30_000;

export async function withFileTransaction<T>(path: string, run: (canonicalPath: string) => Promise<T>): Promise<T> {
  const canonicalPath = await canonicalFilePath(path);
  const previous = pendingTransactions.get(canonicalPath) ?? Promise.resolve();
  const result = previous.then(() => withProcessLock(canonicalPath, run));
  const settled = result.then(() => {}, () => {});
  pendingTransactions.set(canonicalPath, settled);

  try {
    return await result;
  } finally {
    if (pendingTransactions.get(canonicalPath) === settled) pendingTransactions.delete(canonicalPath);
  }
}

async function canonicalFilePath(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return join(await realpath(dirname(absolute)), basename(absolute));
  }
}

async function withProcessLock<T>(path: string, run: (path: string) => Promise<T>): Promise<T> {
  // Keep this sidecar: unlinking it could let two processes lock different inodes.
  // SQLite releases its OS lock on process exit, without stealing a slow owner's lock.
  const sqlite = requireNodeBuiltin('node:sqlite') as typeof import('node:sqlite');
  const db = new sqlite.DatabaseSync(`${path}.lock.sqlite`);
  let acquired = false;

  try {
    db.exec('PRAGMA busy_timeout = 0');
    const deadline = performance.now() + LOCK_TIMEOUT_MS;
    while (!acquired) {
      try {
        db.exec('BEGIN IMMEDIATE');
        acquired = true;
      } catch (error) {
        if (!isBusy(error)) throw error;
        if (performance.now() >= deadline) throw new Error(`Timed out waiting for CRDT file transaction: ${path}`, { cause: error });
        // A synchronous busy wait would prevent a same-process owner from resuming.
        await delay(25);
      }
    }
    return await run(path);
  } finally {
    try {
      if (acquired) db.exec('ROLLBACK');
    } finally {
      db.close();
    }
  }
}

export async function replaceFileAtomically(path: string, content: Uint8Array): Promise<void> {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const existing = await stat(path).catch((error: unknown) => {
    if (!isMissing(error)) throw error;
    return undefined;
  });
  const file = await open(temporaryPath, 'wx', existing?.mode ?? 0o600);

  try {
    try {
      if (existing !== undefined) await file.chmod(existing.mode);
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    // Never unlink the destination first: concurrent readers need an intact snapshot.
    await renameWithRetry(temporaryPath, path);
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (true) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      // Windows readers and virus scanners can briefly deny replacement of an open file.
      if (process.platform !== 'win32' || !(error instanceof Error) || !('code' in error)
        || !['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code)) || performance.now() >= deadline) throw error;
      await delay(25);
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isBusy(error: unknown): boolean {
  return error instanceof Error && 'errcode' in error && typeof error.errcode === 'number'
    && (error.errcode & 0xff) === 5;
}
